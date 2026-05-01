import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Link2, Radio, DoorOpen, Power, Rows2, ImagePlus, Menu, X, House, Trash2, Mic, Square, Pencil, Send, TimerReset, Reply, SmilePlus, MoreVertical, Paperclip, FileText, Download, Pin, PinOff, Images, ExternalLink } from 'lucide-react';
import { Button } from '../components/common/Button';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useLocalSender } from '../hooks/useLocalSender';
import { useCountdown } from '../hooks/useCountdown';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { LoadingSignal } from '../components/common/LoadingSignal';

type ReactionSummary = { emoji: string; count: number; senders: Array<{ sender_id: string; sender_name: string }> };
type MessageType = 'text'|'image'|'voice'|'file';
type ReplyPreview = { id: string; sender_id: string; sender_name?: string; content?: string; type: MessageType; file_url?: string; file_name?: string };
type Msg = { id?: string; sender_id: string; sender_name?: string; content?: string; type: MessageType; file_url?: string; file_path?: string; file_name?: string; file_size?: number; mime_type?: string; reply_to_message_id?: string | null; reply_to?: ReplyPreview | null; reactions?: ReactionSummary[]; created_at?: string; deleted?: boolean; deleted_by?: string; deleted_by_name?: string; edited?: boolean };
type Room = { id: string; code: string; creator_id: string; room_type: 'private' | 'group'; room_name: string; expires_at: string; expiry_extended?: boolean; pinned_message_id?: string | null };
type SystemNotice = { id: string; text: string };
type TypingPayload = { roomCode?: string; senderId?: string; senderName?: string };
type Participant = { sender_id: string; sender_name: string; joined_at: string };
type RoomCloseReason = 'expired' | 'terminated-by-creator';

const VOICE_MAX_MS = 2 * 60 * 1000;
const REACTION_EMOJIS = ['👍', '😂', '🔥', '❤️', '👀'];

