import { beforeEach, describe, expect, it, vi } from 'vitest';
const { post, reload } = vi.hoisted(() => ({ post: vi.fn(), reload: vi.fn() }));
vi.mock('axios', () => ({ default: { post } }));
vi.mock('../lib/constants', () => ({ API_URL: '' }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal('window',{ location: { reload } }); });
describe('browser anonymous session lifecycle', () => {
  it('initializes through the backend with HttpOnly cookie transport', async () => {
    post.mockResolvedValue({ data: { data: { identityId: 'server-identity' } } });
    const { ensureSession, currentIdentity } = await import('../lib/session');
    expect(currentIdentity()).toBe(''); expect(await ensureSession()).toBe('server-identity');
    expect(post).toHaveBeenCalledWith('/api/session',{}, { withCredentials: true });
  });
  it('deduplicates simultaneous bootstraps and preserves identity on renewal', async () => {
    post.mockResolvedValue({ data: { data: { identityId: 'persistent' } } });
    const { ensureSession, currentIdentity } = await import('../lib/session');
    await Promise.all([ensureSession(),ensureSession(),ensureSession()]); expect(post).toHaveBeenCalledTimes(1);
    await ensureSession(); expect(currentIdentity()).toBe('persistent'); expect(reload).not.toHaveBeenCalled();
  });
  it('reloads on identity transition instead of reusing old ownership', async () => {
    post.mockResolvedValueOnce({ data: { data: { identityId: 'old' } } }).mockResolvedValueOnce({ data: { data: { identityId: 'new' } } });
    const { ensureSession } = await import('../lib/session'); await ensureSession();
    await expect(ensureSession()).rejects.toThrow('Anonymous identity changed'); expect(reload).toHaveBeenCalledOnce();
  });
  it('allows retry after a failed session initialization', async () => {
    post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { data: { identityId: 'ready' } } });
    const { ensureSession } = await import('../lib/session');
    await expect(ensureSession()).rejects.toThrow('offline'); expect(await ensureSession()).toBe('ready');
  });
});
