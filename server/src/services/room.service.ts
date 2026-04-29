import { supabase } from '../config/supabase.js';
import { generateCode } from '../utils/generateCode.js';

const roomSelect = 'id, code, created_at, expires_at';

export const createRoom = async () => {
  for (let i = 0; i < 5; i += 1) {
    const code = generateCode();
    const { data, error } = await supabase.from('rooms').insert({ code }).select(roomSelect).single();
    if (!error && data) return data;
  }
  throw new Error('Failed to create room');
};

export const getRoomByCode = async (code: string) => {
  const { data } = await supabase
    .from('rooms')
    .select(roomSelect)
    .eq('code', code)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  return data;
};
