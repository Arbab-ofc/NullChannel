import { Shield, TimerReset, UserCheck, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '../components/common/Button';
import { api } from '../lib/api';

export default function LandingPage() {
  const nav = useNavigate();
  const [joinCode, setJoinCode] = useState('');

  const createChannel = async () => {
    const res = await api.post('/rooms');
    nav(`/chat/${res.data.data.code}`);
  };

  return <main className="min-h-screen bg-bg px-6 py-10">
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-wide">NULLCHANNEL</h1>
        <Button onClick={createChannel}>Create Channel</Button>
      </header>
      <section className="rounded-xl border border-violet-500/40 bg-panel p-8 shadow-panel">
        <h2 className="text-4xl font-semibold">Private channels that disappear.</h2>
        <p className="mt-3 max-w-2xl text-muted">Create a temporary channel, share the code, and chat in real time. No account required. Everything expires after 24 hours.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={createChannel}>Create Channel</Button>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="ENTER 8-CHAR CODE" className="rounded-md border border-violet-500/40 bg-bg px-3 py-2 text-sm" />
          <Button onClick={() => nav(`/chat/${joinCode}`)}>Join Channel</Button>
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'No signup', Icon: UserCheck },
          { label: '24-hour expiry', Icon: TimerReset },
          { label: 'Private channel', Icon: Shield },
          { label: 'Real-time', Icon: MessageCircle }
        ].map(({ label, Icon }) => (
          <div key={String(label)} className="rounded-lg border border-violet-500/30 bg-panel p-4">
            <Icon className="mb-2 h-4 w-4 text-cyan" />
            <p className="text-sm">{label}</p>
          </div>
        ))}
      </section>
      <p className="text-xs text-muted">MVP note: not fully end-to-end encrypted yet. HTTPS protects traffic in production.</p>
    </div>
  </main>;
}
