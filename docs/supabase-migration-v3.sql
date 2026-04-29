-- NullChannel migration v3 (required display names for multi-user rooms)

alter table messages add column if not exists sender_name text;
update messages set sender_name = coalesce(sender_name, 'Anonymous') where sender_name is null;
alter table messages alter column sender_name set not null;

alter table room_members add column if not exists sender_name text;
update room_members set sender_name = coalesce(sender_name, 'Anonymous') where sender_name is null;
alter table room_members alter column sender_name set not null;
