-- Apply after v11, before starting the UX release backend. Existing data is preserved.
begin;
-- Fail and roll back rather than wait indefinitely behind a live transaction.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public, pg_temp;
-- v11 triggers are required for authenticated inserts and durable attachment deletion.
-- Refuse a drifted schema rather than allow cleanup to lose provider deletion IDs.
do $$ begin
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.messages'::regclass
    and tgname='queue_message_media' and tgfoid='public.queue_message_media()'::regprocedure
    and tgenabled in ('O','A') and tgtype=27 and not tgisinternal)
    or not exists (select 1 from pg_catalog.pg_trigger where tgrelid='public.messages'::regclass
    and tgname='guard_message_insert' and tgfoid='public.guard_message_insert()'::regprocedure
    and tgenabled in ('O','A') and tgtype=7 and not tgisinternal) then
    raise exception 'V11_TRIGGER_PREREQUISITE_MISSING';
  end if;
end $$;
alter table public.messages add column if not exists first_seen_at timestamptz;
alter table public.messages add column if not exists burn_expires_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.messages'::regclass and conname='messages_burn_deadline') then
    alter table public.messages add constraint messages_burn_deadline check (
      (first_seen_at is null and burn_expires_at is null) or
      (burn_after_read and first_seen_at is not null and burn_expires_at is not null and burn_expires_at = first_seen_at + interval '60 seconds'));
  end if;
end $$;
create index if not exists idx_messages_burn_due on public.messages(burn_expires_at) where burn_expires_at is not null;

create or replace function public.mark_message_seen(p_room uuid, p_message uuid, p_sender text)
returns table(first_seen_at timestamptz, burn_expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare r public.rooms; m public.messages; seen timestamptz;
begin
  select * into r from public.rooms where id=p_room for update;
  if not found or r.expires_at <= clock_timestamp() then raise exception 'ROOM_NOT_FOUND'; end if;
  -- Serialize receipt commit with session revocation/renewal as well as explicit leave.
  perform 1 from public.anonymous_sessions where identity_id::text=p_sender and revoked_at is null
    and expires_at>clock_timestamp() and access_expires_at>clock_timestamp() for share;
  if not found then raise exception 'SESSION_INVALID'; end if;
  -- Hold membership stable until the receipt commits; explicit leave updates wait.
  perform 1 from public.room_members where room_id=p_room and sender_id=p_sender and left_at is null for share;
  if not found then raise exception 'JOIN_REQUIRED'; end if;
  select * into m from public.messages where id=p_message and room_id=p_room for update;
  if not found or m.deleted or (m.burn_expires_at is not null and m.burn_expires_at <= clock_timestamp()) then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if not m.burn_after_read then raise exception 'NOT_BURNABLE'; end if;
  if m.sender_id=p_sender then raise exception 'SENDER_CANNOT_BURN'; end if;
  if m.first_seen_at is null then
    seen := clock_timestamp();
    update public.messages set first_seen_at=seen, burn_expires_at=seen+interval '60 seconds' where id=m.id returning * into m;
  end if;
  return query select m.first_seen_at,m.burn_expires_at;
end $$;

create or replace function public.cleanup_burn_messages()
returns table(id uuid, room_id uuid)
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  -- Acquire room locks first, matching seen/wipe/insert lock order. Multiple workers skip leased rows.
  return query with candidate_rooms as materialized (
    select r.id from public.rooms r where exists (
      select 1 from public.messages m where m.room_id=r.id and m.burn_expires_at<=clock_timestamp()
    ) order by r.id limit 50 for update skip locked
  ), doomed as materialized (
    select m.id from public.messages m join candidate_rooms r on r.id=m.room_id
    where m.burn_expires_at<=clock_timestamp() order by m.burn_expires_at limit 500 for update of m skip locked
  ) delete from public.messages m using doomed d where m.id=d.id returning m.id,m.room_id;
  -- Existing queue_message_media trigger persists file IDs before deletion.
end $$;
revoke all on function public.mark_message_seen(uuid,uuid,text), public.cleanup_burn_messages() from public, anon, authenticated;
grant execute on function public.mark_message_seen(uuid,uuid,text), public.cleanup_burn_messages() to service_role;
-- Detect inherited/owner grants that ordinary REVOKE would not remove.
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated'] loop
    if pg_catalog.has_function_privilege(role_name,'public.mark_message_seen(uuid,uuid,text)','EXECUTE')
      or pg_catalog.has_function_privilege(role_name,'public.cleanup_burn_messages()','EXECUTE') then
      raise exception 'UNSAFE_BURN_RPC_GRANTS';
    end if;
  end loop;
end $$;
-- Delivered only after commit; refresh Supabase/PostgREST metadata for new RPCs/columns.
notify pgrst, 'reload schema';
commit;
