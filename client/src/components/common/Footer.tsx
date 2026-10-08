export const Footer = () => <footer className="site-footer mx-auto max-w-6xl border-t-2 border-accent/40 px-4 py-7 text-muted sm:px-6">
  <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
    <div><p className="code-font font-bold tracking-[0.18em] text-cyan">NULLCHANNEL</p><p className="mt-2 text-sm">Private conversations. Temporary connections.</p></div>
    <p className="text-sm">Designed and developed by <span className="code-font border-b-2 border-punch pb-1 font-semibold text-text">Arbab</span></p>
  </div>
  <p className="code-font mt-6 text-xs">© {new Date().getFullYear()} NullChannel. All rights reserved.</p>
</footer>;
