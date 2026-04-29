import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Copy } from 'lucide-react';
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

  if (!room) return <main className="grid min-h-screen place-items-center bg-bg p-6"><div className="rounded-lg border border-violet-500/40 bg-panel p-6">Channel not found or expired.</div></main>;

  return <main className="mx-auto flex min-h-screen max-w-4xl flex-col bg-bg p-4">
    <header className="mb-4 rounded-lg border border-violet-500/40 bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="code-font text-sm">CHANNEL ID: {room.code}</p><p className="text-sm">EXPIRES IN {left}</p></div>
      <Button className="mt-3" onClick={() => navigator.clipboard.writeText(room.code)}><Copy className="mr-2 inline h-4 w-4"/>Copy Channel ID</Button>
    </header>
    <section className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-violet-500/30 bg-panel p-4">
      {messages.map((m, i) => <div key={m.id ?? i} className={`max-w-[75%] rounded-md p-3 text-sm ${m.sender_id === senderId ? 'ml-auto bg-violet-800/40' : 'bg-zinc-900'}`}>
        {m.type === 'text' && <p>{m.content}</p>}
        {m.type === 'image' && m.file_url && <img src={m.file_url} className="rounded" />}
        {m.type === 'voice' && m.file_url && <audio controls src={m.file_url} className="w-full" />}
      </div>)}
    </section>
    <footer className="mt-3 flex gap-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-12 flex-1 rounded-md border border-violet-500/40 bg-panel p-2" placeholder="Type a transmission" />
      <Button onClick={send}>Send</Button>
    </footer>
  </main>;
}
