import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Copy, Link2, Radio } from 'lucide-react';
import { Button } from '../components/common/Button';
import { api } from '../lib/api';
import { useSocket } from '../hooks/useSocket';
import { useLocalSender } from '../hooks/useLocalSender';
import { useCountdown } from '../hooks/useCountdown';

type Msg = { id?: string; sender_id: string; content?: string; type: 'text'|'image'|'voice'; file_url?: string; created_at?: string };

export default function ChatPage() {
  const { code = '' } = useParams();
  const senderId = useLocalSender();
  const socket = useSocket();
  const [room, setRoom] = useState<{ id: string; code: string; expires_at: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const left = useCountdown(room?.expires_at ?? new Date().toISOString());

  useEffect(() => {
    (async () => {
      const roomRes = await api.get(`/rooms/${code.toUpperCase()}`);
      setRoom(roomRes.data.data);
      const msgRes = await api.get(`/rooms/${code.toUpperCase()}/messages`);
      setMessages(msgRes.data.data);
    })().catch(() => setRoom(null));
  }, [code]);

  useEffect(() => {
    if (!room) return;
    socket.emit('join-room', { roomCode: room.code });
    socket.on('receive-message', (msg) => setMessages((p) => [...p, msg]));
    socket.on('room-expired', () => setRoom(null));
    return () => { socket.off('receive-message'); socket.off('room-expired'); };
  }, [room, socket]);

  const send = () => {
    if (!room || !text.trim()) return;
    socket.emit('send-message', { roomCode: room.code, senderId, type: 'text', content: text.trim() });
    setText('');
  };

  if (!room) return <main className="grid min-h-screen place-items-center bg-bg p-6">
    <div className="neo-panel max-w-md p-8 text-center">
      <p className="code-font text-xs tracking-[0.2em] text-cyan">SESSION TERMINATED</p>
      <h2 className="mt-2 text-2xl font-black uppercase">Channel not found or expired</h2>
    </div>
  </main>;

  return <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 bg-bg px-4 py-5 sm:px-8 sm:py-8">
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
  </main>;
}
