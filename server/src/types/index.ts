export type MessageType = 'text' | 'image' | 'voice' | 'file';

export interface MessagePayload {
  roomCode: string;
  senderId: string;
  senderName: string;
  type: MessageType;
  content?: string;
  fileUrl?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  replyToMessageId?: string;
  burnAfterRead?: boolean;
}
