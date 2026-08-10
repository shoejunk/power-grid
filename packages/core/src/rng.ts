/**
 * Deterministic random stream, shared by every game on the platform.
 *
 * The generator is pure: given a seed and a cursor it always yields the same
 * value, so a game only has to persist its cursor to be exactly replayable.
 * Nothing here knows what the numbers are used for.
 */

/** FNV-1a — turns a seed string into a 32-bit integer. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
function mulberry32(a: number): number {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export class Rng {
  private readonly base: number;
  private cursor: number;

  constructor(seed: string, cursor = 0) {
    this.base = hashSeed(seed);
    this.cursor = cursor;
  }

  /** Current cursor — persist this alongside the seed. */
  get position(): number {
    return this.cursor;
  }

  /** Float in [0, 1). */
  next(): number {
    return mulberry32((this.base + this.cursor++ * 0x9e3779b9) | 0);
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) throw new RangeError('maxExclusive must be > 0');
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, max], both inclusive. */
  range(min: number, max: number): number {
    if (max < min) throw new RangeError('max must be >= min');
    return min + this.int(max - min + 1);
  }

  /**
   * A single die roll in [1, sides]. Named separately from `range` because
   * dice are a first-class concept in several games and reading `rng.die(6)`
   * at a call site is unambiguous about intent.
   */
  die(sides = 6): number {
    return this.range(1, sides);
  }

  /** Uniformly picks one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty array');
    return items[this.int(items.length)]!;
  }

  /** Fisher–Yates. Returns a new array; the input is untouched. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const a = out[i]!;
      const b = out[j]!;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  /** Removes and returns `count` random elements from `items` (mutates `items`). */
  takeRandom<T>(items: T[], count: number): T[] {
    const taken: T[] = [];
    for (let i = 0; i < count && items.length > 0; i++) {
      taken.push(items.splice(this.int(items.length), 1)[0]!);
    }
    return taken;
  }
}

/**
 * Alphabet for every human-typed identifier we mint. O/0 and I/1 are absent so
 * a code read aloud over voice chat cannot be mistyped.
 */
const UNAMBIGUOUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += UNAMBIGUOUS[Math.floor(Math.random() * UNAMBIGUOUS.length)];
  }
  return s;
}

/** Generates a fresh, human-typable seed. */
export function makeSeed(): string {
  return randomString(12);
}

/** Generates a short, unambiguous join code. */
export function makeGameCode(): string {
  return randomString(6);
}