export default function ChatPage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const senderId = useLocalSender();
  const socket = useSocket();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [myRooms, setMyRooms] = useState<Array<{ code: string; room_name?: string; room_type?: 'private' | 'group'; expires_at: string }>>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [deletingMessageIds, setDeletingMessageIds] = useState<Record<string, boolean>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingBusy, setEditingBusy] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Msg | null>(null);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null);
  const [reactionBusyIds, setReactionBusyIds] = useState<Record<string, boolean>>({});
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [toast, setToast] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [senderName, setSenderName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [pageState, setPageState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [joinBusy, setJoinBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [terminateBusy, setTerminateBusy] = useState(false);
  const [extendBusy, setExtendBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState('30');
  const [joinError, setJoinError] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [expiredNotice, setExpiredNotice] = useState(false);
  const [closeReason, setCloseReason] = useState<RoomCloseReason>('expired');
  const typingTimeouts = useRef<Record<string, number>>({});
  const lastTypingAt = useRef(0);
  const redirectTimeout = useRef<number | null>(null);
  const toastTimeout = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);
  const recordingStartedAt = useRef(0);
  const recordingInterval = useRef<number | null>(null);
  const recordingLimitTimeout = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const left = useCountdown(room?.expires_at ?? new Date().toISOString());

  const loadMyRooms = useCallback(async () => {
    setRoomsLoading(true);
    try {
      const res = await api.get(`/users/${senderId}/rooms`);
      const rooms = res.data.data ?? [];
      setMyRooms(rooms);
      return rooms as Array<{ code: string; room_name?: string; room_type?: 'private' | 'group'; expires_at: string }>;
    } finally {
      setRoomsLoading(false);
    }
  }, [senderId]);

  const loadParticipants = useCallback(async (roomCode: string) => {
    setParticipantsLoading(true);
    try {
      const res = await api.get(`/rooms/${roomCode}/participants`);
      setParticipants(res.data.data ?? []);
    } catch {
      setParticipants([]);
    } finally {
      setParticipantsLoading(false);
    }
  }, []);

  const showExpiredPopup = useCallback((reason: RoomCloseReason = 'expired') => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setCloseReason(reason);
    setExpiredNotice(true);
    setIsJoined(false);
    setTypingUsers({});
    loadMyRooms().catch(() => undefined);
    if (redirectTimeout.current) window.clearTimeout(redirectTimeout.current);
    redirectTimeout.current = window.setTimeout(() => {
      nav('/');
    }, 3000);
  }, [loadMyRooms, nav]);

  useEffect(() => {
    setPageState('loading');
    setRoom(null);
    (async () => {
      const roomRes = await api.get(`/rooms/${code.toUpperCase()}`);
      const roomData = roomRes.data.data as Room;
      setRoom(roomData);
      const cached = sessionStorage.getItem(`nullchannel_name_${roomData.code}`) ?? '';
      setSenderName(cached);
      setNameInput(cached);
      const msgRes = await api.get(`/rooms/${code.toUpperCase()}/messages`);
      setMessages(msgRes.data.data);
      await loadParticipants(roomData.code);
      const rooms = await loadMyRooms();
      const alreadyJoined = roomData.creator_id === senderId || rooms.some((r) => r.code === roomData.code);
      setIsJoined(alreadyJoined);
      setPageState('ready');
    })().catch(() => {
      setRoom(null);
      setPageState('missing');
      setRoomsLoading(false);
    });
  }, [code, loadMyRooms, loadParticipants, senderId]);

  useEffect(() => {
    if (!room) return;
    const msUntilExpiry = new Date(room.expires_at).getTime() - Date.now();
    if (msUntilExpiry <= 0) {
      showExpiredPopup();
      return;
    }
    const timeout = window.setTimeout(showExpiredPopup, msUntilExpiry);
    return () => window.clearTimeout(timeout);
  }, [room, showExpiredPopup]);

  useEffect(() => () => {
    if (redirectTimeout.current) window.clearTimeout(redirectTimeout.current);
    if (toastTimeout.current) window.clearTimeout(toastTimeout.current);
    if (recordingInterval.current) window.clearInterval(recordingInterval.current);
    if (recordingLimitTimeout.current) window.clearTimeout(recordingLimitTimeout.current);
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, notices, typingUsers]);

  useEffect(() => {
    if (!room) return;
    socket.on('room-joined', () => {
      setIsJoined(true);
      setJoinBusy(false);
      setJoinError('');
      loadMyRooms().catch(() => undefined);
      if (room) loadParticipants(room.code).catch(() => undefined);
    });
    socket.on('socket-error', (payload: { code?: string; message?: string }) => {
      setJoinBusy(false);
      if (payload?.code === 'ROOM_FULL') {
        setJoinError('Private channel is full (max 2 users).');
        nav('/');
        return;
      }
      if (payload?.code === 'NAME_REQUIRED') {
        setJoinError('Enter a display name to join this room.');
        return;
      }
      if (payload?.code === 'VALIDATION_ERROR') {
        setJoinError('Enter a display name to join this room.');
        return;
      }
      if (payload?.message) setJoinError(payload.message);
    });
    socket.on('receive-message', (msg: Msg) => {
      setMessages((p) => [...p, msg]);
      window.clearTimeout(typingTimeouts.current[msg.sender_id]);
      setTypingUsers((p) => {
        const next = { ...p };
        delete next[msg.sender_id];
        return next;
      });
    });
    socket.on('message-deleted', (payload: { messageId?: string; deletedBy?: string; deletedByName?: string }) => {
      if (!payload.messageId) return;
      setMessages((p) => p.map((message) => (message.id === payload.messageId ? {
        ...message,
        deleted: true,
        deleted_by: payload.deletedBy,
        deleted_by_name: payload.deletedByName,
        content: 'This message was deleted.',
        file_url: undefined
      } : message)));
      setDeletingMessageIds((p) => {
        const next = { ...p };
        delete next[payload.messageId as string];
        return next;
      });
    });
    socket.on('message-edited', (payload: { messageId?: string; content?: string }) => {
      if (!payload.messageId || typeof payload.content !== 'string') return;
      setMessages((p) => p.map((message) => (message.id === payload.messageId ? {
        ...message,
        content: payload.content,
        edited: true
      } : message)));
    });
    socket.on('message-reactions', (payload: { messageId?: string; reactions?: ReactionSummary[] }) => {
      if (!payload.messageId || !Array.isArray(payload.reactions)) return;
      setMessages((p) => p.map((message) => (message.id === payload.messageId ? {
        ...message,
        reactions: payload.reactions
      } : message)));
    });
    socket.on('user-left', (payload: { senderId?: string; senderName?: string }) => {
      if (payload?.senderId === senderId) return;
      const name = payload?.senderName ?? 'A user';
      setNotices((p) => [...p, { id: `${Date.now()}-${Math.random()}`, text: `${name} left the room` }]);
      setParticipants((p) => p.filter((participant) => participant.sender_id !== payload?.senderId));
      if (payload?.senderId) {
        window.clearTimeout(typingTimeouts.current[payload.senderId]);
        setTypingUsers((p) => {
          const next = { ...p };
          delete next[payload.senderId as string];
          return next;
        });
      }
    });
    socket.on('user-joined', (payload: { senderId?: string; senderName?: string }) => {
      if (!payload?.senderId || payload.senderId === senderId) return;
      const name = payload.senderName ?? 'A user';
      setNotices((p) => [...p, { id: `${Date.now()}-${Math.random()}`, text: `${name} joined the room` }]);
      loadParticipants(room.code).catch(() => undefined);
    });
    socket.on('user-typing', (payload: TypingPayload) => {
      if (!payload.senderId || payload.senderId === senderId || payload.roomCode !== room.code) return;
      const name = payload.senderName ?? `User-${payload.senderId.slice(0, 6)}`;
      setTypingUsers((p) => ({ ...p, [payload.senderId as string]: name }));
      window.clearTimeout(typingTimeouts.current[payload.senderId]);
      typingTimeouts.current[payload.senderId] = window.setTimeout(() => {
        setTypingUsers((p) => {
          const next = { ...p };
          delete next[payload.senderId as string];
          return next;
        });
      }, 1800);
    });
    socket.on('room-expired', (payload: { reason?: RoomCloseReason } = {}) => {
      setIsJoined(false);
      setTypingUsers({});
      loadMyRooms().catch(() => undefined);
      showExpiredPopup(payload.reason === 'terminated-by-creator' ? 'terminated-by-creator' : 'expired');
    });
    socket.on('room-extended', (payload: { code?: string; expiresAt?: string; extendByMinutes?: number } = {}) => {
      if (payload.code !== room.code || !payload.expiresAt) return;
      const expiresAt = payload.expiresAt;
      setRoom((current) => (current && current.code === room.code ? { ...current, expires_at: expiresAt, expiry_extended: true } : current));
      loadMyRooms().catch(() => undefined);
      const minutes = payload.extendByMinutes ?? 0;
      setNotices((p) => [...p, { id: `${Date.now()}-${Math.random()}`, text: minutes > 0 ? `Room extended by ${minutes} min` : 'Room expiry extended' }]);
    });
    socket.on('message-pinned', (payload: { code?: string; pinnedMessageId?: string | null } = {}) => {
      if (payload.code !== room.code) return;
      setRoom((current) => (current && current.code === room.code ? { ...current, pinned_message_id: payload.pinnedMessageId ?? null } : current));
      setNotices((p) => [...p, { id: `${Date.now()}-${Math.random()}`, text: payload.pinnedMessageId ? 'Message pinned' : 'Pinned message cleared' }]);
    });

    if ((isJoined || room.creator_id === senderId) && !!senderName) {
      socket.emit('join-room', { roomCode: room.code, senderId, senderName });
    }

    return () => {
      socket.off('receive-message');
      socket.off('room-expired');
      socket.off('socket-error');
      socket.off('user-left');
      socket.off('user-joined');
      socket.off('user-typing');
      socket.off('message-deleted');
      socket.off('message-edited');
      socket.off('message-reactions');
      socket.off('room-extended');
      socket.off('message-pinned');
      socket.off('room-joined');
      Object.values(typingTimeouts.current).forEach((id) => window.clearTimeout(id));
      typingTimeouts.current = {};
    };
  }, [room, socket, senderId, senderName, isJoined, loadMyRooms, loadParticipants, showExpiredPopup, nav]);

  const joinCurrentRoom = (nameOverride?: string) => {
    if (!room) return;
    const effectiveName = (nameOverride ?? senderName).trim();
    if (!effectiveName) {
      setJoinError('Enter a display name to join this room.');
      return;
    }
    if (!socket.connected) socket.connect();
    setJoinBusy(true);
    setJoinError('');
    socket.emit('join-room', { roomCode: room.code, senderId, senderName: effectiveName });
  };

  const send = () => {
    if (!room || !text.trim() || !isJoined) return;
    if (!senderName) return;
    socket.emit('send-message', {
      roomCode: room.code,
      senderId,
      senderName: senderName || undefined,
      type: 'text',
      content: text.trim(),
      replyToMessageId: replyingTo?.id
    });
    setText('');
    setReplyingTo(null);
  };

  const handleTextChange = (value: string) => {
    setText(value);
    if (!room || !isJoined || !value.trim()) return;
    if (!senderName) return;
    const now = Date.now();
    if (now - lastTypingAt.current < 900) return;
    lastTypingAt.current = now;
    socket.emit('typing', { roomCode: room.code, senderId, senderName: senderName || undefined });
  };

  const sendImage = async (file: File) => {
    if (!room || !isJoined) return;
    if (!senderName) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) return;

    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('roomCode', room.code);
      form.append('senderId', senderId);
      form.append('type', 'image');
      const res = await api.post('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      socket.emit('send-message', {
        roomCode: room.code,
        senderId,
        senderName: senderName || undefined,
        type: 'image',
        fileUrl: res.data.data.fileUrl,
        filePath: res.data.data.fileId ?? res.data.data.filePath,
        replyToMessageId: replyingTo?.id
      });
      setReplyingTo(null);
    } finally {
      setUploadingImage(false);
    }
  };

  const sendFile = async (file: File) => {
    if (!room || !isJoined) return;
    if (!senderName) return;
    if (file.size > 15 * 1024 * 1024) {
      showToast('File limit is 15 MB');
      return;
    }

    setUploadingFile(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('roomCode', room.code);
      form.append('senderId', senderId);
      form.append('type', 'file');
      const res = await api.post('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      socket.emit('send-message', {
        roomCode: room.code,
        senderId,
        senderName: senderName || undefined,
        type: 'file',
        content: file.name,
        fileUrl: res.data.data.fileUrl,
        filePath: res.data.data.fileId ?? res.data.data.filePath,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        replyToMessageId: replyingTo?.id
      });
      setReplyingTo(null);
      showToast('File sent');
    } catch {
      showToast('File upload failed');
    } finally {
      setUploadingFile(false);
    }
  };

  const emitVoiceMessage = async (blob: Blob) => {
    if (!room || !isJoined || !senderName || blob.size === 0) return;
    setUploadingVoice(true);
    try {
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
      const form = new FormData();
      form.append('file', file);
      form.append('roomCode', room.code);
      form.append('senderId', senderId);
      form.append('type', 'voice');
      const res = await api.post('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      socket.emit('send-message', {
        roomCode: room.code,
        senderId,
        senderName,
        type: 'voice',
        fileUrl: res.data.data.fileUrl,
        filePath: res.data.data.fileId ?? res.data.data.filePath,
        replyToMessageId: replyingTo?.id
      });
      setReplyingTo(null);
      showToast('Voice sent');
    } catch {
      showToast('Voice upload failed');
    } finally {
      setUploadingVoice(false);
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const startVoiceRecording = async () => {
    if (!room || !isJoined || !senderName || recordingVoice || uploadingVoice) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('Voice recording unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      recordingStartedAt.current = Date.now();
      setRecordingSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        voiceChunksRef.current = [];
        setRecordingVoice(false);
        setRecordingSeconds(0);
        if (recordingInterval.current) window.clearInterval(recordingInterval.current);
        if (recordingLimitTimeout.current) window.clearTimeout(recordingLimitTimeout.current);
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        emitVoiceMessage(blob).catch(() => undefined);
      };

      recorder.start();
      setRecordingVoice(true);
      recordingInterval.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - recordingStartedAt.current) / 1000));
      }, 500);
      recordingLimitTimeout.current = window.setTimeout(stopVoiceRecording, VOICE_MAX_MS);
    } catch {
      showToast('Mic permission denied');
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimeout.current) window.clearTimeout(toastTimeout.current);
    toastTimeout.current = window.setTimeout(() => setToast(''), 1800);
  };

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(label);
    } catch {
      showToast('Clipboard unavailable');
    }
  };

  const deleteMessage = async (messageId?: string) => {
    if (!room || !messageId || deletingMessageIds[messageId]) return;
    setDeletingMessageIds((p) => ({ ...p, [messageId]: true }));
    try {
      const res = await api.delete(`/rooms/${room.code}/messages/${messageId}`, { data: { senderId } });
      const deletedId = res.data.data?.messageId ?? messageId;
      setMessages((p) => p.map((message) => (message.id === deletedId ? {
        ...message,
        deleted: true,
        deleted_by: res.data.data?.deletedBy ?? senderId,
        deleted_by_name: res.data.data?.deletedByName ?? senderName,
        content: 'You deleted this message.',
        file_url: undefined
      } : message)));
      showToast('Message deleted');
    } catch {
      showToast('Delete failed');
    } finally {
      setDeletingMessageIds((p) => {
        const next = { ...p };
        delete next[messageId];
        return next;
      });
    }
  };

  const quoteLabel = (message?: ReplyPreview | Msg | null) => {
    if (!message) return 'Message unavailable';
    if (message.type === 'image') return 'Image transmission';
    if (message.type === 'voice') return 'Voice transmission';
    if (message.type === 'file') return message.file_name || message.content || 'File attachment';
    return message.content || 'Text transmission';
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  };

  const firstUrl = (value?: string) => value?.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? null;

  const linkPreview = (value?: string) => {
    const url = firstUrl(value);
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return {
        url,
        host: parsed.hostname.replace(/^www\./, ''),
        path: `${parsed.pathname}${parsed.search}`.replace(/\/$/, '') || '/'
      };
    } catch {
      return null;
    }
  };

  const pinMessage = async (messageId: string | null) => {
    if (!room || room.creator_id !== senderId || pinBusy) return;
    setPinBusy(true);
    try {
      const res = await api.patch(`/rooms/${room.code}/pin`, { senderId, messageId });
      setRoom(res.data.data);
      setMessageMenuId(null);
      showToast(messageId ? 'Message pinned' : 'Pinned message cleared');
    } catch {
      showToast('Pin failed');
    } finally {
      setPinBusy(false);
    }
  };

  const startReply = (message: Msg) => {
    if (!message.id || message.deleted || !isJoined) return;
    setReplyingTo(message);
    setMessageMenuId(null);
  };

  const toggleReaction = async (message: Msg, emoji: string) => {
    if (!room || !message.id || !isJoined || !senderName || message.deleted) return;
    const key = `${message.id}:${emoji}`;
    if (reactionBusyIds[key]) return;
    setReactionBusyIds((p) => ({ ...p, [key]: true }));
    try {
      const res = await api.post(`/rooms/${room.code}/messages/${message.id}/reactions`, { senderId, senderName, emoji });
      const reactions = res.data.data?.reactions ?? [];
      setMessages((p) => p.map((item) => (item.id === message.id ? { ...item, reactions } : item)));
      setReactionPickerMessageId(null);
      setMessageMenuId(null);
    } catch {
      showToast('Reaction failed');
    } finally {
      setReactionBusyIds((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  };

  const canEditMessage = (message: Msg) => {
    if (!message.id || message.deleted || message.type !== 'text' || message.sender_id !== senderId || !message.created_at) return false;
    return Date.now() - new Date(message.created_at).getTime() <= 2 * 60 * 1000;
  };

  const startEditMessage = (message: Msg) => {
    if (!message.id || !canEditMessage(message)) return;
    setEditingMessageId(message.id);
    setEditingText(message.content ?? '');
    setMessageMenuId(null);
  };

  const cancelEditMessage = () => {
    setEditingMessageId(null);
    setEditingText('');
    setEditingBusy(false);
  };

  const saveEditedMessage = async () => {
    if (!room || !editingMessageId || editingBusy) return;
    const content = editingText.trim();
    if (!content) return;
    setEditingBusy(true);
    try {
      await api.patch(`/rooms/${room.code}/messages/${editingMessageId}`, { senderId, content });
      setMessages((p) => p.map((message) => (message.id === editingMessageId ? { ...message, content, edited: true } : message)));
      cancelEditMessage();
      showToast('Message edited');
    } catch {
      showToast('Edit window closed');
      setEditingBusy(false);
    }
  };

  const leaveRoom = async () => {
    if (!room || !isJoined || leaveBusy) return;
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    setLeaveBusy(true);
    try {
      socket.emit('leave-room', { roomCode: room.code, senderId, senderName: senderName || undefined });
      await api.post(`/rooms/${room.code}/leave`, { senderId }).catch(() => undefined);
      setIsJoined(false);
      setTypingUsers({});
      setParticipants((p) => p.filter((participant) => participant.sender_id !== senderId));
      await loadMyRooms();
    } finally {
      setLeaveBusy(false);
    }
  };

  const extendRoomExpiry = async () => {
    const extendByMinutes = Number(extendMinutes);
    if (!Number.isInteger(extendByMinutes) || extendByMinutes < 5 || extendByMinutes > 1440) {
      showToast('Enter 5 to 1440 minutes');
      return;
    }
    if (!room || room.creator_id !== senderId || room.expiry_extended || extendBusy) return;
    setExtendBusy(true);
    try {
      const res = await api.post(`/rooms/${room.code}/extend`, { senderId, extendByMinutes });
      const updated = res.data.data as Room;
      setRoom(updated);
      await loadMyRooms();
      setExtendModalOpen(false);
      showToast(`Extended by ${extendByMinutes} min`);
    } catch {
      showToast('Extend failed');
    } finally {
      setExtendBusy(false);
    }
  };

  const terminateRoom = async () => {
    if (!room || terminateBusy) return;
    setTerminateBusy(true);
    try {
      await api.post(`/rooms/${room.code}/terminate`, { senderId });
      await loadMyRooms();
      showExpiredPopup('terminated-by-creator');
    } finally {
      setTerminateBusy(false);
    }
  };

  const typingNames = Object.values(typingUsers);
  const typingLabel = typingNames.length > 1 ? `${typingNames.slice(0, 2).join(', ')} are typing` : `${typingNames[0] ?? 'Someone'} is typing`;
  const recordingTime = `${Math.floor(recordingSeconds / 60).toString().padStart(2, '0')}:${(recordingSeconds % 60).toString().padStart(2, '0')}`;
  const deletedText = (message: Msg) => `${message.deleted_by === senderId ? 'You' : (message.deleted_by_name ?? 'A member')} deleted this transmission.`;
  const reactionTarget = reactionPickerMessageId ? messages.find((message) => message.id === reactionPickerMessageId) : null;
  const pinnedMessage = room?.pinned_message_id ? messages.find((message) => message.id === room.pinned_message_id && !message.deleted) : null;
  const imageMessages = messages.filter((message) => !message.deleted && message.type === 'image' && message.file_url);
  const closeCopy = closeReason === 'terminated-by-creator'
    ? {
      eyebrow: 'ROOM TERMINATED',
      title: 'This channel was terminated',
      body: 'The channel creator closed this room. You will be redirected home in 3 seconds.',
      loading: 'Returning home'
    }
    : {
      eyebrow: 'ROOM EXPIRED',
      title: 'This channel has disappeared',
      body: 'The room timer ended. You will be redirected home in 3 seconds.',
      loading: 'Closing session'
    };

  if (expiredNotice) return <main className="grid min-h-screen place-items-center bg-bg p-6">
    <div className="neo-panel loading-panel max-w-md p-8 text-center">
      <p className="code-font text-xs tracking-[0.2em] text-punch">{closeCopy.eyebrow}</p>
      <h2 className="mt-2 text-2xl font-black uppercase">{closeCopy.title}</h2>
      <p className="mt-3 text-sm text-muted">{closeCopy.body}</p>
      <LoadingSignal label={closeCopy.loading} className="mt-5 justify-center text-sm uppercase tracking-[0.16em] text-muted" />
    </div>
  </main>;

  if (pageState === 'loading') return <main className="grid min-h-screen place-items-center bg-bg p-6">
    <div className="neo-panel loading-panel max-w-md p-8 text-center">
      <p className="code-font text-xs tracking-[0.2em] text-cyan">SYNCING CHANNEL</p>
      <h2 className="mt-2 text-2xl font-black uppercase">Loading secure room</h2>
      <LoadingSignal label="Resolving room data" className="mt-5 justify-center text-sm uppercase tracking-[0.16em] text-muted" />
    </div>
  </main>;

  if (!room) return <main className="grid min-h-screen place-items-center bg-bg p-6">
    <div className="neo-panel max-w-md p-8 text-center">
      <p className="code-font text-xs tracking-[0.2em] text-cyan">SESSION TERMINATED</p>
      <h2 className="mt-2 text-2xl font-black uppercase">Channel not found or expired</h2>
    </div>
  </main>;

  return <main className="mx-auto grid h-[100svh] w-full max-w-7xl gap-2 overflow-hidden bg-bg px-2 py-2 sm:gap-3 sm:px-4 sm:py-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-4 lg:px-8 lg:py-6">
    {!senderName && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="neo-panel w-full max-w-md p-6">
        <p className="code-font text-xs tracking-[0.2em] text-cyan">ENTER DISPLAY NAME</p>
        <h3 className="mt-2 text-xl font-bold uppercase">Name required to enter this room</h3>
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="Your name"
          className="mt-4 h-11 w-full border-2 border-accent bg-bg px-3"
          maxLength={24}
        />
        <Button
          className="mt-3 w-full"
          disabled={joinBusy}
          onClick={() => {
            const value = nameInput.trim();
            if (value.length < 2) return;
            sessionStorage.setItem(`nullchannel_name_${room.code}`, value);
            setSenderName(value);
            joinCurrentRoom(value);
          }}
        >
          {joinBusy ? <LoadingSignal label="Joining" /> : 'Continue'}
        </Button>
      </div>
    </div>}
    {extendModalOpen && room.creator_id === senderId && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
        <div className="neo-panel w-full max-w-sm p-5">
          <p className="code-font text-xs tracking-[0.2em] text-cyan">EXTEND EXPIRY</p>
          <h3 className="mt-2 text-xl font-bold uppercase">Custom Duration</h3>
          <input
            value={extendMinutes}
            onChange={(e) => setExtendMinutes(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="Minutes"
            className="mt-4 h-11 w-full border-2 border-accent bg-bg px-3 text-sm"
            inputMode="numeric"
            disabled={extendBusy}
            autoFocus
          />
          <p className="mt-2 text-xs text-muted">Enter 5 to 1440 minutes. This can be used once per room.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button onClick={() => setExtendModalOpen(false)} disabled={extendBusy}>Cancel</Button>
            <Button
              className="border-cyan text-cyan"
              onClick={extendRoomExpiry}
              disabled={extendBusy || !extendMinutes || Number(extendMinutes) < 5 || Number(extendMinutes) > 1440}
            >
              {extendBusy ? <LoadingSignal label="Extending" /> : 'Extend'}
            </Button>
          </div>
        </div>
      </div>
    )}
    <section className="order-1 flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden sm:gap-3 lg:order-1 lg:gap-4">
      <header className="neo-panel shrink-0 p-2 sm:p-4 lg:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="code-font hidden text-xs tracking-[0.2em] text-cyan sm:block">NULLCHANNEL / SESSION ACTIVE</p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-5">
              <p className="min-w-0 truncate text-sm font-semibold uppercase">{room.room_name}</p>
              <span className={`connection-status connection-status--inline hidden xl:inline-flex ${isJoined ? '' : 'connection-status--idle'}`}>
                {isJoined && <Radio className="connection-status__icon" />}
                {isJoined ? 'Connected' : 'Not Joined'}
              </span>
            </div>
            <p className="code-font mt-1 truncate text-xs tracking-widest sm:text-sm">CHANNEL ID: {room.code}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="code-font text-xs tracking-[0.2em] text-muted">EXPIRES IN</p>
            <p className="text-lg font-bold text-punch">{left}</p>
          </div>
        </div>
        <div className="mt-4 hidden flex-wrap gap-2 xl:flex">
          {room.creator_id !== senderId && (
            <Button className={!isJoined ? 'bg-accent text-bg' : ''} onClick={isJoined ? leaveRoom : () => joinCurrentRoom()} disabled={(joinBusy && !isJoined) || leaveBusy}>
              <DoorOpen className="mr-2 inline h-4 w-4" />
              {leaveBusy ? <LoadingSignal label="Leaving" /> : isJoined ? 'Leave Room' : (joinBusy ? <LoadingSignal label="Joining" /> : 'Join Room')}
            </Button>
          )}
          <ThemeToggle />
          <Button onClick={() => copyToClipboard(room.code, 'Channel ID copied')}><Copy className="mr-2 inline h-4 w-4" />Copy Channel ID</Button>
          <Button onClick={() => copyToClipboard(window.location.href, 'Invite link copied')}><Link2 className="mr-2 inline h-4 w-4" />Copy Invite Link</Button>
          <Button onClick={() => nav('/')}><House className="mr-2 inline h-4 w-4" />Home</Button>
          {room.creator_id === senderId && (
            <Button
              className="border-cyan text-cyan"
              onClick={() => setExtendModalOpen(true)}
              disabled={!!room.expiry_extended || !!extendBusy}
              title={room.expiry_extended ? 'This channel has already been extended' : 'Extend expiry'}
            >
              <TimerReset className="mr-2 inline h-4 w-4" />
              {extendBusy ? <LoadingSignal label="Extending" /> : 'Extend'}
            </Button>
          )}
          {room.creator_id === senderId && <Button className="border-red-400 text-red-300" onClick={terminateRoom} disabled={terminateBusy}><Power className="mr-2 inline h-4 w-4" />{terminateBusy ? <LoadingSignal label="Terminating" /> : 'Terminate'}</Button>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 sm:mt-4 xl:hidden">
          {isJoined ? <span className="connection-status"><Radio className="connection-status__icon" />Connected</span> : <span className="connection-status connection-status--idle">Not Joined</span>}
          <button
            className="neo-action inline-flex h-10 w-10 shrink-0 items-center justify-center border-2 border-accent bg-panel"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle chat menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        <>
          <button
            className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-250 xl:hidden ${menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          />
          <aside className={`fixed right-0 top-0 z-50 h-full w-[88%] max-w-sm border-l-2 border-accent bg-panel p-4 shadow-panel transition-transform duration-300 ease-out xl:hidden ${menuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="mb-4 flex items-center justify-between">
              <p className="code-font text-xs tracking-[0.2em] text-cyan">CHANNEL CONTROLS</p>
              <button className="neo-action inline-flex h-10 w-10 items-center justify-center border-2 border-accent bg-panel" onClick={() => setMenuOpen(false)}><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-2">
              <ThemeToggle />
              {room.creator_id !== senderId && (
                <Button className={!isJoined ? 'bg-accent text-bg' : ''} onClick={isJoined ? leaveRoom : () => joinCurrentRoom()} disabled={(joinBusy && !isJoined) || leaveBusy}>
                  <DoorOpen className="mr-2 inline h-4 w-4" />
                  {leaveBusy ? <LoadingSignal label="Leaving" /> : isJoined ? 'Leave Room' : (joinBusy ? <LoadingSignal label="Joining" /> : 'Join Room')}
                </Button>
              )}
              <Button onClick={() => copyToClipboard(room.code, 'Channel ID copied')}><Copy className="mr-2 inline h-4 w-4" />Copy Channel ID</Button>
              <Button onClick={() => copyToClipboard(window.location.href, 'Invite link copied')}><Link2 className="mr-2 inline h-4 w-4" />Copy Invite Link</Button>
              <Button onClick={() => nav('/')}><House className="mr-2 inline h-4 w-4" />Home</Button>
              {room.creator_id === senderId && (
                <Button
                  className="border-cyan text-cyan"
                  onClick={() => setExtendModalOpen(true)}
                  disabled={!!room.expiry_extended || !!extendBusy}
                  title={room.expiry_extended ? 'This channel has already been extended' : 'Extend expiry'}
                >
                  <TimerReset className="mr-2 inline h-4 w-4" />
                  {extendBusy ? <LoadingSignal label="Extending" /> : 'Extend Expiry'}
                </Button>
              )}
              {room.creator_id === senderId && <Button className="border-red-400 text-red-300" onClick={terminateRoom} disabled={terminateBusy}><Power className="mr-2 inline h-4 w-4" />{terminateBusy ? <LoadingSignal label="Terminating" /> : 'Terminate'}</Button>}
            </div>
          </aside>
        </>
      </header>

      {pinnedMessage && (
        <section className="pinned-message neo-panel">
          <div className="flex min-w-0 items-center gap-2">
            <Pin className="h-4 w-4 shrink-0 text-cyan" />
            <div className="min-w-0">
              <p className="pinned-message__label">Pinned message</p>
              <p className="pinned-message__content">{quoteLabel(pinnedMessage)}</p>
            </div>
          </div>
          {room.creator_id === senderId && (
            <button className="pinned-message__clear" onClick={() => pinMessage(null)} disabled={pinBusy} type="button" aria-label="Unpin message">
              <PinOff className="h-4 w-4" />
            </button>
          )}
        </section>
      )}

      <section className="chat-transcript neo-panel min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4 lg:p-5">
        {!isJoined && room.creator_id !== senderId && (
          <div className="border-2 border-punch bg-panel px-3 py-2 text-xs uppercase tracking-wider text-muted">
            Press Join Room to enter this channel.
          </div>
        )}
        {!!joinError && (
          <div className="border-2 border-red-400 bg-panel px-3 py-2 text-xs uppercase tracking-wider text-red-300">
            {joinError}
          </div>
        )}
        {notices.map((n) => (
          <div key={n.id} className="mx-auto w-fit border-2 border-punch bg-panel px-3 py-1 text-xs uppercase tracking-wider text-muted">
            {n.text}
          </div>
        ))}
        {messages.length === 0 && <div className="border-2 border-dashed border-accent/60 p-5 text-sm text-muted">No transmissions yet. Send the first message.</div>}
        {messages.map((m, i) => <article key={m.id ?? i} className={`group relative max-w-[94%] border-2 p-2.5 text-sm shadow-panel sm:max-w-[82%] lg:max-w-[70%] ${m.deleted ? 'mx-auto border-punch/70 bg-panel text-muted' : m.sender_id === senderId ? 'ml-auto border-cyan bg-cyan/10' : 'border-accent bg-accent/10'}`}>
          <div className="message-row-head mb-1">
            <p className="message-sender-label text-[10px] uppercase tracking-wider text-muted">{m.deleted ? 'Message removed' : m.sender_id === senderId ? 'You' : (m.sender_name ?? 'Member')}</p>
            {!m.deleted && m.id && (
              <div className="message-actions relative">
                <button
                  className={`message-delete-button ${messageMenuId === m.id ? 'message-delete-button--active' : ''}`}
                  onClick={() => setMessageMenuId((current) => (current === m.id ? null : m.id ?? null))}
                  aria-label="Open message options"
                  title="Message options"
                  type="button"
                >
                  {messageMenuId === m.id ? <X className="h-3.5 w-3.5" /> : <MoreVertical className="h-3.5 w-3.5" />}
                </button>
                {messageMenuId === m.id && (
                  <div className={`message-options-menu ${m.sender_id === senderId ? 'right-0' : 'left-0'}`}>
                    {isJoined && (
                      <button type="button" onClick={() => startReply(m)}>
                        <Reply className="h-3.5 w-3.5" />
                        <span>Reply</span>
                      </button>
                    )}
                    {room.creator_id === senderId && (
                      <button
                        type="button"
                        onClick={() => pinMessage(room.pinned_message_id === m.id ? null : m.id ?? null)}
                        disabled={pinBusy}
                      >
                        {room.pinned_message_id === m.id ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        <span>{room.pinned_message_id === m.id ? 'Unpin' : 'Pin'}</span>
                      </button>
                    )}
                    {isJoined && (
                      <button
                        type="button"
                        onClick={() => {
                          setReactionPickerMessageId(m.id ?? null);
                          setMessageMenuId(null);
                        }}
                      >
                        <SmilePlus className="h-3.5 w-3.5" />
                        <span>React</span>
                      </button>
                    )}
                    {m.sender_id === senderId && canEditMessage(m) && (
                      <button type="button" onClick={() => startEditMessage(m)} disabled={editingBusy}>
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Edit</span>
                      </button>
                    )}
                    {m.sender_id === senderId && (
                      <button
                        type="button"
                        onClick={() => {
                          setMessageMenuId(null);
                          deleteMessage(m.id);
                        }}
                        disabled={!!deletingMessageIds[m.id]}
                        className="message-options-menu__danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>{deletingMessageIds[m.id] ? 'Deleting' : 'Delete'}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {!m.deleted && m.reply_to && (
            <div className="reply-quote mb-2">
              <p className="reply-quote__name">{m.reply_to.sender_id === senderId ? 'You' : (m.reply_to.sender_name ?? 'Member')}</p>
              <p className="reply-quote__content">{quoteLabel(m.reply_to)}</p>
            </div>
          )}
          {m.deleted && <p className="code-font text-xs uppercase tracking-[0.16em]">{deletedText(m)}</p>}
          {!m.deleted && m.type === 'text' && editingMessageId === m.id && (
            <div className="grid gap-2">
              <textarea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                className="min-h-20 w-full resize-none border-2 border-cyan bg-bg px-3 py-2 text-sm text-text outline-none"
                maxLength={12000}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button className="message-delete-button" onClick={cancelEditMessage} disabled={editingBusy}>Cancel</button>
                <button className="message-delete-button" onClick={saveEditedMessage} disabled={editingBusy || !editingText.trim()}>{editingBusy ? 'Saving' : 'Save'}</button>
              </div>
            </div>
          )}
          {!m.deleted && m.type === 'text' && editingMessageId !== m.id && (
            <>
              <p className="whitespace-pre-wrap">{m.content}{m.edited && <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">(edited)</span>}</p>
              {linkPreview(m.content) && (
                <a className="link-preview" href={linkPreview(m.content)?.url} target="_blank" rel="noreferrer">
                  <div className="link-preview__icon"><ExternalLink className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <p className="link-preview__host">{linkPreview(m.content)?.host}</p>
                    <p className="link-preview__path">{linkPreview(m.content)?.path}</p>
                  </div>
                </a>
              )}
            </>
          )}
          {!m.deleted && m.type === 'image' && m.file_url && <img src={m.file_url} className="max-h-72 w-full object-cover" />}
          {!m.deleted && m.type === 'voice' && m.file_url && <audio controls src={m.file_url} className="w-full" />}
          {!m.deleted && m.type === 'file' && m.file_url && (
            <a className="file-message" href={m.file_url} target="_blank" rel="noreferrer">
              <FileText className="h-5 w-5 shrink-0 text-cyan" />
              <div className="min-w-0 flex-1">
                <p className="file-message__name">{m.file_name ?? m.content ?? 'Attachment'}</p>
                <p className="file-message__meta">{[formatFileSize(m.file_size), m.mime_type].filter(Boolean).join(' / ') || 'Download file'}</p>
              </div>
              <Download className="h-4 w-4 shrink-0 text-muted" />
            </a>
          )}
          {!m.deleted && !!m.reactions?.length && (
            <div className="message-reactions">
              {m.reactions.map((reaction) => {
                const reactedByMe = reaction.senders.some((sender) => sender.sender_id === senderId);
                return (
                  <button
                    key={reaction.emoji}
                    className={`message-reaction ${reactedByMe ? 'message-reaction--mine' : ''}`}
                    onClick={() => toggleReaction(m, reaction.emoji)}
                    disabled={!isJoined || !!reactionBusyIds[`${m.id}:${reaction.emoji}`]}
                    title={reaction.senders.map((sender) => sender.sender_name).join(', ')}
                  >
                    <span>{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </article>)}
        {typingNames.length > 0 && (
          <div className="typing-indicator mx-auto max-w-full">
            <LoadingSignal label={typingLabel} />
          </div>
        )}
        <div ref={messagesEndRef} className="h-1" />
      </section>

    {isJoined && reactionTarget && !reactionTarget.deleted && (
      <div className="reaction-dock">
        <div className="reaction-dock__context">
          <SmilePlus className="h-4 w-4 text-cyan" />
          <div className="min-w-0">
            <p className="reaction-dock__label">Reacting to {reactionTarget.sender_id === senderId ? 'you' : (reactionTarget.sender_name ?? 'member')}</p>
            <p className="reaction-dock__preview">{quoteLabel(reactionTarget)}</p>
          </div>
        </div>
        <div className="reaction-dock__emojis">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              className="reaction-picker-button"
              onClick={() => toggleReaction(reactionTarget, emoji)}
              disabled={!!reactionBusyIds[`${reactionTarget.id}:${emoji}`]}
              aria-label={`React ${emoji}`}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
        <button className="reaction-dock__close" onClick={() => setReactionPickerMessageId(null)} aria-label="Close reactions" type="button">
          <X className="h-4 w-4" />
        </button>
      </div>
    )}

    <footer className="neo-panel z-10 shrink-0 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
      <div className="grid gap-2">
        {replyingTo && (
          <div className="composer-reply">
            <div className="min-w-0">
              <p className="composer-reply__label">Replying to {replyingTo.sender_id === senderId ? 'you' : (replyingTo.sender_name ?? 'member')}</p>
              <p className="composer-reply__content">{quoteLabel(replyingTo)}</p>
            </div>
            <button className="message-delete-button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply" title="Cancel reply">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          className="min-h-10 w-full resize-none border-2 border-accent bg-bg px-3 py-2 text-sm text-text outline-none focus:border-cyan disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-14"
          placeholder={isJoined ? 'Type a transmission' : 'Join this channel to send'}
          disabled={!isJoined || recordingVoice}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {recordingVoice && (
          <div className="voice-recording-strip">
            <div className="flex min-w-0 items-center gap-2">
              <span className="voice-recording-dot" />
              <span className="truncate">Recording voice transmission</span>
            </div>
            <span className="code-font text-punch">{recordingTime}</span>
          </div>
        )}
        <div className="composer-actions">
          <label className={`composer-action-button composer-action-button--image ${uploadingImage || !isJoined || recordingVoice ? 'composer-control-disabled' : ''} ${uploadingImage ? 'cursor-wait opacity-70' : isJoined && !recordingVoice ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <ImagePlus className="h-4 w-4" />
            <span className="composer-label">{uploadingImage ? '[UP]' : '[IMG]'}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={uploadingImage || !isJoined || recordingVoice}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) sendImage(file).catch(() => undefined);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <label className={`composer-action-button composer-action-button--file ${uploadingFile || !isJoined || recordingVoice ? 'composer-control-disabled' : ''} ${uploadingFile ? 'cursor-wait opacity-70' : isJoined && !recordingVoice ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <Paperclip className="h-4 w-4" />
            <span className="composer-label">{uploadingFile ? '[FILE...]' : '[FILE]'}</span>
            <input
              type="file"
              accept=".pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf,text/plain,text/csv,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="hidden"
              disabled={uploadingFile || !isJoined || recordingVoice}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) sendFile(file).catch(() => undefined);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <button
            className={`composer-action-button composer-action-button--voice ${recordingVoice ? 'is-recording' : ''}`}
            onClick={recordingVoice ? stopVoiceRecording : startVoiceRecording}
            disabled={!isJoined || uploadingVoice}
          >
            {recordingVoice ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            <span className="composer-label">{recordingVoice ? '[STOP]' : uploadingVoice ? '[VOICE...]' : '[MIC]'}</span>
          </button>
          <Button className="composer-send-button" onClick={send} disabled={!isJoined || recordingVoice}>
            <Send className="h-4 w-4" />
            <span className="composer-label">[SEND]</span>
          </Button>
        </div>
      </div>
    </footer>
    </section>

    <aside className="neo-panel order-2 hidden min-h-0 min-w-0 overflow-y-auto p-3 sm:p-4 lg:order-2 lg:block">
      <div className="mb-5 border-b-2 border-accent/40 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="code-font flex items-center gap-2 text-xs tracking-[0.2em] text-cyan"><Radio className="h-4 w-4" />PARTICIPANTS</p>
          <span className="border border-cyan px-2 py-1 text-[10px] uppercase tracking-wider text-muted">{participants.length} Active</span>
        </div>
        <div className="mt-3 grid gap-2">
          {participantsLoading && <RoomLoadingRows />}
          {!participantsLoading && participants.length === 0 && <p className="text-sm text-muted">No active participants yet.</p>}
          {!participantsLoading && participants.map((participant) => (
            <div key={participant.sender_id} className={`border-2 px-3 py-2 text-sm ${participant.sender_id === senderId ? 'border-cyan bg-cyan/10' : 'border-accent/60 bg-panel'}`}>
              <p className="font-semibold uppercase">{participant.sender_id === senderId ? `${participant.sender_name} (You)` : participant.sender_name}</p>
              <p className="code-font mt-1 text-[10px] uppercase tracking-[0.14em] text-muted">{participant.sender_id === room.creator_id ? 'Creator' : 'Member'}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-5 border-b-2 border-accent/40 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="code-font flex items-center gap-2 text-xs tracking-[0.2em] text-cyan"><Images className="h-4 w-4" />IMAGE GALLERY</p>
          <span className="border border-cyan px-2 py-1 text-[10px] uppercase tracking-wider text-muted">{imageMessages.length} Images</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {imageMessages.length === 0 && <p className="col-span-3 text-sm text-muted">No shared images yet.</p>}
          {imageMessages.slice(-9).reverse().map((message) => (
            <a key={`gallery-${message.id}`} href={message.file_url} target="_blank" rel="noreferrer" className="gallery-thumb">
              <img src={message.file_url} alt={message.content ?? 'Shared image'} />
            </a>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="code-font flex items-center gap-2 text-xs tracking-[0.2em] text-cyan"><Rows2 className="h-4 w-4" />RECENT ACTIVE ROOMS</p>
        {roomsLoading && <LoadingSignal label="Syncing" className="code-font text-[10px] uppercase tracking-[0.14em] text-muted" />}
      </div>
      <div className="mt-3 grid gap-4">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase text-muted">Recent Private</p>
          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-1">
            {roomsLoading && <RoomLoadingRows />}
            {!roomsLoading && myRooms.filter((r) => (r.room_type ?? 'private') === 'private').length === 0 && <p className="text-sm text-muted">No active private rooms.</p>}
            {myRooms.filter((r) => (r.room_type ?? 'private') === 'private').map((r) => (
              <button key={`p-${r.code}`} onClick={() => nav(`/chat/${r.code}`)} className={`neo-action w-[220px] shrink-0 border-2 px-3 py-2 text-left text-sm sm:w-full ${r.code === room.code ? 'border-cyan bg-cyan/10' : 'border-accent/60 bg-panel hover:border-cyan'}`}>
                <p className="code-font tracking-widest">{r.code}</p>
                <p className="text-xs text-muted">{r.room_name ?? 'Private Room'}</p>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase text-muted">Recent Groups</p>
          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-1">
            {roomsLoading && <RoomLoadingRows />}
            {!roomsLoading && myRooms.filter((r) => (r.room_type ?? 'private') === 'group').length === 0 && <p className="text-sm text-muted">No active groups.</p>}
            {myRooms.filter((r) => (r.room_type ?? 'private') === 'group').map((r) => (
              <button key={`g-${r.code}`} onClick={() => nav(`/chat/${r.code}`)} className={`neo-action w-[220px] shrink-0 border-2 px-3 py-2 text-left text-sm sm:w-full ${r.code === room.code ? 'border-cyan bg-cyan/10' : 'border-accent/60 bg-panel hover:border-cyan'}`}>
                <p className="code-font tracking-widest">{r.code}</p>
                <p className="text-xs text-muted">{r.room_name ?? 'Group Room'}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
    {!!toast && (
      <div className="copy-toast code-font fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 text-xs uppercase tracking-[0.18em]">
        {toast}
      </div>
    )}
  </main>;
}

const RoomLoadingRows = () => (
  <>
    <div className="loading-row h-[58px] w-[220px] shrink-0 sm:w-full" />
    <div className="loading-row h-[58px] w-[220px] shrink-0 sm:w-full" />
  </>
);
