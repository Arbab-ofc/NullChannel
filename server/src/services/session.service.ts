import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { supabase } from '../config/supabase.js';

export const ACCESS_MS = 15 * 60 * 1000;
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const readCookie = (header: string | undefined, name: string) => {
  const value = header?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
};
export const verifySession = async (token: string | undefined) => {
  if (!token) return null;
  const { data, error } = await supabase.from('anonymous_sessions').select('id, identity_id, expires_at, access_expires_at, revoked_at').eq('access_hash', hashToken(token)).maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || Date.parse(data.expires_at) <= Date.now() || Date.parse(data.access_expires_at) <= Date.now()) return null;
  return data;
};
export const renewSession = async (refresh: string | undefined, currentAccess?: string) => {
  if (refresh) {
    // Reuse a proven existing access token while renewing its short expiry, avoiding
    // cross-tab rotations. The refresh credential and current access hash must both match.
    if (currentAccess) {
      const { data, error } = await supabase.from('anonymous_sessions').update({ access_expires_at: new Date(Date.now() + ACCESS_MS).toISOString() })
        .eq('refresh_hash', hashToken(refresh)).eq('access_hash', hashToken(currentAccess)).is('revoked_at', null).gt('expires_at', new Date().toISOString()).select('identity_id, expires_at').maybeSingle();
      if (error) throw error;
      if (data) return { ...data, access: currentAccess, refresh };
    }
    const access = randomBytes(32).toString('hex');
    const { data, error } = await supabase.from('anonymous_sessions').update({ access_hash: hashToken(access), access_expires_at: new Date(Date.now() + ACCESS_MS).toISOString() })
      .eq('refresh_hash', hashToken(refresh)).is('revoked_at', null).gt('expires_at', new Date().toISOString()).select('identity_id, expires_at').maybeSingle();
    if (error) throw error;
    if (data) return { ...data, access, refresh };
  }
  const access = randomBytes(32).toString('hex');
  const refreshToken = randomBytes(32).toString('hex');
  const identity = randomUUID();
  const expires = new Date(Date.now() + SESSION_MS).toISOString();
  const { error } = await supabase.from('anonymous_sessions').insert({ identity_id: identity, access_hash: hashToken(access), refresh_hash: hashToken(refreshToken), expires_at: expires, access_expires_at: new Date(Date.now() + ACCESS_MS).toISOString() });
  if (error) throw error;
  return { identity_id: identity, expires_at: expires, access, refresh: refreshToken };
};
