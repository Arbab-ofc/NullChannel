-- NullChannel migration v4 (separate private/group room modes)

alter table rooms add column if not exists room_type text;
update rooms set room_type = coalesce(room_type, 'private') where room_type is null;
alter table rooms alter column room_type set default 'private';
alter table rooms alter column room_type set not null;

alter table rooms drop constraint if exists rooms_room_type_check;
alter table rooms add constraint rooms_room_type_check check (room_type in ('private', 'group'));
