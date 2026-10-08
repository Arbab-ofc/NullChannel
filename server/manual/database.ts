import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;
type Result = { data: Row[] | Row | null; error: { message: string } | null; count: number };
export const MANUAL_ROOM_CODE = 'TEST1234';
/** A deliberately small, disposable adapter. This module is outside the production build. */
export const createManualDatabase = () => {
  const room: Row = { id: randomUUID(),code: MANUAL_ROOM_CODE,room_type: 'private',room_name: 'Local voice test',creator_id: null,
    created_at: new Date().toISOString(),expires_at: new Date(Date.now()+24*3600000).toISOString(),expiry_extended: false,pinned_message_id: null };
  const tables = new Map<string,Row[]>([['rooms',[room]],['anonymous_sessions',[]],['room_members',[]],['messages',[]],['message_reactions',[]]]);
  const activeRoom = (id: unknown) => tables.get('rooms')!.find(row => row.id === id && Date.parse(String(row.expires_at)) > Date.now());
  const member = (id: unknown, identity: unknown) => tables.get('room_members')!.find(row => row.room_id === id && row.sender_id === identity && row.left_at === null);
  const from = (table: string) => {
    if (!tables.has(table)) throw new Error(`Unsupported local fixture table: ${table}`);
    const filters: Array<(row: Row) => boolean> = [];
    let mutation: 'insert' | 'update' | 'delete' | undefined; let values: Row[] = []; let maximum = Infinity;
    let ordering: { field: string; ascending: boolean } | undefined;
    const execute = (single = false): Result => {
      const rows = tables.get(table)!;
      if (mutation === 'insert') {
        if (table === 'anonymous_sessions' && rows.length+values.length > 32) return { data: null,error: { message: 'Local fixture session capacity reached. Restart the harness.' },count: 0 };
        if (table === 'messages' && rows.length+values.length > 500) return { data: null,error: { message: 'Local fixture message capacity reached. Restart the harness.' },count: 0 };
        const inserted: Row[] = [];
        for (const value of values) {
          if (table === 'messages' && (!activeRoom(value.room_id) || !member(value.room_id,value.sender_id) || value.type !== 'text')) return { data: null,error: { message: 'Only joined local text messages are supported.' },count: 0 };
          const row: Row = { id: randomUUID(),created_at: new Date().toISOString(),revoked_at: null,deleted: false,...value }; rows.push(row); inserted.push(row);
          if (table === 'anonymous_sessions' && tables.get('room_members')!.length === 0 && activeRoom(room.id)) {
            const first = tables.get('room_members')!.length === 0;
            if (first) room.creator_id = row.identity_id;
            tables.get('room_members')!.push({ id: randomUUID(),room_id: room.id,sender_id: row.identity_id,sender_name: first ? 'Alice' : 'Bob',joined_at: new Date().toISOString(),left_at: null });
          }
        }
        return { data: single ? inserted[0] ?? null : inserted.map(row => ({ ...row })),error: null,count: inserted.length };
      }
      let selected = rows.filter(row => filters.every(filter => filter(row)));
      if (ordering) { const { field,ascending } = ordering; selected.sort((a,b) => String(a[field]).localeCompare(String(b[field]))*(ascending ? 1 : -1)); }
      selected = selected.slice(0,maximum);
      if (mutation === 'update') selected.forEach(row => Object.assign(row,values[0]));
      if (mutation === 'delete') { const deleted = new Set(selected); tables.set(table,rows.filter(row => !deleted.has(row))); }
      return { data: single ? selected[0] ? { ...selected[0] } : null : selected.map(row => ({ ...row })),error: null,count: selected.length };
    };
    const query = {
      select: (_columns?: string, _options?: unknown) => query,
      eq: (field: string,value: unknown) => { filters.push(row => row[field] === value); return query; },
      is: (field: string,value: unknown) => { filters.push(row => row[field] === value); return query; },
      in: (field: string,values: unknown[]) => { filters.push(row => values.includes(row[field])); return query; },
      gt: (field: string,value: string) => { filters.push(row => String(row[field]) > value); return query; },
      order: (field: string,options?: { ascending: boolean }) => { ordering = { field,ascending: options?.ascending ?? true }; return query; },
      limit: (count: number) => { maximum = count; return query; },
      insert: (value: Row | Row[]) => { mutation = 'insert'; values = Array.isArray(value) ? value : [value]; return query; },
      update: (value: Row) => { mutation = 'update'; values = [value]; return query; },
      delete: (_options?: unknown) => { mutation = 'delete'; return query; },
      maybeSingle: async () => execute(true), single: async () => execute(true),
      then: (resolve: (result: Result) => unknown,reject?: (error: unknown) => unknown) => Promise.resolve().then(() => execute()).then(resolve,reject)
    };
    return query;
  };
  const rpc = async (operation: string,args: Row) => {
    if (operation === 'join_room') {
      const currentRoom = activeRoom(args.p_room); if (!currentRoom) return { data: null,error: { message: 'ROOM_NOT_FOUND' } };
      const members = tables.get('room_members')!; const existing = members.find(row => row.room_id === args.p_room && row.sender_id === args.p_sender);
      const others = members.filter(row => row.room_id === args.p_room && row.left_at === null && row.sender_id !== currentRoom.creator_id && row.sender_id !== args.p_sender);
      if (args.p_sender !== currentRoom.creator_id && others.length >= 1) return { data: null,error: { message: 'ROOM_FULL' } };
      if (existing) Object.assign(existing,{ left_at: null,sender_name: args.p_name });
      else members.push({ id: randomUUID(),room_id: args.p_room,sender_id: args.p_sender,sender_name: args.p_name,joined_at: new Date().toISOString(),left_at: null });
      return { data: null,error: null };
    }
    if (operation === 'extend_room') {
      const current = tables.get('rooms')!.find(row => row.code === args.p_code && activeRoom(row.id));
      if (!current) return { data: null,error: { message: 'ROOM_NOT_FOUND' } };
      if (current.creator_id !== args.p_sender) return { data: null,error: { message: 'FORBIDDEN' } };
      if (current.expiry_extended) return { data: null,error: { message: 'EXTENSION_USED' } };
      current.expiry_extended = true; current.expires_at = new Date(Date.parse(String(current.expires_at))+Number(args.p_minutes)*60000).toISOString();
      return { data: [{ ...current }],error: null };
    }
    return { data: null,error: { message: `Unsupported local fixture operation: ${operation}` } };
  };
  return { from,rpc,room };
};
