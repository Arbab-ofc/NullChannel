import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Link2, Radio, DoorOpen, Power, Rows2 } from 'lucide-react';
import { Button } from '../components/common/Button';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useLocalSender } from '../hooks/useLocalSender';
import { useCountdown } from '../hooks/useCountdown';

type Msg = { id?: string; sender_id: string; content?: string; type: 'text'|'image'|'voice'; file_url?: string; created_at?: string };
type Room = { id: string; code: string; creator_id: string; expires_at: string };

export default function ChatPage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const senderId = useLocalSender();
  const socket = useSocket();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [myRooms, setMyRooms] = useState<Array<{ code: string; expires_at: string }>>([]);
  const left = useCountdown(room?.expires_at ?? new Date().toISOString());

  const loadMyRooms = useCallback(async () => {
    const res = await api.get(`/users/${senderId}/rooms`);
    setMyRooms(res.data.data ?? []);
  }, [senderId]);

  useEffect(() => {
    (async () => {
      const roomRes = await api.get(`/rooms/${code.toUpperCase()}`);
      setRoom(roomRes.data.data);
      const msgRes = await api.get(`/rooms/${code.toUpperCase()}/messages`);
      setMessages(msgRes.data.data);
      await loadMyRooms();
    })().catch(() => setRoom(null));
  }, [code, loadMyRooms]);

  useEffect(() => {
    if (!room) return;
    socket.emit('join-room', { roomCode: room.code, senderId });
    socket.on('receive-message', (msg) => setMessages((p) => [...p, msg]));
    socket.on('room-expired', () => {
      setRoom(null);
      loadMyRooms().catch(() => undefined);
    });
    return () => { socket.off('receive-message'); socket.off('room-expired'); };
  }, [room, socket, senderId, loadMyRooms]);

  const send = () => {
    if (!room || !text.trim()) return;
    socket.emit('send-message', { roomCode: room.code, senderId, type: 'text', content: text.trim() });
    setText('');
  };

  const leaveRoom = async () => {
    if (!room) return;
    socket.emit('leave-room', { roomCode: room.code, senderId });
    await api.post(`/rooms/${room.code}/leave`, { senderId });
    await loadMyRooms();
    nav('/');
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

  return <main className="mx-auto grid min-h-screen w-full max-w-6xl gap-4 bg-bg px-4 py-5 sm:grid-cols-[1fr_280px] sm:px-8 sm:py-8">
    <section className="flex min-h-[80vh] flex-col gap-4">
      <header className="neo-panel p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="code-font text-xs tracking-[0.2em] text-cyan">NULLCHANNEL / SESSION ACTIVE</p>
            <p className="code-font mt-1 text-sm tracking-widest">CHANNEL ID: {room.code}</p>
          </div>
          <div className="text-right">
            <p className="code-font text-xs tracking-[0.2em] text-muted">EXPIRES IN</p>
            <p className="text-lg font-bold text-punch">{left}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => navigator.clipboard.writeText(room.code)}><Copy className="mr-2 inline h-4 w-4" />Copy Channel ID</Button>
          <Button onClick={() => navigator.clipboard.writeText(window.location.href)}><Link2 className="mr-2 inline h-4 w-4" />Copy Invite Link</Button>
          <Button onClick={leaveRoom}><DoorOpen className="mr-2 inline h-4 w-4" />Leave Room</Button>
          {room.creator_id === senderId && <Button className="border-red-400 text-red-300" onClick={terminateRoom}><Power className="mr-2 inline h-4 w-4" />Terminate</Button>}
          <span className="ml-auto inline-flex items-center gap-2 border-2 border-cyan bg-panel px-3 py-2 text-xs uppercase tracking-wider"><Radio className="h-4 w-4 text-cyan" />Connected</span>
        </div>
      </header>

      <section className="neo-panel flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
        {messages.length === 0 && <div className="border-2 border-dashed border-accent/60 p-5 text-sm text-muted">No transmissions yet. Send the first message.</div>}
        {messages.map((m, i) => <article key={m.id ?? i} className={`max-w-[85%] border-2 p-3 text-sm shadow-panel sm:max-w-[70%] ${m.sender_id === senderId ? 'ml-auto border-cyan bg-cyan/10' : 'border-accent bg-accent/10'}`}>
          {m.type === 'text' && <p className="whitespace-pre-wrap">{m.content}</p>}
          {m.type === 'image' && m.file_url && <img src={m.file_url} className="max-h-72 w-full object-cover" />}
          {m.type === 'voice' && m.file_url && <audio controls src={m.file_url} className="w-full" />}
        </article>)}
      </section>

      <footer className="neo-panel p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-12 w-full resize-y border-2 border-accent bg-bg px-3 py-2 text-sm text-text outline-none focus:border-cyan"
            placeholder="Type a transmission"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button className="h-12 sm:w-40" onClick={send}>Send</Button>
        </div>
      </footer>
    </section>

    <aside className="neo-panel h-fit p-4">
      <p className="code-font flex items-center gap-2 text-xs tracking-[0.2em] text-cyan"><Rows2 className="h-4 w-4" />ACTIVE ROOMS</p>
      <div className="mt-3 space-y-2">
        {myRooms.length === 0 && <p className="text-sm text-muted">You are not active in any room.</p>}
        {myRooms.map((r) => (
          <button key={r.code} onClick={() => nav(`/chat/${r.code}`)} className={`w-full border-2 px-3 py-2 text-left text-sm ${r.code === room.code ? 'border-cyan bg-cyan/10' : 'border-accent/60 bg-panel hover:border-cyan'}`}>
            <p className="code-font tracking-widest">{r.code}</p>
            <p className="text-xs text-muted">Expires: {new Date(r.expires_at).toLocaleString()}</p>
          </button>
        ))}
      </div>
    </aside>
  </main>;
}
