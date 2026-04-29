create extension if not exists pgcrypto;

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code varchar(8) unique not null,
  creator_id text not null,
  room_type text not null default 'private' check (room_type in ('private', 'group')),
  room_name text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id text not null,
  sender_name text not null,
  type text not null check (type in ('text','image','voice')),
  content text,
  file_url text,
  file_path text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rooms_code on rooms(code);
create index if not exists idx_rooms_expires_at on rooms(expires_at);
create index if not exists idx_messages_room_id on messages(room_id);
create index if not exists idx_messages_created_at on messages(created_at);

create table if not exists room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id text not null,
  sender_name text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique(room_id, sender_id)
);

create index if not exists idx_room_members_sender_id on room_members(sender_id);
create index if not exists idx_room_members_room_id on room_members(room_id);

alter table rooms enable row level security;
alter table messages enable row level security;
alter table room_members enable row level security;
