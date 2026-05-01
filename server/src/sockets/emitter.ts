import type { Server } from 'socket.io';

let ioRef: Server | null = null;

export const setSocketServer = (io: Server) => {
  ioRef = io;
};

export const emitRoomExpired = (roomId: string, payload: { reason: string }) => {
  ioRef?.to(roomId).emit('room-expired', payload);
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

export const emitRoomWiped = (roomId: string, payload: { code: string; wipedMessages: number }) => {
  ioRef?.to(roomId).emit('room-wiped', payload);
};
