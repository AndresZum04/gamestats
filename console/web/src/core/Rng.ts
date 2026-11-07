/**
 * Random numbers from a seed (mulberry32). The same seed gives the same
 * sequence, so tests and the autoplay mode can replay a match exactly.
 */
export class Rng {
  #state: number;

  constructor(seed: number = Math.floor(Math.random() * 2 ** 32)) {
    this.#state = seed >>> 0;
  }

  /** A number in [0, 1). */
  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer from min to max, both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick from an empty list");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** A shuffled copy (Fisher-Yates); the input is not changed. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  /** A new generator whose seed comes from this one: independent but reproducible. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 2 ** 32));
  }
}
