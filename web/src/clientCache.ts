// Client-side cache: recent API answers in memory and localStorage, so pages open instantly and refresh
// in the background. Storage can be full, blocked or private; every access is guarded and the app works without it.
const PREFIX = "cala-contour:";
const INDEX = `${PREFIX}index`; // keys, oldest first
const MAX = 12; // analyses can be a few hundred KB; a dozen keeps well inside the ~5 MB localStorage budget

const memory = new Map<string, unknown>();

function readIndex(): string[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX) ?? "[]");
  } catch {
    return [];
  }
}

function writeIndex(keys: string[]): void {
  try {
    localStorage.setItem(INDEX, JSON.stringify(keys));
  } catch {
    // Index lost: entries just stop being trimmed until it can be written again.
  }
}

/** The cached value for `key`, if any. Synchronous, so a page can render it before the network answers. */
export function peek<T>(key: string): T | undefined {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as T;
    memory.set(key, value);
    return value;
  } catch {
    return undefined;
  }
}

export function put<T>(key: string, value: T): T {
  memory.set(key, value);
  const keys = readIndex().filter((k) => k !== key);
  keys.push(key);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or blocked storage: keep it in memory only, and make room for next time.
    keys.splice(0, Math.max(1, keys.length - MAX));
  }
  while (keys.length > MAX) {
    const old = keys.shift()!;
    memory.delete(old);
    try { localStorage.removeItem(PREFIX + old); } catch { /* already gone */ }
  }
  writeIndex(keys);
  return value;
}

/** Drop every cached entry whose key starts with `prefix`, e.g. all reports of a template after an edit. */
export function forget(prefix: string): void {
  for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
  const keys = readIndex();
  for (const key of keys.filter((k) => k.startsWith(prefix))) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* already gone */ }
  }
  writeIndex(keys.filter((k) => !k.startsWith(prefix)));
}
