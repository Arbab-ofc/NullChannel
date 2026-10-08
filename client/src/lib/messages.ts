type Identified = { id?: string; created_at?: string };
// Realtime mutations received during a history request take precedence over its snapshot.
export const mergeHistory = <T extends Identified>(history: T[], current: T[], changed: Set<string>, wipedAt = 0): T[] => {
  const live = new Map(current.filter(message => message.id).map(message => [message.id!, message]));
  const merged = new Map<string, T>();
  for (const message of history) {
    if (!message.id) continue;
    const value = changed.has(message.id) ? live.get(message.id) : message;
    if (value) merged.set(message.id, value);
  }
  for (const id of changed) if (live.has(id)) merged.set(id, live.get(id)!);
  return [...merged.values()].filter(message => !wipedAt || (message.created_at && Date.parse(message.created_at) > wipedAt))
    .sort((a, b) => (Date.parse(a.created_at ?? '') || 0) - (Date.parse(b.created_at ?? '') || 0) || (a.id ?? '').localeCompare(b.id ?? ''));
};
