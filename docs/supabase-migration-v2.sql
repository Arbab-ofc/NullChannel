-- NullChannel migration v2 (creator ownership + memberships)

alter table rooms add column if not exists creator_id text;

-- Backfill creator_id for existing rows to keep NOT NULL safe.
-- You can replace this with a more meaningful value if needed.
update rooms
set creator_id = coalesce(creator_id, 'legacy-room-owner')
where creator_id is null;

alter table rooms alter column creator_id set not null;

create table if not exists room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique(room_id, sender_id)
);

create index if not exists idx_room_members_sender_id on room_members(sender_id);
create index if not exists idx_room_members_room_id on room_members(room_id);

alter table room_members enable row level security;
