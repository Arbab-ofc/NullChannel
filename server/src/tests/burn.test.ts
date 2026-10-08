import { beforeEach, expect, it, vi } from 'vitest';
const { rpc, burned } = vi.hoisted(() => ({ rpc: vi.fn(),burned: vi.fn() }));
vi.mock('../config/supabase.js',() => ({ supabase: { rpc } }));
vi.mock('../services/media.service.js',() => ({ queueUnusedUpload: vi.fn(),deleteMediaByFileId: vi.fn(),recoverUploadIntents: vi.fn() }));
vi.mock('../sockets/emitter.js',() => ({ emitMessageBurned: burned }));
import { messageAvailable, markMessageSeen } from '../services/message.service.js';
import { cleanupBurnMessages } from '../services/cleanup.service.js';
beforeEach(() => vi.clearAllMocks());
it('keeps unseen/non-burn messages available and excludes overdue messages regardless of cleanup delay',() => {
  expect(messageAvailable({})).toBe(true); expect(messageAvailable({ burn_expires_at: null })).toBe(true);
  expect(messageAvailable({ burn_expires_at: new Date(Date.now()+60000).toISOString() })).toBe(true);
  expect(messageAvailable({ burn_expires_at: new Date(Date.now()-1).toISOString() })).toBe(false);
});
it('passes only server-authenticated identity to atomic seen RPC and propagates failures',async () => {
  rpc.mockResolvedValueOnce({ data: [{ first_seen_at: 'seen',burn_expires_at: 'deadline' }],error: null });
  expect(await markMessageSeen('room','message','identity')).toEqual({ first_seen_at: 'seen',burn_expires_at: 'deadline' });
  expect(rpc).toHaveBeenCalledWith('mark_message_seen',{ p_room: 'room',p_message: 'message',p_sender: 'identity' });
  rpc.mockResolvedValueOnce({ error: new Error('FORBIDDEN') }); await expect(markMessageSeen('room','message','intruder')).rejects.toThrow('FORBIDDEN');
});
it('broadcasts only deleted message identifiers and prevents overlapping burn cleanup',async () => {
  let release!: (value: unknown) => void; rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const work = cleanupBurnMessages(); await cleanupBurnMessages(); expect(rpc).toHaveBeenCalledTimes(1);
  release({ data: [{ id: 'message',room_id: 'room' }],error: null }); await work; expect(burned).toHaveBeenCalledWith('room',{ messageId: 'message' });
  rpc.mockResolvedValueOnce({ error: new Error('unavailable') }); await expect(cleanupBurnMessages()).rejects.toThrow('unavailable');
  rpc.mockResolvedValueOnce({ data: [],error: null }); await cleanupBurnMessages();
});
