-- NullChannel migration v6 (one-time room expiry extension)

alter table rooms add column if not exists expiry_extended boolean not null default false;
