-- NullChannel migration v7 (message replies and reactions)

alter table messages
  add column if not exists reply_to_message_id uuid references messages(id) on delete set null;

create index if not exists idx_messages_reply_to_message_id on messages(reply_to_message_id);

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  sender_id text not null,
  sender_name text not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique(message_id, sender_id, emoji)
);

create index if not exists idx_message_reactions_message_id on message_reactions(message_id);
create index if not exists idx_message_reactions_sender_id on message_reactions(sender_id);

alter table message_reactions enable row level security;
