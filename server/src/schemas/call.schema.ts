import { z } from 'zod';

export const callRefSchema = z.strictObject({ callId: z.string().uuid() });
export const callInviteSchema = z.strictObject({ roomCode: z.string().regex(/^[A-Z0-9]{8}$/) });
export const audioSdp = z.string().min(20).max(48 * 1024).refine(sdp => {
  const lines = sdp.split(/\r?\n/);
  const media = lines.filter(line => line.startsWith('m='));
  return lines[0] === 'v=0' && media.length === 1 && /^m=audio \d+ UDP\/TLS\/RTP\/SAVPF /.test(media[0]) &&
    lines.some(line => line.startsWith('a=fingerprint:sha-256 ')) && lines.some(line => line.startsWith('a=ice-ufrag:'));
}, 'Only encrypted audio SDP is supported.');
export const callDescriptionSchema = callRefSchema.extend({ revision: z.number().int().min(1).max(5), sdp: audioSdp });
export const callIceSchema = callRefSchema.extend({ revision: z.number().int().min(1).max(5), candidate: z.strictObject({
  candidate: z.string().min(1).max(2048).startsWith('candidate:'),
  sdpMid: z.string().max(64).nullable(), sdpMLineIndex: z.number().int().min(0).max(0).nullable(),
  usernameFragment: z.string().max(256).nullable().optional()
}) });
export type CallAck = { ok: true; callId?: string } | { ok: false; code: string; message: string };
