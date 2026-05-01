-- NullChannel migration v9 (persistent message deletion tombstones)

alter table messages
  add column if not exists deleted boolean not null default false,
  add column if not exists deleted_by text,
  add column if not exists deleted_by_name text,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_messages_deleted on messages(deleted);
