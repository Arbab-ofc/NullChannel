-- NullChannel migration v8 (pinned messages and file metadata)

alter table messages
  add column if not exists file_name text,
  add column if not exists file_size integer,
  add column if not exists mime_type text;

alter table messages drop constraint if exists messages_type_check;
alter table messages add constraint messages_type_check check (type in ('text','image','voice','file'));

alter table rooms
  add column if not exists pinned_message_id uuid references messages(id) on delete set null;

create index if not exists idx_rooms_pinned_message_id on rooms(pinned_message_id);
