import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, from, update, remove, deleteMedia, expired } = vi.hoisted(() => {
  const update = vi.fn(); const remove = vi.fn();
  const chain = { eq: vi.fn(async () => ({ error: null })), in: vi.fn(async () => ({ error: null, count: 1 })) };
  update.mockReturnValue(chain); remove.mockReturnValue(chain);
  return { rpc: vi.fn(), from: vi.fn(() => ({ update, delete: remove })), update, remove, deleteMedia: vi.fn(), expired: vi.fn() };
});
vi.mock('../config/supabase.js', () => ({ supabase: { from, rpc } }));
vi.mock('../services/media.service.js', () => ({ deleteMediaByFileId: deleteMedia, recoverUploadIntents: vi.fn(async () => undefined) }));
vi.mock('../sockets/emitter.js', () => ({ emitRoomExpired: expired, emitRoomExpiredByCode: expired }));
import { cleanupExpiredRooms, cleanupRoomsByIds, processMediaCleanup } from '../services/cleanup.service.js';
beforeEach(() => { vi.clearAllMocks(); });
describe('durable media and lifecycle cleanup', () => {
  it('continues the batch after a transient failure and records backoff', async () => {
    rpc.mockResolvedValue({ data: [{ file_id: 'actual-file-id-1', attempts: 0 },{ file_id: 'actual-file-id-2', attempts: 1 }], error: null });
    deleteMedia.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce(undefined);
    await processMediaCleanup(); expect(deleteMedia).toHaveBeenNthCalledWith(2,'actual-file-id-2');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, lease_until: null }));
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it('treats already-deleted provider files as successful retries', async () => {
    rpc.mockResolvedValue({ data: [{ file_id: 'already-gone', attempts: 3 }], error: null });
    deleteMedia.mockRejectedValue({ statusCode: 404 }); await processMediaCleanup(); expect(remove).toHaveBeenCalledTimes(2); expect(update).not.toHaveBeenCalled();
  });
  it('fails closed if queue claiming or room deletion fails', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('database failed') });
    await expect(processMediaCleanup()).rejects.toThrow('database failed'); expect(deleteMedia).not.toHaveBeenCalled();
    from.mockReturnValueOnce({ delete: vi.fn(() => ({ in: vi.fn(async () => ({ error: new Error('delete failed') })) })) } as never);
    await expect(cleanupRoomsByIds(['room'])).rejects.toThrow('delete failed');
  });
  it('prevents overlapping runs and resumes after a failed run', async () => {
    let release!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const running = cleanupExpiredRooms(); expect(await cleanupExpiredRooms()).toEqual({ removedRooms: 0 });
    release({ data: null, error: new Error('temporary') }); await expect(running).rejects.toThrow('temporary');
    rpc.mockResolvedValue({ data: [], error: null }); expect(await cleanupExpiredRooms()).toEqual({ removedRooms: 0 });
  });
});
