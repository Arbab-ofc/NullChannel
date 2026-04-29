-- NullChannel migration v5 (room names required)

alter table rooms add column if not exists room_name text;
update rooms set room_name = coalesce(room_name, 'Untitled Room') where room_name is null;
alter table rooms alter column room_name set not null;
