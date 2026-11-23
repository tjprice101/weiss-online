export function uid(len = 10): string {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(a, (b) => chars[b % chars.length]).join('');
}

export function uuid(): string {
  return crypto.randomUUID();
}

function randInt(n: number): number {
  // unbiased random int in [0, n)
  const max = Math.floor(0xffffffff / n) * n;
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a);
  while (a[0] >= max);
  return a[0] % n;
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomPick<T>(arr: T[]): T {
  return arr[randInt(arr.length)];
}

export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { flush: () => void } {
  let t: number | undefined;
  let lastArgs: any[] | null = null;
  const d = ((...args: any[]) => {
    lastArgs = args;
    clearTimeout(t);
    t = window.setTimeout(() => {
      lastArgs = null;
      fn(...args);
    }, ms);
  }) as T & { flush: () => void };
  d.flush = () => {
    if (lastArgs) {
      clearTimeout(t);
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    }
  };
  return d;
}

export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function lsSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}
