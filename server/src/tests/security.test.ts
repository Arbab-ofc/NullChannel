import { describe, expect, it } from 'vitest';
import { normalizeMediaType, validSignature } from '../services/media-validation.js';
import { allowEvent } from '../sockets/rateLimit.js';
import { socketMessageSchema } from '../schemas/message.schema.js';
import { randomUUID } from 'node:crypto';
describe('media and socket boundaries', () => {
  it.each(['image/png','image/jpeg','image/webp','audio/webm','audio/wav','audio/mpeg','application/pdf','application/zip'])('rejects forged %s signatures', mime => {
    expect(validSignature(Buffer.from('<script>payload</script>'), mime)).toBe(false);
  });
  it('recognizes PNG, PDF, WebM and ZIP signatures', () => {
    expect(validSignature(Buffer.from('89504e470d0a1a0a', 'hex'),'image/png')).toBe(true);
    expect(validSignature(Buffer.from('%PDF-1.7'),'application/pdf')).toBe(true);
    expect(validSignature(Buffer.from('1a45dfa3', 'hex'),'audio/webm')).toBe(true);
    expect(validSignature(Buffer.from('504b0304', 'hex'),'application/zip')).toBe(true);
  });
  it('rejects empty, binary text and unrecognized types', () => {
    expect(validSignature(Buffer.alloc(0),'text/plain')).toBe(false);
    expect(validSignature(Buffer.from([0,1]),'text/plain')).toBe(false);
    expect(validSignature(Buffer.from('plain'),'application/octet-stream')).toBe(false);
  });
  it('preserves supported extensions when the browser omits MIME, while still requiring a signature', () => {
    expect(normalizeMediaType('application/octet-stream','report.PDF')).toBe('application/pdf');
    expect(validSignature(Buffer.from('<script>'),normalizeMediaType('application/octet-stream','report.pdf'))).toBe(false);
    expect(normalizeMediaType('application/octet-stream','unsafe.html')).toBe('application/octet-stream');
  });
  it('enforces and resets event limits', () => {
    const key = randomUUID(); expect(allowEvent(key,2,1000)).toBe(true); expect(allowEvent(key,2,1001)).toBe(true);
    expect(allowEvent(key,2,1002)).toBe(false); expect(allowEvent(key,2,61001)).toBe(true);
  });
  it('isolates limits across authenticated identities', () => {
    const key = randomUUID(); expect(allowEvent(key,1)).toBe(true); expect(allowEvent(key,1)).toBe(false); expect(allowEvent(randomUUID(),1)).toBe(true);
  });
  it('validates length, identifiers and unknown event fields', () => {
    const payload = { roomCode: 'ABCD1234', senderId: randomUUID(), senderName: 'User', type: 'text', content: 'Hello' };
    expect(socketMessageSchema.safeParse(payload).success).toBe(true);
    expect(socketMessageSchema.safeParse({ ...payload, content: 'a'.repeat(12001) }).success).toBe(false);
    expect(socketMessageSchema.safeParse({ ...payload, roomCode: 'invalid' }).success).toBe(false);
    expect(socketMessageSchema.safeParse({ ...payload, admin: true }).success).toBe(false);
  });
});
