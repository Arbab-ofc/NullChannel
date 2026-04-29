const te = new TextEncoder();
const td = new TextDecoder();

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const ub64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const keyFromSecret = async (secret: string) => {
  const hash = await crypto.subtle.digest('SHA-256', te.encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

export const ensureRoomSecret = () => {
  if (!window.location.hash || window.location.hash.length < 10) {
    const secret = b64(crypto.getRandomValues(new Uint8Array(24)).buffer).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    window.location.hash = secret;
  }
  return window.location.hash.slice(1);
};

export const getRoomSecret = () => window.location.hash.slice(1);

export const encryptText = async (plain: string, secret: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromSecret(secret);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plain));
  return `enc:v1:${b64(iv.buffer)}:${b64(ct)}`;
};

export const decryptText = async (payload: string, secret: string) => {
  if (!payload.startsWith('enc:v1:')) return payload;
  const [, , ivs, cts] = payload.split(':');
  const iv = ub64(ivs);
  const ct = ub64(cts);
  const key = await keyFromSecret(secret);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return td.decode(plain);
};

export const encryptBytes = async (bytes: ArrayBuffer, secret: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFromSecret(secret);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64(iv.buffer), data: new Uint8Array(ct) };
};

export const decryptBytes = async (bytes: ArrayBuffer, ivB64: string, secret: string) => {
  const key = await keyFromSecret(secret);
  const iv = ub64(ivB64);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes);
};
