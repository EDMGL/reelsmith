/** Small seedable PRNG (mulberry32) — every random choice in a recipe goes through one of these. */

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  private state: number;
  readonly seed: number;
  constructor(seed: number | string) {
    this.seed = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 0x9e3779b9;
    this.state = this.seed;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, bInclusive: number): number {
    return a + Math.floor(this.next() * (bInclusive - a + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  /** Approximately normal, mean 0, sd 1 (sum of uniforms), bounded to ±3. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
  /** Independent child stream (so adding a part does not shift the others). */
  fork(label: string): Rng {
    return new Rng((hashString(label) ^ Math.imul(this.seed, 2654435761)) >>> 0);
  }
}
