/**
 * Seeded pseudo-random numbers. SPEC §5's determinism requirement.
 *
 * Two things depend on this, and both break silently without it:
 *
 *  - **Listener sync.** Every client must make the same "random" choice, because the
 *    seed comes from the server (epoch-minute + section id). Two listeners in the
 *    same room hearing different micro-timing would be worse than no humanisation.
 *  - **Reproducible renders.** §7.3 requires the same recording and seed to render a
 *    bit-identical WAV, which is the only way an A/B test compares two palettes
 *    rather than two different rolls of the dice.
 *
 * `Math.random` is banned by lint for exactly this reason.
 */

/**
 * Mulberry32. Chosen for being tiny, fast, well-distributed enough for timing and
 * timbre jitter, and — critically — identical across engines, because a PRNG whose
 * output differed between Node and Chromium would make the lab's renders disagree
 * with what listeners hear.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a 32-bit seed from a string, so a seed can be a readable identifier like
 * `"2026-10-14T18:03Z|section-7"` rather than an opaque number.
 *
 * FNV-1a: not cryptographic, and does not need to be — it needs to be stable and
 * identical everywhere.
 */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A PRNG per event, derived from the shared seed and the event id.
 *
 * Why not one stream for everything: a single sequence makes every draw depend on how
 * many events preceded it, so a client that connected a minute later — or a lab render
 * that started at a different offset — would diverge from then on. Per-event seeding
 * makes each event's jitter depend only on the event and the section seed.
 */
export function randomForEvent(sectionSeed: number, eventId: string): () => number {
  return mulberry32((sectionSeed ^ seedFromString(eventId)) >>> 0);
}

/** Pick from a list. Round-robin sample selection and timbre choice use this (§6.7). */
export function pick<T>(random: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

/** Humanised offset in seconds, within ±`spreadMs` (SPEC §6.7 point 4). */
export function humanise(random: () => number, spreadMs: number): number {
  return ((random() * 2 - 1) * spreadMs) / 1000;
}
