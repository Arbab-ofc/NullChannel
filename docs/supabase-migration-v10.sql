-- NullChannel migration v10 (burn-after-read messages)

alter table messages
  add column if not exists burn_after_read boolean not null default false;

create index if not exists idx_messages_burn_after_read on messages(burn_after_read);
