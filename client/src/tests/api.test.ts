import { beforeEach, describe, expect, it, vi } from 'vitest';
const { capture, request, renew } = vi.hoisted(() => ({ capture: vi.fn(), request: vi.fn(), renew: vi.fn() }));
vi.mock('axios', () => ({ default: { create: vi.fn(() => ({ interceptors: { response: { use: capture } }, request })) } }));
vi.mock('../lib/constants', () => ({ API_URL: '' }));
vi.mock('../lib/session', () => ({ ensureSession: renew }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
describe('API expiry and failure handling', () => {
  it('renews an expired credential and retries exactly once', async () => {
    await import('../lib/api'); renew.mockResolvedValue('identity'); request.mockResolvedValue({ status: 200 });
    const failure = capture.mock.calls[0][1]; const config = { url: '/rooms' };
    expect(await failure({ response: { status: 401 }, config })).toEqual({ status: 200 });
    expect(renew).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledWith(expect.objectContaining({ sessionRetried: true }));
    await expect(failure({ response: { status: 401 }, config })).rejects.toMatchObject({ response: { status: 401 } });
    expect(renew).toHaveBeenCalledOnce();
  });
  it('preserves upload and room-expired errors for the UI to report', async () => {
    await import('../lib/api'); const failure = capture.mock.calls[0][1];
    for (const status of [413,404,503]) await expect(failure({ response: { status }, config: {} })).rejects.toMatchObject({ response: { status } });
    expect(renew).not.toHaveBeenCalled();
  });
  it('does not replay a request when renewal itself fails', async () => {
    await import('../lib/api'); renew.mockRejectedValue(new Error('session unavailable'));
    await expect(capture.mock.calls[0][1]({ response: { status: 401 }, config: {} })).rejects.toThrow('session unavailable');
    expect(request).not.toHaveBeenCalled();
  });
});
