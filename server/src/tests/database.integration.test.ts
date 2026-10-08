import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
const exec = promisify(execFile);
const dsn = process.env.TEST_DATABASE_URL;
const sql = async (query: string) => (await exec('psql', [dsn!, '-v', 'ON_ERROR_STOP=1', '-At', '-c', query])).stdout.trim();
const session = async () => {
  const id = randomUUID();
  await sql(`insert into anonymous_sessions(identity_id,access_hash,refresh_hash,expires_at,access_expires_at) values ('${id}',encode(gen_random_bytes(32),'hex'),encode(gen_random_bytes(32),'hex'),now()+interval '1 day',now()+interval '15 minutes')`);
  return id;
};
const room = async (creator: string, kind = 'private') => {
  const code = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return sql(`select id from create_room('${code}','${creator}','Creator','${kind}','Test room',60)`);
};
const join = (r: string, u: string) => sql(`select join_room('${r}','${u}','Member')`);
describe.skipIf(!dsn)('real PostgreSQL migrations and concurrency', () => {
  beforeAll(async () => {
    const url = new URL(dsn!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/nullchannel_test')) throw new Error('Only isolated local nullchannel_test databases are allowed');
    await sql(`do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$`);
    await sql(await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
    for (let version = 2; version <= 12; version++) await sql(await readFile(new URL(`../../../docs/supabase-migration-v${version}.sql`, import.meta.url), 'utf8'));
    // Re-applying the security migration must preserve existing data and succeed.
    await sql(await readFile(new URL('../../../docs/supabase-migration-v11.sql', import.meta.url), 'utf8'));
    await sql(await readFile(new URL('../../../docs/supabase-migration-v12.sql', import.meta.url), 'utf8'));
  }, 30000);
  it('admits two legitimate users and rejects a third', async () => {
    const creator = await session(); const guest = await session(); const third = await session(); const r = await room(creator);
    await join(r, guest); await expect(join(r, third)).rejects.toThrow('ROOM_FULL');
    expect(await sql(`select count(*) from room_members where room_id='${r}' and left_at is null`)).toBe('2');
  });
  it('three simultaneous guests cannot exceed the creator-reserved capacity', async () => {
    const creator = await session(); const users = await Promise.all([session(), session(), session()]); const r = await room(creator);
    const results = await Promise.allSettled(users.map(u => join(r, u)));
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(await sql(`select count(*) from room_members where room_id='${r}' and left_at is null`)).toBe('2');
  });
  it('repeated requests, reconnects and multiple tabs retain a single membership', async () => {
    const creator = await session(); const guest = await session(); const r = await room(creator);
    await Promise.all(Array.from({ length: 8 }, () => join(r, guest)));
    await join(r, guest);
    expect(await sql(`select count(*) from room_members where room_id='${r}' and sender_id='${guest}'`)).toBe('1');
  });
  it('rejects expired and deleted rooms', async () => {
    const creator = await session(); const guest = await session(); const r = await room(creator);
    await sql(`update rooms set expires_at = now() - interval '1 second' where id='${r}'`);
    await expect(join(r, guest)).rejects.toThrow('ROOM_NOT_FOUND');
    await sql(`delete from rooms where id='${r}'`);
    await expect(join(r, guest)).rejects.toThrow('ROOM_NOT_FOUND');
  });
  it('reserves a departed creator slot and accepts a reconnect', async () => {
    const creator = await session(); const guest = await session(); const third = await session(); const r = await room(creator);
    await join(r, guest); await sql(`update room_members set left_at=now() where room_id='${r}' and sender_id='${creator}'`);
    await expect(join(r, third)).rejects.toThrow('ROOM_FULL'); await join(r, creator);
  });
  it('permits only one concurrent extension and denies participants', async () => {
    const creator = await session(); const guest = await session(); const r = await room(creator); await join(r, guest);
    const code = await sql(`select code from rooms where id='${r}'`);
    await expect(sql(`select extend_room('${code}','${guest}',5)`)).rejects.toThrow('FORBIDDEN');
    const results = await Promise.allSettled([sql(`select extend_room('${code}','${creator}',5)`), sql(`select extend_room('${code}','${creator}',5)`)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  });
  it('rejects expired messages, nonmembers and cross-room replies at the database boundary', async () => {
    const creator = await session(); const stranger = await session(); const r = await room(creator);
    await expect(sql(`insert into messages(room_id,sender_id,sender_name,type,content) values ('${r}','${stranger}','Stranger','text','x')`)).rejects.toThrow('JOIN_REQUIRED');
    const other = await room(creator, 'group');
    const msg = await sql(`insert into messages(room_id,sender_id,sender_name,type,content) values ('${other}','${creator}','Creator','text','x') returning id`);
    await expect(sql(`insert into messages(room_id,sender_id,sender_name,type,content,reply_to_message_id) values ('${r}','${creator}','Creator','text','x','${msg.split('\n')[0]}')`)).rejects.toThrow('INVALID_REPLY');
    await sql(`update rooms set expires_at=now()-interval '1 second' where id='${r}'`);
    await expect(sql(`insert into messages(room_id,sender_id,sender_name,type,content) values ('${r}','${creator}','Creator','text','x')`)).rejects.toThrow('ROOM_NOT_FOUND');
  });
  it('binds a one-use upload and durably queues deletion during cascade', async () => {
    const creator = await session(); const r = await room(creator); const id = randomUUID();
    await sql(`insert into media_uploads(file_id,room_id,sender_id,file_url,file_path,file_name,file_size,mime_type,media_type) values ('${id}','${r}','${creator}','https://example.test/file','/safe/${id}','file.txt',2,'text/plain','file')`);
    await sql(`insert into messages(room_id,sender_id,sender_name,type,file_path,file_url) values ('${r}','${creator}','Creator','file','/safe/${id}','https://attacker.test')`);
    expect(await sql(`select file_id || ':' || file_url from messages where room_id='${r}'`)).toBe(`${id}:https://example.test/file`);
    await expect(sql(`insert into messages(room_id,sender_id,sender_name,type,file_path) values ('${r}','${creator}','Creator','file','/safe/${id}')`)).rejects.toThrow('INVALID_UPLOAD');
    await sql(`delete from rooms where id='${r}'`);
    expect(await sql(`select count(*) from media_cleanup where file_id='${id}'`)).toBe('1');
    await sql('select * from claim_media_cleanup()');
    expect(await sql(`select count(*) from media_cleanup where file_id='${id}' and lease_until > now()`)).toBe('1');
  });
  it('cleanup can run repeatedly after a restart without deleting unexpired rooms', async () => {
    const creator = await session(); const r = await room(creator);
    await sql('select * from cleanup_expired_rooms()'); await sql('select * from cleanup_expired_rooms()');
    expect(await sql(`select count(*) from rooms where id='${r}'`)).toBe('1');
  });
  it('atomically wipes messages, clears pins and queues media without deleting the room', async () => {
    const creator = await session(); const r = await room(creator); const code = await sql(`select code from rooms where id='${r}'`);
    const msg = (await sql(`insert into messages(room_id,sender_id,sender_name,type,content) values ('${r}','${creator}','Creator','text','wipe me') returning id`)).split('\n')[0];
    await sql(`update rooms set pinned_message_id='${msg}' where id='${r}'`);
    expect(await sql(`select wiped_messages from wipe_room('${code}','${creator}')`)).toBe('1');
    expect(await sql(`select count(*) from messages where room_id='${r}'`)).toBe('0');
    expect(await sql(`select count(*) from rooms where id='${r}' and pinned_message_id is null`)).toBe('1');
  });
  it('an upload queued for failed-message cleanup cannot subsequently be claimed', async () => {
    const creator = await session(); const r = await room(creator); const id = randomUUID();
    await sql(`insert into media_uploads(file_id,room_id,sender_id,file_url,file_path,file_name,file_size,mime_type,media_type) values ('${id}','${r}','${creator}','https://example.test/file','/safe/${id}','file.txt',2,'text/plain','file')`);
    await sql(`select queue_unused_upload('${r}','${creator}','/safe/${id}')`);
    await expect(sql(`insert into messages(room_id,sender_id,sender_name,type,file_path) values ('${r}','${creator}','Creator','file','/safe/${id}')`)).rejects.toThrow('INVALID_UPLOAD');
  });
  it('public roles cannot read sessions or invoke security-definer join RPCs', async () => {
    await expect(sql('set role anon; select * from anonymous_sessions')).rejects.toThrow('permission denied');
    await expect(sql(`set role authenticated; select join_room('${randomUUID()}','${randomUUID()}','Guest')`)).rejects.toThrow('permission denied');
  });
  it('retains unseen burn messages and rejects sender, nonmember and non-burn receipts',async () => {
    const owner = await session(); const guest = await session(); const outsider = await session(); const r = await room(owner); await join(r,guest);
    const id = (await sql(`insert into messages(room_id,sender_id,sender_name,type,content,burn_after_read) values ('${r}','${owner}','Creator','text','private',true) returning id`)).split('\n')[0];
    await sql('select * from cleanup_burn_messages()'); expect(await sql(`select count(*) from messages where id='${id}' and burn_expires_at is null`)).toBe('1');
    await expect(sql(`update messages set first_seen_at=now() where id='${id}'`)).rejects.toThrow('messages_burn_deadline');
    await expect(sql(`update messages set burn_expires_at=now() where id='${id}'`)).rejects.toThrow('messages_burn_deadline');
    await expect(sql(`select * from mark_message_seen('${r}','${id}','${owner}')`)).rejects.toThrow('SENDER_CANNOT_BURN');
    await expect(sql(`select * from mark_message_seen('${r}','${id}','${outsider}')`)).rejects.toThrow('JOIN_REQUIRED');
    const normal = (await sql(`insert into messages(room_id,sender_id,sender_name,type,content) values ('${r}','${owner}','Creator','text','keep') returning id`)).split('\n')[0];
    await expect(sql(`select * from mark_message_seen('${r}','${normal}','${guest}')`)).rejects.toThrow('NOT_BURNABLE');
  });
  it('sets exactly 60 seconds once, persists across connections and resists concurrent/repeated receipts',async () => {
    const owner = await session(); const guest = await session(); const r = await room(owner); await join(r,guest);
    const id = (await sql(`insert into messages(room_id,sender_id,sender_name,type,content,burn_after_read) values ('${r}','${owner}','Creator','text','burn',true) returning id`)).split('\n')[0];
    const receipts = await Promise.all(Array.from({ length: 8 },() => sql(`select burn_expires_at from mark_message_seen('${r}','${id}','${guest}')`)));
    expect(new Set(receipts).size).toBe(1); expect(await sql(`select extract(epoch from (burn_expires_at-first_seen_at)) from messages where id='${id}'`)).toBe('60.000000');
    expect(await sql(`select burn_expires_at from messages where id='${id}'`)).toBe(receipts[0]);
    await sql(`update room_members set left_at=now() where room_id='${r}' and sender_id='${guest}'`);
    // Advance persisted fixture time, rather than use a browser clock or wait a real minute.
    await sql(`with t as (select clock_timestamp()-interval '61 seconds' as seen) update messages set first_seen_at=t.seen,burn_expires_at=t.seen+interval '60 seconds' from t where id='${id}'`);
    await sql('select * from cleanup_burn_messages()'); await sql('select * from cleanup_burn_messages()');
    expect(await sql(`select count(*) from messages where id='${id}'`)).toBe('0');
  });
  it('queues burned attachment IDs durably and denies public burn RPC access',async () => {
    const owner = await session(); const guest = await session(); const r = await room(owner); await join(r,guest); const file = randomUUID();
    await sql(`insert into media_uploads(file_id,room_id,sender_id,file_url,file_path,file_name,file_size,mime_type,media_type) values ('${file}','${r}','${owner}','https://example.test/file','/burn/${file}','file.txt',2,'text/plain','file')`);
    const id = (await sql(`insert into messages(room_id,sender_id,sender_name,type,file_path,burn_after_read) values ('${r}','${owner}','Creator','file','/burn/${file}',true) returning id`)).split('\n')[0];
    await sql(`select * from mark_message_seen('${r}','${id}','${guest}')`);
    await sql(`with t as (select clock_timestamp()-interval '61 seconds' as seen) update messages set first_seen_at=t.seen,burn_expires_at=t.seen+interval '60 seconds' from t where id='${id}'`);
    await sql('select * from cleanup_burn_messages()'); expect(await sql(`select count(*) from media_cleanup where file_id='${file}'`)).toBe('1');
    await expect(sql('set role anon; select * from cleanup_burn_messages()')).rejects.toThrow('permission denied');
    await expect(sql(`set role authenticated; select * from mark_message_seen('${r}','${id}','${guest}')`)).rejects.toThrow('permission denied');
  });

});
