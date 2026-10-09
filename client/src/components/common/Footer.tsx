import { ArrowUpRight, Radio } from 'lucide-react';

export const Footer = () => <footer className="site-footer">
  <div className="site-footer__inner">
    <div className="site-footer__main">
      <div className="site-footer__identity">
        <a href="/" className="site-footer__brand" aria-label="NullChannel home">
          <span className="site-footer__mark" aria-hidden="true"><Radio strokeWidth={1.5} /></span>
          <span>NullChannel</span>
        </a>
        <p>Private conversations. Temporary connections.</p>
      </div>
      <p className="site-footer__credit">Designed &amp; developed by <span>Arbab<ArrowUpRight aria-hidden="true" /></span></p>
    </div>
    <div className="site-footer__bottom">
      <p>© {new Date().getFullYear()} NullChannel. All rights reserved.</p>
      <span className="site-footer__note"><span aria-hidden="true" />Temporary by design.</span>
    </div>
  </div>
</footer>;
