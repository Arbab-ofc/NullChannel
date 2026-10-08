import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
const exec = promisify(execFile);
const dsn = process.env.TEST_MIGRATION_DATABASE_URL;
const sql = async (query: string) => (await exec('psql',[dsn!, '-v','ON_ERROR_STOP=1','-At','-c',query])).stdout.trim();
let migration: string; let preserved: string;
const snapshot = () => sql(`select jsonb_build_object(
  'rooms',(select jsonb_agg(to_jsonb(r) order by r.id) from rooms r),
  'messages',(select jsonb_agg(to_jsonb(m)-'first_seen_at'-'burn_expires_at' order by m.id) from messages m),
  'members',(select jsonb_agg(to_jsonb(m) order by m.id) from room_members m),
  'reactions',(select jsonb_agg(to_jsonb(r) order by r.id) from message_reactions r),
  'queue',(select jsonb_agg(to_jsonb(q) order by q.file_id) from media_cleanup q))`);
const session = async () => {
  const id = randomUUID();
  await sql(`insert into anonymous_sessions(identity_id,access_hash,refresh_hash,expires_at,access_expires_at) values ('${id}',encode(gen_random_bytes(32),'hex'),encode(gen_random_bytes(32),'hex'),clock_timestamp()+interval '1 day',clock_timestamp()+interval '15 minutes')`);
  return id;
};
const fixture = async () => {
  const owner = await session(); const guest = await session(); const code = randomUUID().replaceAll('-','').slice(0,8).toUpperCase();
  const room = await sql(`select id from create_room('${code}','${owner}','Owner','private','Audit',60)`);
  await sql(`select join_room('${room}','${guest}','Guest')`); return { owner,guest,room,code };
};
const message = async (f: Awaited<ReturnType<typeof fixture>>, file = false) => {
  const id = randomUUID(); const fileId = randomUUID();
  if (file) await sql(`insert into media_uploads(file_id,room_id,sender_id,file_url,file_path,file_name,file_size,mime_type,media_type) values ('${fileId}','${f.room}','${f.owner}','https://fixture.invalid/file','/audit/${fileId}','fixture.txt',2,'text/plain','file')`);
  await sql(`insert into messages(id,room_id,sender_id,sender_name,type,content,burn_after_read,file_path) values ('${id}','${f.room}','${f.owner}','Owner','${file ? 'file' : 'text'}','fixture',true,${file ? `'/audit/${fileId}'` : 'null'})`);
  return { id,fileId };
};
const due = (id: string) => sql(`with t as (select clock_timestamp()-interval '61 seconds' as seen) update messages set first_seen_at=t.seen,burn_expires_at=t.seen+interval '60 seconds' from t where id='${id}'`);
describe.skipIf(!dsn)('v11 to v12 populated-schema production migration audit',() => {
  beforeAll(async () => {
    const url = new URL(dsn!);
    if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.startsWith('/nullchannel_test') || dsn === process.env.TEST_DATABASE_URL) throw new Error('Use a separate disposable loopback nullchannel_test database');
    if (await sql(`select count(*) from pg_tables where schemaname='public'`) !== '0') throw new Error('Migration audit requires an empty disposable database; existing data will not be reset');
    await sql(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$`);
    await sql(await readFile(new URL('../../supabase/schema.sql',import.meta.url),'utf8'));
    for (let version=2; version<=10; version++) await sql(await readFile(new URL(`../../../docs/supabase-migration-v${version}.sql`,import.meta.url),'utf8'));
    // Seed genuine pre-v11 legacy rows, including unknown media IDs and tombstones.
    const r = randomUUID(); const m = randomUUID();
    await sql(`insert into rooms(id,code,creator_id,room_name,room_type) values ('${r}','LEGACY12','legacy-owner','Legacy','group');
      insert into room_members(room_id,sender_id,sender_name) values ('${r}','legacy-owner','Legacy');
      insert into messages(id,room_id,sender_id,sender_name,type,content,burn_after_read) values ('${m}','${r}','legacy-owner','Legacy','text','fixture burn',true);
      insert into messages(room_id,sender_id,sender_name,type,content,deleted) values ('${r}','legacy-owner','Legacy','text','fixture tombstone',true);
      insert into messages(room_id,sender_id,sender_name,type,file_url,file_path) values ('${r}','legacy-owner','Legacy','image','https://fixture.invalid/legacy','/legacy/unknown');
      insert into message_reactions(message_id,sender_id,sender_name,emoji) values ('${m}','legacy-owner','Legacy','👍');
      update rooms set pinned_message_id='${m}' where id='${r}';`);
    await sql(await readFile(new URL('../../../docs/supabase-migration-v11.sql',import.meta.url),'utf8'));
    preserved = await snapshot(); migration = await readFile(new URL('../../../docs/supabase-migration-v12.sql',import.meta.url),'utf8');
  },30000);
  it('rolls back every v12 DDL change and preserves data on a migration-time error',async () => {
    await expect(sql(migration.replace(/^commit;$/m,'select 1/0;\ncommit;'))).rejects.toThrow('division by zero');
    expect(await sql(`select count(*) from information_schema.columns where table_schema='public' and table_name='messages' and column_name in ('first_seen_at','burn_expires_at')`)).toBe('0');
    expect(await sql(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('mark_message_seen','cleanup_burn_messages')`)).toBe('0');
    expect(await sql(`select count(*) from pg_indexes where schemaname='public' and indexname='idx_messages_burn_due'`)).toBe('0');
    expect(await snapshot()).toBe(preserved);
  });
  it('fails closed before DDL if required v11 media cleanup triggers are disabled',async () => {
    await sql('alter table messages disable trigger queue_message_media');
    try { await expect(sql(migration)).rejects.toThrow('V11_TRIGGER_PREREQUISITE_MISSING'); expect(await snapshot()).toBe(preserved); }
    finally { await sql('alter table messages enable trigger queue_message_media'); }
    expect(await sql(`select count(*) from information_schema.columns where table_schema='public' and table_name='messages' and column_name='first_seen_at'`)).toBe('0');
  });
  it('upgrades populated v11 without deleting or changing legacy messages, rooms, pins, reactions or memberships',async () => {
    expect(await sql('listen pgrst;\n'+migration+'\nselect 1;')).toContain('reload schema'); expect(await snapshot()).toBe(preserved);
    expect(await sql(`select count(*) from messages where first_seen_at is not null or burn_expires_at is not null`)).toBe('0');
    expect(await sql(`select convalidated from pg_constraint where conrelid='public.messages'::regclass and conname='messages_burn_deadline'`)).toBe('t');
    await sql(migration); expect(await snapshot()).toBe(preserved);
  });
  it('rejects inherited public-role execution grants and rolls back the unsafe role grant',async () => {
    // Role membership is transaction-local and never visible to other test connections.
    await expect(sql(migration.replace('begin;','begin; grant service_role to anon;'))).rejects.toThrow('UNSAFE_BURN_RPC_GRANTS');
    expect(await sql(`select pg_has_role('anon','service_role','MEMBER')`)).toBe('f');
    expect(await snapshot()).toBe(preserved);
  });
  it('restricts both SECURITY DEFINER functions and ignores temporary schema shadowing',async () => {
    for (const role of ['anon','authenticated']) for (const fn of ['public.mark_message_seen(uuid,uuid,text)','public.cleanup_burn_messages()']) expect(await sql(`select has_function_privilege('${role}','${fn}','EXECUTE')`)).toBe('f');
    expect(await sql(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('mark_message_seen','cleanup_burn_messages') and prosecdef and proconfig @> array['search_path=pg_catalog, pg_temp']`)).toBe('2');
    await sql(`create temporary table messages(id uuid); create function pg_temp.clock_timestamp() returns timestamptz language sql as 'select ''2100-01-01''::timestamptz'; set role service_role; select * from public.cleanup_burn_messages()`);
    expect(await snapshot()).toBe(preserved);
  });
  it('rejects expired access, revoked sessions, left members and cross-room receipts',async () => {
    const f = await fixture(); const m = await message(f);
    await sql(`update anonymous_sessions set access_expires_at=clock_timestamp()-interval '1 second' where identity_id='${f.guest}'`);
    await expect(sql(`select * from mark_message_seen('${f.room}','${m.id}','${f.guest}')`)).rejects.toThrow('SESSION_INVALID');
    await sql(`update anonymous_sessions set access_expires_at=clock_timestamp()+interval '15 minutes',revoked_at=clock_timestamp() where identity_id='${f.guest}'`);
    await expect(sql(`select * from mark_message_seen('${f.room}','${m.id}','${f.guest}')`)).rejects.toThrow('SESSION_INVALID');
    await sql(`update anonymous_sessions set revoked_at=null where identity_id='${f.guest}'; update room_members set left_at=clock_timestamp() where room_id='${f.room}' and sender_id='${f.guest}'`);
    await expect(sql(`select * from mark_message_seen('${f.room}','${m.id}','${f.guest}')`)).rejects.toThrow('JOIN_REQUIRED');
    const other = await fixture(); await expect(sql(`select * from mark_message_seen('${other.room}','${m.id}','${other.guest}')`)).rejects.toThrow('MESSAGE_NOT_FOUND');
    expect(await sql(`select first_seen_at is null from messages where id='${m.id}'`)).toBe('t');
  });
  it('parallel cleanup workers delete each due message once and enqueue each real file ID once',async () => {
    const ids: string[] = []; const files: string[] = [];
    for (let index=0; index<4; index++) { const f = await fixture(); for (let j=0;j<2;j++) { const m=await message(f,true); ids.push(m.id); files.push(m.fileId); await due(m.id); } }
    const results = await Promise.all(Array.from({ length: 8 },() => sql(`select id from cleanup_burn_messages()`)));
    const deleted = results.flatMap(result => result ? result.split('\n') : []);
    expect(deleted.sort()).toEqual(ids.sort()); expect(new Set(deleted).size).toBe(8);
    for (const file of files) expect(await sql(`select count(*) from media_cleanup where file_id='${file}'`)).toBe('1');
  });
  it('burn cleanup races safely with panic wipe and clears message pins and replies',async () => {
    const f = await fixture(); const m = await message(f,true); const reply = await message(f);
    await sql(`update rooms set pinned_message_id='${m.id}' where id='${f.room}'; update messages set reply_to_message_id='${m.id}' where id='${reply.id}'`); await due(m.id);
    await Promise.all([sql('select * from cleanup_burn_messages()'),sql(`select * from wipe_room('${f.code}','${f.owner}')`)]);
    expect(await sql(`select count(*) from messages where room_id='${f.room}'`)).toBe('0');
    expect(await sql(`select pinned_message_id is null from rooms where id='${f.room}'`)).toBe('t');
    expect(await sql(`select count(*) from media_cleanup where file_id='${m.fileId}'`)).toBe('1');
  });
  it('queue failure rolls back message deletion and succeeds idempotently after retry',async () => {
    const f = await fixture(); const m = await message(f,true); await due(m.id);
    await sql(`create function public.audit_queue_failure() returns trigger language plpgsql as $$ begin raise exception 'FIXTURE_QUEUE_FAILURE'; end $$; create trigger audit_queue_failure before insert on media_cleanup for each row execute function public.audit_queue_failure()`);
    try { await expect(sql('select * from cleanup_burn_messages()')).rejects.toThrow('FIXTURE_QUEUE_FAILURE'); expect(await sql(`select count(*) from messages where id='${m.id}'`)).toBe('1'); }
    finally { await sql('drop trigger audit_queue_failure on media_cleanup; drop function public.audit_queue_failure()'); }
    await sql('select * from cleanup_burn_messages()'); await sql('select * from cleanup_burn_messages()');
    expect(await sql(`select count(*) from messages where id='${m.id}'`)).toBe('0'); expect(await sql(`select count(*) from media_cleanup where file_id='${m.fileId}'`)).toBe('1');
  });
  it('v11 room/media cleanup preserves unseen and not-yet-due messages in live rooms',async () => {
    const f=await fixture(); const unseen=await message(f,true); const seen=await message(f,true);
    await sql(`select * from mark_message_seen('${f.room}','${seen.id}','${f.guest}')`);
    await sql('select * from cleanup_expired_rooms(); select * from claim_media_cleanup(); select * from cleanup_burn_messages()');
    expect(await sql(`select count(*) from messages where id in ('${unseen.id}','${seen.id}')`)).toBe('2');
    for (const m of [unseen,seen]) expect(await sql(`select count(*) from media_cleanup where file_id='${m.fileId}'`)).toBe('0');
  });
  it('limits each burn batch to 500 messages without deleting unseen messages',async () => {
    const f=await fixture(); const unseen=await message(f);
    await sql(`insert into messages(room_id,sender_id,sender_name,type,content,burn_after_read,first_seen_at,burn_expires_at) select '${f.room}','${f.owner}','Owner','text','fixture',true,now()-interval '61 seconds',now()-interval '1 second' from generate_series(1,505)`);
    expect(await sql('select count(*) from cleanup_burn_messages()')).toBe('500'); expect(await sql('select count(*) from cleanup_burn_messages()')).toBe('5');
    expect(await sql(`select count(*) from messages where id='${unseen.id}' and first_seen_at is null`)).toBe('1');
  });
});
