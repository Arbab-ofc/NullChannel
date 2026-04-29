export type MessageType = 'text' | 'image' | 'voice';

export interface MessagePayload {
  roomCode: string;
  senderId: string;
  type: MessageType;
  content?: string;
  fileUrl?: string;
  filePath?: string;
}
