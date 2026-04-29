import { TimerReset, UserCheck, MessageCircle, ArrowRight, Fingerprint } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '../components/common/Button';
import { api } from '../lib/api';
import { useLocalSender } from '../hooks/useLocalSender';
import { ThemeToggle } from '../components/common/ThemeToggle';

export default function LandingPage() {
  const nav = useNavigate();
  const senderId = useLocalSender();
  const [joinCode, setJoinCode] = useState('');
  const [roomName, setRoomName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [createType, setCreateType] = useState<'private' | 'group' | null>(null);
  const [activeRooms, setActiveRooms] = useState<Array<{ code: string; room_name: string; room_type: 'private' | 'group'; expires_at: string }>>([]);

  const createChannel = async (roomType: 'private' | 'group') => {
    const name = roomName.trim();
    if (name.length < 2) return;
    const res = await api.post('/rooms', { senderId, roomType, roomName: name });
    setCreateType(null);
    setRoomName('');
    nav(`/chat/${res.data.data.code}`);
  };

  useEffect(() => {
    api.get(`/users/${senderId}/rooms`).then((res) => setActiveRooms(res.data.data ?? [])).catch(() => setActiveRooms([]));
  }, [senderId]);

  const grouped = useMemo(() => ({
    private: activeRooms.filter((r) => (r.room_type ?? 'private') === 'private').slice(0, 6),
    group: activeRooms.filter((r) => (r.room_type ?? 'private') === 'group').slice(0, 6)
  }), [activeRooms]);

  return <main className="min-h-screen bg-bg px-3 py-4 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="neo-panel flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <p className="code-font text-xs tracking-[0.3em] text-cyan">NULLCHANNEL / PRIVATE RELAY</p>
          <h1 className="mt-1 text-2xl font-bold uppercase tracking-wide">NullChannel</h1>
        </div>
        <div className="hidden items-center gap-4 lg:flex">
          <ThemeToggle />
          <Button onClick={() => setCreateType('private')}>Create Private</Button>
          <Button onClick={() => setCreateType('group')}>Create Group</Button>
        </div>
        <button
          className="neo-action inline-flex h-11 w-11 items-center justify-center border-2 border-accent bg-panel lg:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>
      <>
        <button
          className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-250 lg:hidden ${menuOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
        />
        <aside className={`fixed right-0 top-0 z-50 h-full w-[82%] max-w-sm border-l-2 border-accent bg-panel p-4 shadow-panel transition-transform duration-300 ease-out lg:hidden ${menuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="mb-4 flex items-center justify-between">
            <p className="code-font text-xs tracking-[0.2em] text-cyan">QUICK ACTIONS</p>
            <button className="neo-action inline-flex h-10 w-10 items-center justify-center border-2 border-accent bg-panel" onClick={() => setMenuOpen(false)}><X className="h-5 w-5" /></button>
          </div>
          <div className="grid gap-2">
            <ThemeToggle />
            <Button onClick={() => setCreateType('private')}>Create Private</Button>
            <Button onClick={() => setCreateType('group')}>Create Group</Button>
          </div>
        </aside>
      </>

      <section className="neo-panel relative overflow-hidden p-5 sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute -right-5 -top-5 hidden h-16 w-16 border-2 border-punch bg-accent/20 sm:block lg:-right-8 lg:-top-8 lg:h-28 lg:w-28" />
        <p className="code-font text-xs tracking-[0.25em] text-cyan">UNAUTHENTICATED. TEMPORARY. LIVE.</p>
        <h2 className="mt-3 max-w-3xl text-4xl font-black uppercase leading-tight sm:text-6xl">Private channels that disappear.</h2>
        <p className="mt-4 max-w-3xl text-base text-muted sm:text-lg">Create a temporary channel, share the code, and chat in real time. No account required. Everything expires after 24 hours.</p>
        <div className="mt-8 grid gap-3 lg:grid-cols-4">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ENTER 8-CHAR CODE"
            className="h-12 w-full rounded-none border-2 border-accent bg-bg px-4 text-sm font-semibold tracking-widest text-text outline-none placeholder:text-muted focus:border-cyan"
          />
          <Button className="h-12 w-full lg:w-auto" onClick={() => nav(`/chat/${joinCode}`)}>Join Channel</Button>
          <Button className="h-12 bg-accent text-bg" onClick={() => setCreateType('private')}>Create Private</Button>
        </div>
        <div className="mt-6 flex flex-wrap gap-3 text-xs uppercase tracking-wider text-muted">
          <span className="border border-cyan px-3 py-1">No signup</span>
          <span className="border border-cyan px-3 py-1">24-hour expiry</span>
          <span className="border border-cyan px-3 py-1">Real-time transport</span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          <p className="mt-2 text-sm text-muted">No signup, temporary channels, and automatic data expiry.</p>
        </div>
        <div className="flex items-end justify-start sm:justify-end">
          <Button onClick={() => setCreateType('private')}>Start Transmission <ArrowRight className="ml-2 inline h-4 w-4" /></Button>
        </div>
      </section>

      <section className="neo-panel p-5 sm:p-6">
        <p className="code-font text-xs tracking-[0.2em] text-cyan">YOUR ACTIVE ROOMS</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-bold uppercase">Recent Private</h3>
            <div className="mt-2 space-y-2">
              {grouped.private.length === 0 && <p className="text-xs text-muted">No active private rooms.</p>}
              {grouped.private.map((r) => (
                <button key={`p-${r.code}`} className="neo-action w-full border-2 border-accent/60 px-3 py-2 text-left" onClick={() => nav(`/chat/${r.code}`)}>
                  <p className="code-font text-sm tracking-widest">{r.code}</p>
                  <p className="text-xs text-muted">{r.room_name} • Active</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase">Recent Groups</h3>
            <div className="mt-2 space-y-2">
              {grouped.group.length === 0 && <p className="text-xs text-muted">No active group rooms.</p>}
              {grouped.group.map((r) => (
                <button key={`g-${r.code}`} className="neo-action w-full border-2 border-accent/60 px-3 py-2 text-left" onClick={() => nav(`/chat/${r.code}`)}>
                  <p className="code-font text-sm tracking-widest">{r.code}</p>
                  <p className="text-xs text-muted">{r.room_name} • Active</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
    {createType && (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4">
        <div className="neo-panel w-full max-w-md p-5">
          <p className="code-font text-xs tracking-[0.2em] text-cyan">CREATE {createType.toUpperCase()} ROOM</p>
          <h3 className="mt-2 text-xl font-bold uppercase">Enter Room Name</h3>
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Room name"
            className="mt-4 h-11 w-full border-2 border-accent bg-bg px-3 text-sm"
            maxLength={40}
            autoFocus
          />
          <p className="mt-2 text-xs text-muted">Minimum 2 characters</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button onClick={() => { setCreateType(null); setRoomName(''); }}>Cancel</Button>
            <Button className="bg-accent text-bg" onClick={() => createChannel(createType)} disabled={roomName.trim().length < 2}>
              Create
            </Button>
          </div>
        </div>
      </div>
    )}
  </main>;
}
