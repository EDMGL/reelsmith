/** Creates a unique id, optionally prefixed (e.g. `createId('clip')` -> "clip_3f2a..."). */
export function createId(prefix?: string): string {
  let raw: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    raw = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  } else {
    raw = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  return prefix ? `${prefix}_${raw}` : raw;
}
