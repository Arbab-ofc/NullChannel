create extension if not exists pgcrypto;

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code varchar(8) unique not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id text not null,
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

alter table rooms enable row level security;
alter table messages enable row level security;
