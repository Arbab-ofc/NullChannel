import { describe, expect, it } from 'vitest';
import { mergeHistory } from '../lib/messages';
describe('history and realtime synchronization', () => {
  it('deduplicates and preserves messages arriving while history loads', () => {
    const old = { id: 'old', created_at: '2026-01-01T00:00:00Z' }; const incoming = { id: 'new', created_at: '2026-01-01T00:01:00Z' };
    expect(mergeHistory([old,incoming],[incoming],new Set(['new']))).toEqual([old,incoming]);
  });
  it('uses the authoritative snapshot for offline changes and live edits for concurrent changes', () => {
    expect(mergeHistory([{ id: 'x', content: 'offline edit' }],[{ id: 'x', content: 'stale' }],new Set())).toEqual([{ id: 'x', content: 'offline edit' }]);
    expect(mergeHistory([{ id: 'x', content: 'stale snapshot' }],[{ id: 'x', content: 'live edit' }],new Set(['x']))).toEqual([{ id: 'x', content: 'live edit' }]);
  });
  it('does not resurrect a burned message or messages removed by a wipe', () => {
    expect(mergeHistory([{ id: 'burned' }],[],new Set(['burned']))).toEqual([]);
    const old = { id: 'old', created_at: '2026-01-01T00:00:00Z' }; const fresh = { id: 'fresh', created_at: '2026-01-01T00:01:00Z' };
    expect(mergeHistory([old,fresh],[fresh],new Set(['fresh']),Date.parse('2026-01-01T00:00:30Z'))).toEqual([fresh]);
  });
});
