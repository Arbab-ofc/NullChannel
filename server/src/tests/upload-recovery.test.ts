import type { Express } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { upload, listFiles, rpc, from, insert, remove, upsert, query } = vi.hoisted(() => {
  const query = { data: [] as unknown, error: null as unknown };
  const chain: Record<string, unknown> = {};
  for (const method of ['select','eq','lt','order','limit']) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => query);
  chain.then = (resolve: (value: unknown) => void) => Promise.resolve(query).then(resolve);
  const insert = vi.fn(() => chain); const remove = vi.fn(() => chain); const upsert = vi.fn(() => chain);
  chain.insert = insert; chain.delete = remove; chain.upsert = upsert;
  return { upload: vi.fn(), listFiles: vi.fn(), rpc: vi.fn(), from: vi.fn(() => chain), insert, remove, upsert, query };
});
vi.mock('../config/supabase.js', () => ({ supabase: { from, rpc } }));
vi.mock('../config/imagekit.js', () => ({ imagekit: { upload, listFiles } }));
import { queueUnusedUpload, recoverUploadIntents, uploadMedia } from '../services/media.service.js';
beforeEach(() => { vi.clearAllMocks(); query.data = []; query.error = null; });
describe('upload recovery and ownership', () => {
  it('records intent before uploading and uses a deterministic random file path', async () => {
    upload.mockResolvedValue({ fileId: 'provider-id', filePath: '/provider/path', url: 'https://media.test/file' });
    const file = { originalname: 'private name.txt', buffer: Buffer.from('hello') } as Express.Multer.File;
    const result = await uploadMedia(file,'/nullchannel/test1234','room','identity');
    expect(insert.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0]);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ room_id: 'room', sender_id: 'identity', file_path: expect.stringMatching(/^\/nullchannel\/test1234\/[0-9a-f-]+\.txt$/) }));
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ useUniqueFileName: false })); expect(result.fileId).toBe('provider-id');
    expect(upload.mock.calls[0][0].fileName).not.toContain('private name');
  });
  it('does not upload when durable intent storage fails', async () => {
    query.error = new Error('database unavailable');
    await expect(uploadMedia({ originalname: 'x.txt', buffer: Buffer.from('x') } as Express.Multer.File,'/nullchannel/test1234','room','identity')).rejects.toThrow('database unavailable');
    expect(upload).not.toHaveBeenCalled();
  });
  it('retains the intent after an ambiguous provider failure', async () => {
    upload.mockRejectedValue(new Error('connection lost'));
    await expect(uploadMedia({ originalname: 'x.txt', buffer: Buffer.from('x') } as Express.Multer.File,'/nullchannel/test1234','room','identity')).rejects.toThrow('connection lost');
    expect(remove).not.toHaveBeenCalled();
  });
  it('recovers only an exact provider-confirmed path and actual file ID', async () => {
    query.data = [{ id: 'intent', file_path: '/nullchannel/test1234/generated.txt', attempts: 0 }];
    rpc.mockResolvedValue(query);
    listFiles.mockResolvedValue([{ type: 'file', filePath: '/nullchannel/test1234/other.txt', fileId: 'unrelated' },{ type: 'file', filePath: '/nullchannel/test1234/generated.txt', fileId: 'actual-id' }]);
    // Registry lookup for the intended file reports missing.
    from.mockReset();
    const registry = { maybeSingle: vi.fn(async () => ({ data: null, error: null })) };
    const chain: Record<string, unknown> = { then: (resolve: (v: unknown) => void) => Promise.resolve(query).then(resolve), eq: vi.fn(async () => ({ error: null })), delete: remove, upsert };
    for (const method of ['select','lt','order','limit']) chain[method] = () => chain;
    from.mockImplementation((table?: string) => table === 'media_uploads' ? { select: () => ({ eq: () => registry }) } as never : chain as never);
    await recoverUploadIntents();
    expect(upsert).toHaveBeenCalledWith({ file_id: 'actual-id' }, expect.anything());
    expect(JSON.stringify(upsert.mock.calls)).not.toContain('unrelated');
  });
  it('queues a failed message upload through an atomic owner-scoped RPC', async () => {
    rpc.mockResolvedValue({ error: null }); await queueUnusedUpload('room','identity','/safe/path');
    expect(rpc).toHaveBeenCalledWith('queue_unused_upload',{ p_room: 'room', p_sender: 'identity', p_path: '/safe/path' });
  });
});
