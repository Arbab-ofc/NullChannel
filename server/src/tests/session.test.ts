import { beforeEach, describe, expect, it, vi } from 'vitest';
const { chain, from } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select','eq','is','gt','update']) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(); chain.insert = vi.fn();
  return { chain, from: vi.fn(() => chain) };
});
vi.mock('../config/supabase.js', () => ({ supabase: { from } }));
import { hashToken, readCookie, renewSession, verifySession } from '../services/session.service.js';
beforeEach(() => { vi.clearAllMocks(); });
describe('anonymous sessions', () => {
  it('creates server-issued random credentials and stores only hashes', async () => {
    chain.insert.mockResolvedValue({ error: null });
    const a = await renewSession(undefined); const b = await renewSession(undefined);
    expect(a.identity_id).not.toBe(b.identity_id); expect(a.access).not.toBe(b.access);
    expect(a.refresh).toMatch(/^[a-f0-9]{64}$/);
    const saved = chain.insert.mock.calls[0][0];
    expect(saved.access_hash).toBe(hashToken(a.access)); expect(saved.refresh_hash).toBe(hashToken(a.refresh));
    expect(JSON.stringify(saved)).not.toContain(a.access); expect(JSON.stringify(saved)).not.toContain(a.refresh);
  });
  it('verifies opaque access hashes and never a submitted UUID', async () => {
    const data = { id: 'session', identity_id: 'identity', expires_at: new Date(Date.now()+60000).toISOString(), access_expires_at: new Date(Date.now()+30000).toISOString(), revoked_at: null };
    chain.maybeSingle.mockResolvedValue({ data, error: null });
    expect(await verifySession('a'.repeat(64))).toBe(data);
    expect(chain.eq).toHaveBeenCalledWith('access_hash', hashToken('a'.repeat(64)));
    expect(await verifySession(undefined)).toBeNull();
  });
  it.each(['expired', 'access-expired', 'revoked', 'missing'])('rejects %s credentials', async kind => {
    const data = kind === 'missing' ? null : { expires_at: new Date(Date.now()+(kind === 'expired' ? -1 : 60000)).toISOString(), access_expires_at: new Date(Date.now()+(kind === 'access-expired' ? -1 : 60000)).toISOString(), revoked_at: kind === 'revoked' ? 'now' : null };
    chain.maybeSingle.mockResolvedValue({ data, error: null }); expect(await verifySession('a'.repeat(64))).toBeNull();
  });
  it('fails closed on a database failure', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: new Error('db unavailable') });
    await expect(verifySession('a'.repeat(64))).rejects.toThrow('db unavailable');
  });
  it('renewal preserves a verified identity with fresh short-lived access', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { identity_id: 'verified', expires_at: new Date(Date.now()+60000).toISOString() }, error: null });
    const renewed = await renewSession('b'.repeat(64)); expect(renewed.identity_id).toBe('verified');
    expect(chain.eq).toHaveBeenCalledWith('refresh_hash', hashToken('b'.repeat(64)));
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null);
  });
  it('renews a proven current access token without breaking other tabs', async () => {
    chain.maybeSingle.mockResolvedValue({ data: { identity_id: 'verified', expires_at: new Date(Date.now()+60000).toISOString() }, error: null });
    const renewed = await renewSession('b'.repeat(64),'a'.repeat(64));
    expect(renewed.access).toBe('a'.repeat(64));
    expect(chain.eq).toHaveBeenCalledWith('refresh_hash', hashToken('b'.repeat(64)));
    expect(chain.eq).toHaveBeenCalledWith('access_hash', hashToken('a'.repeat(64)));
  });
  it('does not adopt invalid refresh credentials as an old identity', async () => {
    chain.maybeSingle.mockResolvedValue({ data: null, error: null }); chain.insert.mockResolvedValue({ error: null });
    const renewed = await renewSession('b'.repeat(64)); expect(renewed.refresh).not.toBe('b'.repeat(64));
  });
  it('parses only correctly sized opaque cookies', () => {
    expect(readCookie('nc_access=legacy-uuid', 'nc_access')).toBeUndefined();
    expect(readCookie(`other=1; nc_access=${'a'.repeat(64)}`, 'nc_access')).toBe('a'.repeat(64));
  });
});
