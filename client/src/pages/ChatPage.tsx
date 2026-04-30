import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Link2, Radio, DoorOpen, Power, Rows2, ImagePlus, Menu, X, House } from 'lucide-react';
import { Button } from '../components/common/Button';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useLocalSender } from '../hooks/useLocalSender';
import { useCountdown } from '../hooks/useCountdown';
import { ThemeToggle } from '../components/common/ThemeToggle';

type Msg = { id?: string; sender_id: string; sender_name?: string; content?: string; type: 'text'|'image'|'voice'; file_url?: string; created_at?: string };
type Room = { id: string; code: string; creator_id: string; room_type: 'private' | 'group'; room_name: string; expires_at: string };
type SystemNotice = { id: string; text: string };

export default function ChatPage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const senderId = useLocalSender();
  const socket = useSocket();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [myRooms, setMyRooms] = useState<Array<{ code: string; room_name?: string; room_type?: 'private' | 'group'; expires_at: string }>>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [senderName, setSenderName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState('');
  const left = useCountdown(room?.expires_at ?? new Date().toISOString());

  const loadMyRooms = useCallback(async () => {
    const res = await api.get(`/users/${senderId}/rooms`);
    const rooms = res.data.data ?? [];
    setMyRooms(rooms);
    return rooms as Array<{ code: string; room_name?: string; room_type?: 'private' | 'group'; expires_at: string }>;
  }, [senderId]);

  useEffect(() => {
    (async () => {
      const roomRes = await api.get(`/rooms/${code.toUpperCase()}`);
      const roomData = roomRes.data.data as Room;
      setRoom(roomData);
      if (roomData.room_type === 'group') {
        const cached = sessionStorage.getItem(`nullchannel_group_name_${roomData.code}`) ?? '';
        setSenderName(cached);
        setNameInput(cached);
      } else {
        setSenderName('');
        setNameInput('');
      }
      const msgRes = await api.get(`/rooms/${code.toUpperCase()}/messages`);
      setMessages(msgRes.data.data);
      const rooms = await loadMyRooms();
      const alreadyJoined = roomData.creator_id === senderId || rooms.some((r) => r.code === roomData.code);
      setIsJoined(alreadyJoined);
    })().catch(() => setRoom(null));
  }, [code, loadMyRooms]);

  useEffect(() => {
    if (!room) return;
    socket.on('room-joined', () => {
      setIsJoined(true);
      setJoinBusy(false);
      setJoinError('');
      loadMyRooms().catch(() => undefined);
    });
    socket.on('socket-error', (payload: { code?: string; message?: string }) => {
      setJoinBusy(false);
      if (payload?.code === 'ROOM_FULL') {
        setJoinError('Private channel is full (max 2 users).');
        nav('/');
        return;
      }
      if (payload?.code === 'NAME_REQUIRED') {
        setJoinError('Enter a display name to join this group.');
        return;
      }
      if (payload?.message) setJoinError(payload.message);
    });
    socket.on('receive-message', (msg) => setMessages((p) => [...p, msg]));
    socket.on('user-left', (payload: { senderId?: string; senderName?: string }) => {
      if (payload?.senderId === senderId) return;
      const name = payload?.senderName ?? 'A user';
      setNotices((p) => [...p, { id: `${Date.now()}-${Math.random()}`, text: `${name} left the room` }]);
    });
    socket.on('room-expired', () => {
      setIsJoined(false);
      setRoom(null);
      loadMyRooms().catch(() => undefined);
      nav('/');
    });

    if (room.creator_id === senderId && (room.room_type !== 'group' || !!senderName)) {
      socket.emit('join-room', { roomCode: room.code, senderId, senderName: senderName || undefined });
    }

    return () => { socket.off('receive-message'); socket.off('room-expired'); socket.off('socket-error'); socket.off('user-left'); socket.off('room-joined'); };
  }, [room, socket, senderId, senderName, loadMyRooms, nav]);

  const joinCurrentRoom = () => {
    if (!room) return;
    if (room.room_type === 'group' && !senderName) {
      setJoinError('Enter a display name to join this group.');
      return;
    }
    if (!socket.connected) socket.connect();
    setJoinBusy(true);
    setJoinError('');
    socket.emit('join-room', { roomCode: room.code, senderId, senderName: senderName || undefined });
  };

  const send = () => {
    if (!room || !text.trim() || !isJoined) return;
    if (room.room_type === 'group' && !senderName) return;
    socket.emit('send-message', { roomCode: room.code, senderId, senderName: senderName || undefined, type: 'text', content: text.trim() });
    setText('');
  };

  const sendImage = async (file: File) => {
    if (!room || !isJoined) return;
    if (room.room_type === 'group' && !senderName) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) return;

    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('roomCode', room.code);
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

  const leaveRoom = async () => {
    if (!room || !isJoined) return;
    socket.emit('leave-room', { roomCode: room.code, senderId, senderName: senderName || undefined });
    await api.post(`/rooms/${room.code}/leave`, { senderId }).catch(() => undefined);
    setIsJoined(false);
    await loadMyRooms();
  };

  const terminateRoom = async () => {
    if (!room) return;
    await api.post(`/rooms/${room.code}/terminate`, { senderId });
    await loadMyRooms();
    nav('/');
  };

  if (!room) return <main className="grid min-h-screen place-items-center bg-bg p-6">
    <div className="neo-panel max-w-md p-8 text-center">
      <p className="code-font text-xs tracking-[0.2em] text-cyan">SESSION TERMINATED</p>
      <h2 className="mt-2 text-2xl font-black uppercase">Channel not found or expired</h2>
    </div>
  </main>;

  return <main className="mx-auto grid min-h-screen w-full max-w-7xl gap-3 bg-bg px-2 py-3 sm:gap-4 sm:px-4 sm:py-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-8 lg:py-8">
    {room.room_type === 'group' && !senderName && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="neo-panel w-full max-w-md p-6">
        <p className="code-font text-xs tracking-[0.2em] text-cyan">ENTER DISPLAY NAME</p>
        <h3 className="mt-2 text-xl font-bold uppercase">Name required to join room chat</h3>
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="Your name"
          className="mt-4 h-11 w-full border-2 border-accent bg-bg px-3"
          maxLength={24}
        />
        <Button
          className="mt-3 w-full"
          onClick={() => {
            const value = nameInput.trim();
            if (value.length < 2) return;
            sessionStorage.setItem(`nullchannel_group_name_${room.code}`, value);
            setSenderName(value);
            setTimeout(() => joinCurrentRoom(), 0);
          }}
        >
          Continue
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
            <Button className={!isJoined ? 'bg-accent text-bg' : ''} onClick={isJoined ? leaveRoom : joinCurrentRoom} disabled={joinBusy && !isJoined}>
              <DoorOpen className="mr-2 inline h-4 w-4" />
              {isJoined ? 'Leave Room' : (joinBusy ? 'Joining...' : 'Join Room')}
            </Button>
          )}
          <ThemeToggle />
          <Button onClick={() => navigator.clipboard.writeText(room.code)}><Copy className="mr-2 inline h-4 w-4" />Copy Channel ID</Button>
          <Button onClick={() => navigator.clipboard.writeText(window.location.href)}><Link2 className="mr-2 inline h-4 w-4" />Copy Invite Link</Button>
          <Button onClick={() => nav('/')}><House className="mr-2 inline h-4 w-4" />Home</Button>
          {room.creator_id === senderId && <Button className="border-red-400 text-red-300" onClick={terminateRoom}><Power className="mr-2 inline h-4 w-4" />Terminate</Button>}
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
                <Button className={!isJoined ? 'bg-accent text-bg' : ''} onClick={isJoined ? leaveRoom : joinCurrentRoom} disabled={joinBusy && !isJoined}>
                  <DoorOpen className="mr-2 inline h-4 w-4" />
                  {isJoined ? 'Leave Room' : (joinBusy ? 'Joining...' : 'Join Room')}
                </Button>
              )}
              <Button onClick={() => navigator.clipboard.writeText(room.code)}><Copy className="mr-2 inline h-4 w-4" />Copy Channel ID</Button>
              <Button onClick={() => navigator.clipboard.writeText(window.location.href)}><Link2 className="mr-2 inline h-4 w-4" />Copy Invite Link</Button>
              <Button onClick={() => nav('/')}><House className="mr-2 inline h-4 w-4" />Home</Button>
              {room.creator_id === senderId && <Button className="border-red-400 text-red-300" onClick={terminateRoom}><Power className="mr-2 inline h-4 w-4" />Terminate</Button>}
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
        {messages.map((m, i) => <article key={m.id ?? i} className={`max-w-[94%] border-2 p-2.5 text-sm shadow-panel sm:max-w-[82%] lg:max-w-[70%] ${m.sender_id === senderId ? 'ml-auto border-cyan bg-cyan/10' : 'border-accent bg-accent/10'}`}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">{m.sender_id === senderId ? 'You' : (m.sender_name ?? 'Member')}</p>
          {m.type === 'text' && <p className="whitespace-pre-wrap">{m.content}</p>}
          {m.type === 'image' && m.file_url && <img src={m.file_url} className="max-h-72 w-full object-cover" />}
          {m.type === 'voice' && m.file_url && <audio controls src={m.file_url} className="w-full" />}
        </article>)}
      </section>

    <footer className="neo-panel sticky bottom-0 z-10 p-2.5 sm:p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-11 w-full resize-y border-2 border-accent bg-bg px-3 py-2 text-sm text-text outline-none focus:border-cyan"
            placeholder="Type a transmission"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
        <label className="retro-upload-button neo-action inline-flex h-11 w-full cursor-pointer items-center justify-center border-2 border-accent bg-panel px-4 text-sm font-semibold uppercase tracking-wider text-text md:w-auto">
          <ImagePlus className="mr-2 h-4 w-4" />
          {uploadingImage ? 'Uploading' : 'Image'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={uploadingImage}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) sendImage(file).catch(() => undefined);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <Button className="h-11 w-full md:w-40" onClick={send} disabled={!isJoined}>Send</Button>
      </div>
    </footer>
    </section>

    <aside className="neo-panel order-2 h-fit min-w-0 p-3 sm:p-4 lg:order-2">
      <p className="code-font flex items-center gap-2 text-xs tracking-[0.2em] text-cyan"><Rows2 className="h-4 w-4" />RECENT ACTIVE ROOMS</p>
      <div className="mt-3 grid gap-4">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase text-muted">Recent Private</p>
          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-1">
            {myRooms.filter((r) => (r.room_type ?? 'private') === 'private').length === 0 && <p className="text-sm text-muted">No active private rooms.</p>}
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
            {myRooms.filter((r) => (r.room_type ?? 'private') === 'group').length === 0 && <p className="text-sm text-muted">No active groups.</p>}
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
  </main>;
}
