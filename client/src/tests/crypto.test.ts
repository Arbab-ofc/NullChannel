import { describe, expect, it } from 'vitest';
import { decryptBytes, decryptText, encryptBytes, encryptText } from '../lib/crypto';
const secret = 'a-long-random-room-secret-for-testing';
describe('Web Crypto utilities (not a deployed E2EE protocol)', () => {
  it.each(['', 'hello', '你好 👋🏽 مرحبا', 'a'.repeat(12000)])('round-trips text with authenticated encryption', async plain => {
    expect(await decryptText(await encryptText(plain,secret),secret)).toBe(plain);
  });
  it('rejects wrong keys and corrupted ciphertext', async () => {
    const payload = await encryptText('private',secret);
    await expect(decryptText(payload,'wrong key')).rejects.toThrow();
    const parts = payload.split(':'); const ciphertext = atob(parts[3]);
    parts[3] = btoa(String.fromCharCode(ciphertext.charCodeAt(0)^1) + ciphertext.slice(1));
    await expect(decryptText(parts.join(':'),secret)).rejects.toThrow();
  });
  it('uses unique nonces', async () => {
    const values = await Promise.all(Array.from({ length: 100 }, () => encryptText('x',secret)));
    expect(new Set(values.map(v => v.split(':')[2])).size).toBe(100);
  });
  it('round-trips a binary attachment', async () => {
    const bytes = new Uint8Array(65536); for (let i=0;i<bytes.length;i++) bytes[i] = i%256;
    const encrypted = await encryptBytes(bytes.buffer, secret);
    expect(new Uint8Array(await decryptBytes(encrypted.data.buffer as ArrayBuffer,encrypted.iv,secret))).toEqual(bytes);
  });
});
