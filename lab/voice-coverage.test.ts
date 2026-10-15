/**
 * Every event type the city can emit is claimed by a voice, or is listed here as
 * deliberately silent. SPEC §1.3, §6.4.
 *
 * The test exists because of `altitude_band`. It had a salience, a caption template,
 * a glyph on the map and 9% of every event the detector produced — and no voice's
 * `handles` ever returned true for it, so every one of those events was captioned on
 * the page and made no sound. Nothing failed: the engine treats an unclaimed event
 * the same way it treats one the voice budget refused, so the only trace was a
 * dropped count that looked like governor pressure.
 *
 * Which is the shape of every bug this file is about. A silent event type cannot be
 * found by listening (§7.2) — the piece just has less in it than it should.
 */

import { describe, expect, it } from 'vitest';
import * as Tone from 'tone';
import { loadScore } from '../server/src/config.js';
import {
  EVENT_TYPES,
  type AudioConfig,
  type EventType,
  type PublicEvent,
} from '../shared/protocol.js';
import { SampleKit } from '../client/src/audio/samples.js';
import { aircraftVoices, requiredInstruments } from '../client/src/audio/voices/aircraft.js';
import { RailVoice } from '../client/src/audio/voices/rail.js';
import { TapVoice } from '../client/src/audio/voices/tap.js';

/**
 * Event types with no voice on purpose.
 *
 * `sunrise` and `sunset` are §6.1 "moments", and §6.4 gives them no instrument —
 * what a sunrise sounds like is a [HUMAN] decision in §15, not something to invent
 * here. They fire twice a day, so the cost of the gap is small and the cost of
 * guessing is a sound nobody chose. Any other type on this list is a bug.
 */
const DELIBERATELY_SILENT: readonly EventType[] = ['sunrise', 'sunset'];

/** A kit needs one note to exist; nothing here plays, so the buffer is never read. */
function stubKits(names: readonly string[]): Map<string, SampleKit> {
  const buffer = {} as Tone.ToneAudioBuffer;
  return new Map(names.map((name) => [name, new SampleKit(name, [{ midi: 60, buffer }])]));
}

function eventOf(type: EventType): PublicEvent {
  return {
    id: `test-${type}`,
    t: 0,
    type,
    geo: { lat: 40.742, lon: -74.178, alt_ft: 6000 },
    rel: { bearing_deg: 90, distance_km: 8 },
    attrs: {
      category: null,
      heavy: false,
      described_as: 'an airliner',
      operator: null,
      vrate_fpm: 0,
      track_deg: 90,
    },
    salience: 0.5,
    tier: 'voice',
    caption: '',
    sim: false,
    scheduled: false,
  };
}

describe('voice coverage', () => {
  // What the server sends a listener: the score, plus the one field the governor
  // owns (see server/src/dev-replay.ts).
  const score = loadScore();
  const audio: AudioConfig = {
    ...score.audio,
    governor_texture_gain: score.governor.texture_gain,
  };
  const voices = [
    ...aircraftVoices(audio, stubKits(requiredInstruments(audio))),
    new RailVoice(audio),
    new TapVoice(audio),
  ];

  it('builds every aircraft voice when the kits are present', () => {
    // The guard against the other half of the same failure: a manifest that lists
    // too few kits silently removes voices, so the count is pinned.
    expect(voices.map((voice) => voice.name).sort()).toEqual([
      'altitude_band',
      'ewr_arrival',
      'ewr_departure',
      'helicopter',
      'overflight_city',
      'overflight_high',
      'path',
      'sky',
      'tap',
    ]);
  });

  for (const type of EVENT_TYPES) {
    const silent = DELIBERATELY_SILENT.includes(type);
    it(`${type} is ${silent ? 'silent on purpose' : 'claimed by exactly one voice'}`, () => {
      const claiming = voices.filter((voice) => voice.handles(eventOf(type)));
      if (silent) {
        expect(claiming).toEqual([]);
      } else {
        // Exactly one: two voices claiming a type means the second never plays,
        // since the engine takes the first that answers.
        expect(claiming.map((voice) => voice.name)).toHaveLength(1);
      }
    });
  }
});
