import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Link2, Radio, DoorOpen, Power, Rows2, ImagePlus, Menu, X, House, Trash2, Mic, Square } from 'lucide-react';
import { Button } from '../components/common/Button';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useLocalSender } from '../hooks/useLocalSender';
import { useCountdown } from '../hooks/useCountdown';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { LoadingSignal } from '../components/common/LoadingSignal';

type Msg = { id?: string; sender_id: string; sender_name?: string; content?: string; type: 'text'|'image'|'voice'; file_url?: string; created_at?: string };
type Room = { id: string; code: string; creator_id: string; room_type: 'private' | 'group'; room_name: string; expires_at: string };
type SystemNotice = { id: string; text: string };
type TypingPayload = { roomCode?: string; senderId?: string; senderName?: string };
type Participant = { sender_id: string; sender_name: string; joined_at: string };

const VOICE_MAX_MS = 2 * 60 * 1000;

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
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [deletingMessageIds, setDeletingMessageIds] = useState<Record<string, boolean>>({});
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
  const [joinError, setJoinError] = useState('');
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [expiredNotice, setExpiredNotice] = useState(false);
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

  const showExpiredPopup = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
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
    socket.on('message-deleted', (payload: { messageId?: string }) => {
      if (!payload.messageId) return;
      setMessages((p) => p.filter((message) => message.id !== payload.messageId));
      setDeletingMessageIds((p) => {
        const next = { ...p };
        delete next[payload.messageId as string];
        return next;
      });
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
    socket.on('room-expired', () => {
      setIsJoined(false);
      setTypingUsers({});
      loadMyRooms().catch(() => undefined);
      showExpiredPopup();
    });

    if (room.creator_id === senderId && !!senderName) {
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
      socket.off('room-joined');
      Object.values(typingTimeouts.current).forEach((id) => window.clearTimeout(id));
      typingTimeouts.current = {};
    };
  }, [room, socket, senderId, senderName, loadMyRooms, loadParticipants, showExpiredPopup, nav]);

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
    socket.emit('send-message', { roomCode: room.code, senderId, senderName: senderName || undefined, type: 'text', content: text.trim() });
    setText('');
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
        filePath: res.data.data.fileId ?? res.data.data.filePath
      });
    } finally {
      setUploadingImage(false);
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
        filePath: res.data.data.fileId ?? res.data.data.filePath
      });
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
      setMessages((p) => p.filter((message) => message.id !== deletedId));
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

  const terminateRoom = async () => {
    if (!room || terminateBusy) return;
    setTerminateBusy(true);
    try {
      await api.post(`/rooms/${room.code}/terminate`, { senderId });
      await loadMyRooms();
      nav('/');
    } finally {
      setTerminateBusy(false);
    }
  };

  const typingNames = Object.values(typingUsers);
  const typingLabel = typingNames.length > 1 ? `${typingNames.slice(0, 2).join(', ')} are typing` : `${typingNames[0] ?? 'Someone'} is typing`;
  const recordingTime = `${Math.floor(recordingSeconds / 60).toString().padStart(2, '0')}:${(recordingSeconds % 60).toString().padStart(2, '0')}`;

  if (expiredNotice) return <main className="grid min-h-screen place-items-center bg-bg p-6">
    <div className="neo-panel loading-panel max-w-md p-8 text-center">
      <p className="code-font text-xs tracking-[0.2em] text-punch">ROOM EXPIRED</p>
      <h2 className="mt-2 text-2xl font-black uppercase">This channel has disappeared</h2>
      <p className="mt-3 text-sm text-muted">You will be redirected home in 3 seconds.</p>
      <LoadingSignal label="Closing session" className="mt-5 justify-center text-sm uppercase tracking-[0.16em] text-muted" />
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

  return <main className="mx-auto grid min-h-screen w-full max-w-7xl gap-3 bg-bg px-2 py-3 sm:gap-4 sm:px-4 sm:py-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-8 lg:py-8">
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
    <section className="order-1 flex min-h-[68vh] min-w-0 flex-col gap-3 lg:order-1 lg:min-h-[82vh] lg:gap-4">
      <header className="neo-panel p-3 sm:p-4 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="code-font text-xs tracking-[0.2em] text-cyan">NULLCHANNEL / SESSION ACTIVE</p>
            <p className="mt-1 text-sm font-semibold uppercase">{room.room_name}</p>
            <p className="code-font mt-1 text-sm tracking-widest">CHANNEL ID: {room.code}</p>
          </div>
          <div className="text-right">
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
          {room.creator_id === senderId && <Button className="border-red-400 text-red-300" onClick={terminateRoom} disabled={terminateBusy}><Power className="mr-2 inline h-4 w-4" />{terminateBusy ? <LoadingSignal label="Terminating" /> : 'Terminate'}</Button>}
          {isJoined && <span className="ml-auto inline-flex items-center gap-2 border-2 border-cyan bg-panel px-3 py-2 text-xs uppercase tracking-wider"><Radio className="h-4 w-4 text-cyan" />Connected</span>}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 xl:hidden">
          {isJoined ? <span className="inline-flex items-center gap-2 border-2 border-cyan bg-panel px-3 py-2 text-xs uppercase tracking-wider"><Radio className="h-4 w-4 text-cyan" />Connected</span> : <span className="inline-flex items-center gap-2 border-2 border-accent bg-panel px-3 py-2 text-xs uppercase tracking-wider text-muted">Not Joined</span>}
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
              {room.creator_id === senderId && <Button className="border-red-400 text-red-300" onClick={terminateRoom} disabled={terminateBusy}><Power className="mr-2 inline h-4 w-4" />{terminateBusy ? <LoadingSignal label="Terminating" /> : 'Terminate'}</Button>}
            </div>
          </aside>
        </>
      </header>

      <section className="neo-panel flex-1 space-y-3 overflow-y-auto p-3 sm:p-4 lg:p-6">
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
        {messages.map((m, i) => <article key={m.id ?? i} className={`group relative max-w-[94%] border-2 p-2.5 text-sm shadow-panel sm:max-w-[82%] lg:max-w-[70%] ${m.sender_id === senderId ? 'ml-auto border-cyan bg-cyan/10' : 'border-accent bg-accent/10'}`}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">{m.sender_id === senderId ? 'You' : (m.sender_name ?? 'Member')}</p>
            {m.sender_id === senderId && m.id && (
              <button
                className="message-delete-button"
                onClick={() => deleteMessage(m.id)}
                disabled={!!deletingMessageIds[m.id]}
                aria-label="Delete message"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{deletingMessageIds[m.id] ? 'Deleting' : 'Delete'}</span>
              </button>
            )}
          </div>
          {m.type === 'text' && <p className="whitespace-pre-wrap">{m.content}</p>}
          {m.type === 'image' && m.file_url && <img src={m.file_url} className="max-h-72 w-full object-cover" />}
          {m.type === 'voice' && m.file_url && <audio controls src={m.file_url} className="w-full" />}
        </article>)}
      </section>

    <footer className="neo-panel sticky bottom-0 z-10 p-2.5 sm:p-3">
      <div className="grid gap-2">
        <textarea
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          className="min-h-16 w-full resize-y border-2 border-accent bg-bg px-3 py-2 text-sm text-text outline-none focus:border-cyan disabled:cursor-not-allowed disabled:opacity-60"
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
        {typingNames.length > 0 && (
          <div className="typing-indicator md:hidden">
            <LoadingSignal label={typingLabel} />
          </div>
        )}
        <div className="composer-actions">
          <label className={`composer-action-button ${uploadingImage ? 'cursor-wait opacity-70' : isJoined && !recordingVoice ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <ImagePlus className="h-4 w-4" />
            <span>{uploadingImage ? 'Uploading' : 'Image'}</span>
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
          <button
            className={`composer-action-button ${recordingVoice ? 'is-recording' : ''}`}
            onClick={recordingVoice ? stopVoiceRecording : startVoiceRecording}
            disabled={!isJoined || uploadingVoice}
          >
            {recordingVoice ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            <span>{recordingVoice ? 'Stop' : uploadingVoice ? 'Sending voice' : 'Voice'}</span>
          </button>
          <Button className="h-11 w-full md:ml-auto md:w-36" onClick={send} disabled={!isJoined || recordingVoice}>Send</Button>
        </div>
      </div>
      {typingNames.length > 0 && (
        <div className="typing-indicator mt-2 hidden md:inline-flex">
          <LoadingSignal label={typingLabel} />
        </div>
      )}
    </footer>
    </section>

    <aside className="neo-panel order-2 h-fit min-w-0 p-3 sm:p-4 lg:order-2">
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
