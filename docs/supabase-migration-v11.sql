-- Apply after the base schema and migrations v2-v10. Back up before applying.
-- No legacy UUID is claimed by a new session. Existing rows remain retained.
begin;
create table if not exists public.anonymous_sessions (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null unique,
  access_hash text not null unique check (length(access_hash) = 64),
  refresh_hash text not null unique check (length(refresh_hash) = 64),
  expires_at timestamptz not null,
  access_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.media_uploads (
  file_id text primary key,
  room_id uuid references public.rooms(id) on delete set null,
  sender_id text not null,
  file_url text not null,
  file_path text not null,
  file_name text not null,
  file_size integer not null check (file_size between 1 and 15728640),
  mime_type text not null,
  media_type text not null check (media_type in ('image','voice','file')),
  claimed boolean not null default false,
  created_at timestamptz not null default now()
);
-- Write-ahead upload intent survives an ambiguous provider response or database outage.
create table if not exists public.media_upload_intents (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  sender_id text not null,
  file_path text not null unique,
  created_at timestamptz not null default now()
);
alter table public.media_upload_intents add column if not exists attempts integer not null default 0;
alter table public.media_upload_intents add column if not exists next_attempt_at timestamptz not null default now();
alter table public.media_upload_intents add column if not exists lease_until timestamptz;
create index if not exists idx_sessions_expires on public.anonymous_sessions(expires_at);
create index if not exists idx_media_intents_created on public.media_upload_intents(created_at);
create table if not exists public.media_cleanup (
  file_id text primary key,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.messages add column if not exists file_id text;
-- Only IDs already known from the registry are used; paths/URLs are never guessed.
create unique index if not exists idx_media_uploads_path on public.media_uploads(file_path);
create index if not exists idx_media_uploads_pending on public.media_uploads(created_at) where not claimed;
create index if not exists idx_media_cleanup_due on public.media_cleanup(next_attempt_at);

create or replace function public.join_room(p_room uuid, p_sender text, p_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rooms; n integer;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.expires_at <= clock_timestamp() then raise exception 'ROOM_NOT_FOUND'; end if;
  if not exists (select 1 from public.anonymous_sessions where identity_id::text = p_sender and revoked_at is null and expires_at > clock_timestamp()) then raise exception 'SESSION_INVALID'; end if;
  if not exists (select 1 from public.room_members where room_id = p_room and sender_id = p_sender and left_at is null) and r.room_type = 'private' then
    select count(*) into n from public.room_members where room_id = p_room and left_at is null;
    -- Reserve the creator's slot even if they deliberately left or are a legacy identity.
    if not exists (select 1 from public.room_members where room_id = p_room and sender_id = r.creator_id and left_at is null) and p_sender <> r.creator_id then n := n + 1; end if;
    if n >= 2 then raise exception 'ROOM_FULL'; end if;
  end if;
  insert into public.room_members(room_id, sender_id, sender_name, left_at) values (p_room, p_sender, p_name, null)
    on conflict (room_id, sender_id) do update set sender_name = excluded.sender_name, left_at = null;
end $$;

create or replace function public.create_room(p_code text, p_sender text, p_name text, p_type text, p_room_name text, p_minutes integer)
returns setof public.rooms language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rooms;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_sender || ':' || p_type, 0));
  if p_minutes not in (15,60,360,1440) or p_type not in ('private','group') or length(p_code) <> 8 then raise exception 'VALIDATION_ERROR'; end if;
  if (select count(*) from public.rooms where creator_id = p_sender and room_type = p_type and expires_at > clock_timestamp()) >= 3 then raise exception 'ROOM_LIMIT_REACHED'; end if;
  insert into public.rooms(code, creator_id, room_type, room_name, expires_at) values (p_code, p_sender, p_type, p_room_name, clock_timestamp() + make_interval(mins => p_minutes)) returning * into r;
  perform public.join_room(r.id, p_sender, p_name);
  return next r;
end $$;
create or replace function public.extend_room(p_code text, p_sender text, p_minutes integer)
returns setof public.rooms language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rooms;
begin
  select * into r from public.rooms where code = p_code for update;
  if not found or r.expires_at <= clock_timestamp() then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.creator_id <> p_sender then raise exception 'FORBIDDEN'; end if;
  if r.expiry_extended then raise exception 'EXTENSION_USED'; end if;
  if p_minutes < 5 or p_minutes > 1440 then raise exception 'VALIDATION_ERROR'; end if;
  update public.rooms set expires_at = expires_at + make_interval(mins => p_minutes), expiry_extended = true where id = r.id returning * into r;
  return next r;
end $$;
revoke all on function public.create_room(text,text,text,text,text,integer), public.extend_room(text,text,integer) from public, anon, authenticated;
grant execute on function public.create_room(text,text,text,text,text,integer), public.extend_room(text,text,integer) to service_role;

create or replace function public.wipe_room(p_code text, p_sender text)
returns table(room_id uuid, code varchar, wiped_messages bigint, wiped_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rooms; n bigint; cutoff timestamptz;
begin
  select * into r from public.rooms where rooms.code = p_code for update;
  if not found or r.expires_at <= clock_timestamp() then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.creator_id <> p_sender then raise exception 'FORBIDDEN'; end if;
  cutoff := clock_timestamp();
  update public.rooms set pinned_message_id = null where id = r.id;
  delete from public.messages where messages.room_id = r.id;
  get diagnostics n = row_count;
  return query select r.id, r.code, n, cutoff;
end $$;
revoke all on function public.wipe_room(text,text) from public, anon, authenticated;
grant execute on function public.wipe_room(text,text) to service_role;

create or replace function public.queue_unused_upload(p_room uuid, p_sender text, p_path text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.media_uploads;
begin
  select * into u from public.media_uploads where room_id=p_room and sender_id=p_sender and file_path=p_path and not claimed for update;
  if found then insert into public.media_cleanup(file_id) values (u.file_id) on conflict do nothing; end if;
end $$;
revoke all on function public.queue_unused_upload(uuid,text,text) from public, anon, authenticated;
grant execute on function public.queue_unused_upload(uuid,text,text) to service_role;

-- A row lock serializes room operations with deletion, expiration and membership changes.
create or replace function public.guard_message_insert()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare r public.rooms; u public.media_uploads;
begin
  select * into r from public.rooms where id = new.room_id for update;
  if not found or r.expires_at <= clock_timestamp() then raise exception 'ROOM_NOT_FOUND'; end if;
  if not exists (select 1 from public.room_members where room_id = new.room_id and sender_id = new.sender_id and left_at is null) then raise exception 'JOIN_REQUIRED'; end if;
  if new.reply_to_message_id is not null and not exists (select 1 from public.messages where id = new.reply_to_message_id and room_id = new.room_id and not deleted) then raise exception 'INVALID_REPLY'; end if;
  if new.type <> 'text' then
    select * into u from public.media_uploads m where m.file_path = new.file_path and m.room_id = new.room_id and m.sender_id = new.sender_id and m.media_type = new.type and not m.claimed and not exists (select 1 from public.media_cleanup q where q.file_id = m.file_id) for update;
    if not found then raise exception 'INVALID_UPLOAD'; end if;
    update public.media_uploads set claimed = true where file_id = u.file_id;
    new.file_id := u.file_id; new.file_url := u.file_url; new.file_path := u.file_path;
    new.file_name := u.file_name; new.file_size := u.file_size; new.mime_type := u.mime_type;
  else
    new.file_id := null; new.file_url := null; new.file_path := null;
    new.file_name := null; new.file_size := null; new.mime_type := null;
  end if;
  new.created_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists guard_message_insert on public.messages;
create trigger guard_message_insert before insert on public.messages for each row execute function public.guard_message_insert();

create or replace function public.queue_message_media()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.file_id is not null and (tg_op = 'DELETE' or new.file_url is null) then
    insert into public.media_cleanup(file_id) values (old.file_id) on conflict do nothing;
    if tg_op = 'UPDATE' then new.file_id := null; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists queue_message_media on public.messages;
create trigger queue_message_media before delete or update on public.messages for each row execute function public.queue_message_media();

create or replace function public.claim_upload_intents()
returns setof public.media_upload_intents language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query update public.media_upload_intents set lease_until = now() + interval '5 minutes'
    where id in (select id from public.media_upload_intents where created_at < now() - interval '1 hour' and next_attempt_at <= now() and (lease_until is null or lease_until < now()) order by next_attempt_at limit 20 for update skip locked)
    returning *;
end $$;
revoke all on function public.claim_upload_intents() from public, anon, authenticated;
grant execute on function public.claim_upload_intents() to service_role;

create or replace function public.claim_media_cleanup()
returns setof public.media_cleanup language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.media_cleanup(file_id)
    select file_id from public.media_uploads where not claimed and (created_at < now() - interval '1 hour' or room_id is null)
    on conflict do nothing;
  return query update public.media_cleanup set lease_until = now() + interval '5 minutes'
    where file_id in (select file_id from public.media_cleanup where next_attempt_at <= now() and (lease_until is null or lease_until < now()) order by next_attempt_at limit 20 for update skip locked)
    returning *;
end $$;

create or replace function public.cleanup_expired_rooms()
returns table(id uuid, code varchar) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.anonymous_sessions s where s.id in
    (select x.id from public.anonymous_sessions x where x.expires_at <= clock_timestamp() or x.revoked_at < now() - interval '1 day' limit 1000);
  return query delete from public.rooms r where r.id in
    (select x.id from public.rooms x where expires_at <= clock_timestamp() order by expires_at limit 100 for update skip locked)
    and r.expires_at <= clock_timestamp() returning r.id, r.code;
end $$;

-- Service-role-only access, including RPCs. Remove permissive legacy policies.
do $$ declare t text; p record;
begin
  foreach t in array array['rooms','messages','room_members','message_reactions','anonymous_sessions','media_uploads','media_upload_intents','media_cleanup'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke all on function public.join_room(uuid,text,text), public.claim_media_cleanup(), public.cleanup_expired_rooms() from public, anon, authenticated;
grant execute on function public.join_room(uuid,text,text), public.claim_media_cleanup(), public.cleanup_expired_rooms() to service_role;
commit;
