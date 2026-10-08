import axios from 'axios';
import { API_URL } from './constants';
let identity = '';
let pending: Promise<string> | undefined;
export const currentIdentity = () => identity;
export const ensureSession = () => {
  if (!pending) {
    const send = () => axios.post(`${API_URL}/api/session`, {}, { withCredentials: true });
    // Coordinate bootstrapping across tabs without exposing cookie credentials.
    const response = async () => {
      if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request('nullchannel-session', send);
      return await send();
    };
    pending = response().then(response => {
      const next = response.data.data.identityId as string;
      if (identity && identity !== next) { window.location.reload(); throw new Error('Anonymous identity changed'); }
      identity = next;
      return identity;
    }).finally(() => { pending = undefined; });
  }
  return pending;
};
