import { io } from 'socket.io-client';
import { API_URL } from './constants';
import { ensureSession } from './session';
export const socket = io(API_URL || undefined, { autoConnect: false, reconnection: true, withCredentials: true });
let renewing = false;
let desired = false;
export const connectSocket = () => { desired = true; socket.connect(); };
export const disconnectSocket = () => { desired = false; socket.disconnect(); };
const renew = async () => {
  if (renewing || !desired) return;
  renewing = true;
  try { await ensureSession(); if (desired) socket.connect(); }
  catch { /* The next automatic reconnect or foreground renewal can retry. */ }
  finally { renewing = false; }
};
socket.on('connect_error', error => {
  if (error.message === 'SESSION_EXPIRED') void renew();
});
socket.on('disconnect', reason => { if (reason === 'io server disconnect') void renew(); });
