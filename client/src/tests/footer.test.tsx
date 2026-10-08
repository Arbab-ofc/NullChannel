// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Footer } from '../components/common/Footer';
it('uses semantic footer, dynamic year and exact brand and credit',() => {
  const html = renderToStaticMarkup(<Footer />);
  expect(html).toContain('<footer'); expect(html).toContain('NULLCHANNEL'); expect(html).toContain(String(new Date().getFullYear()));
  expect(html).toContain('Private conversations. Temporary connections.'); expect(html).toContain('Designed and developed by'); expect(html).toContain('Arbab');
});
