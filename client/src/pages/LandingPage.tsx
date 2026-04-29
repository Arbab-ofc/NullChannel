import { TimerReset, UserCheck, MessageCircle, ArrowRight, Fingerprint } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '../components/common/Button';
import { api } from '../lib/api';
import { useLocalSender } from '../hooks/useLocalSender';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { ensureRoomSecret } from '../lib/crypto';

export default function LandingPage() {
  const nav = useNavigate();
  const senderId = useLocalSender();
  const [joinCode, setJoinCode] = useState('');

  const createChannel = async () => {
    const res = await api.post('/rooms', { senderId });
    const secret = ensureRoomSecret();
    nav(`/chat/${res.data.data.code}#${secret}`);
  };

  return <main className="min-h-screen bg-bg px-4 py-6 sm:px-8 sm:py-10">
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="neo-panel flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <p className="code-font text-xs tracking-[0.3em] text-cyan">NULLCHANNEL / PRIVATE RELAY</p>
          <h1 className="mt-1 text-2xl font-bold uppercase tracking-wide">NullChannel</h1>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Button onClick={createChannel}>Create Channel</Button>
        </div>
      </header>

      <section className="neo-panel relative overflow-hidden p-6 sm:p-10">
        <div className="absolute -right-8 -top-8 h-28 w-28 border-2 border-punch bg-accent/20" />
        <p className="code-font text-xs tracking-[0.25em] text-cyan">UNAUTHENTICATED. TEMPORARY. LIVE.</p>
        <h2 className="mt-3 max-w-3xl text-4xl font-black uppercase leading-tight sm:text-6xl">Private channels that disappear.</h2>
        <p className="mt-4 max-w-3xl text-base text-muted sm:text-lg">Create a temporary channel, share the code, and chat in real time. No account required. Everything expires after 24 hours.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ENTER 8-CHAR CODE"
            className="h-12 w-full rounded-none border-2 border-accent bg-bg px-4 text-sm font-semibold tracking-widest text-text outline-none placeholder:text-muted focus:border-cyan"
          />
          <Button className="h-12" onClick={() => nav(`/chat/${joinCode}`)}>Join Channel</Button>
          <Button className="h-12 bg-accent text-bg" onClick={createChannel}>Create Channel</Button>
        </div>
        <div className="mt-6 flex flex-wrap gap-3 text-xs uppercase tracking-wider text-muted">
          <span className="border border-cyan px-3 py-1">No signup</span>
          <span className="border border-cyan px-3 py-1">24-hour expiry</span>
          <span className="border border-cyan px-3 py-1">Real-time transport</span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'No account required', Icon: UserCheck },
          { label: 'Automatic room expiry', Icon: TimerReset },
          { label: 'Confidential channel IDs', Icon: Fingerprint },
          { label: 'Low-latency relay', Icon: MessageCircle }
        ].map(({ label, Icon }) => (
          <article key={label} className="neo-panel p-4">
            <Icon className="h-5 w-5 text-punch" />
            <p className="mt-3 font-semibold uppercase">{label}</p>
          </article>
        ))}
      </section>

      <section className="neo-panel grid gap-4 p-6 sm:grid-cols-2">
        <div>
          <p className="code-font text-xs tracking-[0.2em] text-cyan">PRIVACY NOTE</p>
          <p className="mt-2 text-sm text-muted">MVP is not fully end-to-end encrypted. HTTPS protects transport in production. Messages and media are scheduled for automatic deletion after room expiry.</p>
        </div>
        <div className="flex items-end justify-start sm:justify-end">
          <Button onClick={createChannel}>Start Transmission <ArrowRight className="ml-2 inline h-4 w-4" /></Button>
        </div>
      </section>
    </div>
  </main>;
}
