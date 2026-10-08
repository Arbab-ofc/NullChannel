const windows = new Map<string, { count: number; until: number }>();
export const allowEvent = (key: string, limit: number, now = Date.now()) => {
  if (windows.size > 10000) for (const [k, v] of windows) if (v.until <= now) windows.delete(k);
  const entry = windows.get(key);
  if (!entry || entry.until <= now) {
    if (!entry && windows.size >= 20000) return false;
    windows.set(key, { count: 1, until: now + 60000 }); return true;
  }
  entry.count += 1;
  return entry.count <= limit;
};
