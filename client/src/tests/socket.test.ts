import { beforeEach, describe, expect, it, vi } from 'vitest';
const { events, connect, disconnect, renew, io } = vi.hoisted(() => {
  const events = new Map<string, (payload: unknown) => void>();
  const connect = vi.fn(); const disconnect = vi.fn();
  const socket = { connect, disconnect, on: vi.fn((event: string, handler: (payload: unknown) => void) => events.set(event,handler)) };
  return { events, connect, disconnect, renew: vi.fn(), io: vi.fn(() => socket) };
});
vi.mock('socket.io-client', () => ({ io }));
vi.mock('../lib/constants', () => ({ API_URL: '' }));
vi.mock('../lib/session', () => ({ ensureSession: renew }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); events.clear(); });
describe('socket lifecycle and session renewal', () => {
  it('uses cookie credentials, automatic reconnection and a single socket instance', async () => {
    const a = await import('../lib/socket'); const b = await import('../lib/socket');
    expect(a.socket).toBe(b.socket); expect(io).toHaveBeenCalledOnce();
    expect(io).toHaveBeenCalledWith(undefined,expect.objectContaining({ autoConnect: false, reconnection: true, withCredentials: true }));
  });
  it('reauthenticates an expired handshake before reconnecting', async () => {
    const { connectSocket } = await import('../lib/socket'); connectSocket(); renew.mockResolvedValue('identity');
    events.get('connect_error')!(new Error('SESSION_EXPIRED')); await new Promise(resolve => setTimeout(resolve,0));
    expect(renew).toHaveBeenCalledOnce(); expect(connect).toHaveBeenCalledTimes(2);
  });
  it('does not reconnect after unmount while session renewal is pending', async () => {
    let finish!: (value: string) => void;
    renew.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { connectSocket, disconnectSocket } = await import('../lib/socket'); connectSocket();
    events.get('disconnect')!('io server disconnect'); disconnectSocket(); finish('identity');
    await new Promise(resolve => setTimeout(resolve,0)); expect(connect).toHaveBeenCalledOnce(); expect(disconnect).toHaveBeenCalledOnce();
  });
});
