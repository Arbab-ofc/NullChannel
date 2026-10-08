import type { Server } from 'socket.io';

let ioRef: Server | null = null;

export const setSocketServer = (io: Server) => {
  ioRef = io;
};

export const emitRoomExpired = (roomId: string, payload: { reason: string }) => {
  ioRef?.to(roomId).emit('room-expired', payload);
  ioRef?.in(roomId).socketsLeave(roomId);
};

export const emitRoomExpiredByCode = (roomCode: string, payload: { reason: string }) => {
  ioRef?.to(`room-code:${roomCode}`).emit('room-expired', payload);
};

export const emitMessageDeleted = (roomId: string, payload: { messageId: string; deletedBy: string; deletedByName: string }) => {
  ioRef?.to(roomId).emit('message-deleted', payload);
};

export const emitMessageBurned = (roomId: string, payload: { messageId: string }) => {
  ioRef?.to(roomId).emit('message-burned', payload);
};

export const emitMessageEdited = (roomId: string, payload: { messageId: string; content: string; editedBy: string }) => {
  ioRef?.to(roomId).emit('message-edited', payload);
};

export const emitMessageReactions = (
  roomId: string,
  payload: { messageId: string; reactions: Array<{ emoji: string; count: number; senders: Array<{ sender_id: string; sender_name: string }> }> }
) => {
  ioRef?.to(roomId).emit('message-reactions', payload);
};

export const emitRoomExtended = (roomId: string, payload: { code: string; expiresAt: string; extendByMinutes: number }) => {
  ioRef?.to(roomId).emit('room-extended', payload);
};

export const emitMessagePinned = (roomId: string, payload: { code: string; pinnedMessageId: string | null }) => {
  ioRef?.to(roomId).emit('message-pinned', payload);
};

export const emitRoomWiped = (roomId: string, payload: { code: string; wipedMessages: number; wipedAt: string }) => {
  ioRef?.to(roomId).emit('room-wiped', payload);
};

export const revokeRoomSockets = async (roomId: string, code: string, identity: string) => {
  for (const socket of await ioRef?.in(roomId).fetchSockets() ?? []) {
    if (socket.data.identity !== identity) continue;
    socket.emit('membership-revoked', { code });
    socket.leave(roomId);
    socket.leave(`room-code:${code}`);
  }
  await emitPresence(roomId);
};

export const onlineIdentities = async (roomId: string) => {
  const sockets = await ioRef?.in(roomId).fetchSockets() ?? [];
  return [...new Set(sockets.map(socket => String(socket.data.identity)))];
};
export const emitPresence = async (roomId: string) => {
  ioRef?.to(roomId).emit('participants-updated', { roomId, online: await onlineIdentities(roomId) });
};
export const revokeSessionSockets = async (sessionId: string) => {
  for (const socket of await ioRef?.fetchSockets() ?? []) {
    if (socket.data.sessionId === sessionId) socket.disconnect(true);
  }
};
