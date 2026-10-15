/**
 * The pitch arithmetic the sampled voices depend on. SPEC §6.9, §7.2.
 *
 * Both functions here fail silently by design of the problem: a wrong fold plays the
 * whole piece in the wrong octave, a wrong pick plays every note on the wrong
 * recording. Neither throws, neither logs, and Claude cannot hear either of them
 * (§7.2) — which is the definition of the logic CLAUDE.md says to test.
 */

import { describe, expect, it } from 'vitest';
import { foldToRegister, nearestNote } from './types.js';

describe('foldToRegister — an instrument only speaks in its own register', () => {
  const chimes = [60, 91]; // what score.yaml gives overflight_city

  it('leaves a note that is already inside alone', () => {
    expect(foldToRegister(72, chimes)).toBe(72);
    expect(foldToRegister(60, chimes)).toBe(60);
    expect(foldToRegister(91, chimes)).toBe(91);
  });

  it('folds by whole octaves, so the scale degree survives', () => {
    // §6.2 promises no wrong notes, ever. That holds only if folding moves a note by
    // a multiple of twelve: anything else lands it outside the palette.
    for (const midi of [30, 41, 55, 59, 92, 100, 127]) {
      const folded = foldToRegister(midi, chimes);
      // Math.abs because a downward fold gives -0, and -0 is not 0 to `toBe`.
      expect(Math.abs(folded - midi) % 12).toBe(0);
      expect(folded).toBeGreaterThanOrEqual(60);
      expect(folded).toBeLessThanOrEqual(91);
    }
  });

  it('does not collapse the bottom of the range onto one note', () => {
    // This is the whole reason it folds rather than clamps. Clamping mapped every
    // low altitude to the same pitch, which is the monotony the sampled voices exist
    // to escape — so two notes an octave apart below the register must stay apart.
    expect(foldToRegister(45, chimes)).not.toBe(foldToRegister(50, chimes));
  });

  it('clamps rather than loops when the register is narrower than an octave', () => {
    // Folding has nowhere to land inside a seven-semitone window, and a `while` loop
    // over it would never terminate.
    expect(foldToRegister(40, [70, 77])).toBe(70);
    expect(foldToRegister(100, [70, 77])).toBe(77);
    expect(foldToRegister(73, [70, 77])).toBe(73);
  });

  it('passes a note through when the register is missing or inverted', () => {
    expect(foldToRegister(64, [])).toBe(64);
    expect(foldToRegister(64, [90, 50])).toBe(64);
  });
});

describe('nearestNote — which recording to bend', () => {
  // The real tubular-bell kit: nine files, sixteen semitones.
  const chimes = [72, 74, 76, 78, 80, 82, 84, 86, 88];

  it('picks an exact match when there is one', () => {
    expect(nearestNote(chimes, 80)).toBe(80);
  });

  it('picks the nearest neighbour otherwise', () => {
    expect(nearestNote(chimes, 81)).toBe(80);
    expect(nearestNote(chimes, 83)).toBe(82);
  });

  it('picks the lower sample on a tie', () => {
    // Bending up shortens the note and sharpens the attack; bending down softens it.
    // On a struck sound the sharper of the two is the less wrong.
    expect(nearestNote(chimes, 73)).toBe(72);
    expect(nearestNote([60, 72], 66)).toBe(60);
  });

  it('clamps to the ends of the kit, since a register may still ask beyond them', () => {
    expect(nearestNote(chimes, 40)).toBe(72);
    expect(nearestNote(chimes, 120)).toBe(88);
  });

  it('does not care about the order it is given', () => {
    expect(nearestNote([88, 72, 80, 76], 79)).toBe(80);
  });

  it('returns the asked-for note when the kit is empty', () => {
    expect(nearestNote([], 64)).toBe(64);
  });
});
