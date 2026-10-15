/**
 * The city, seen from where you are standing. SPEC §1.1, §10.
 *
 * The listener is the centre of the picture, not the airport: north is up, and an
 * aircraft's glyph sits at its true bearing and distance from NJIT. That is the one
 * claim this drawing makes, and it is the same claim the stereo field will make.
 *
 * Distance is drawn on a square-root scale. Linear would crush everything that
 * matters — half the events happen inside 6 km of a 40 km horizon — and logarithmic
 * would exaggerate the far edge into significance it does not have.
 *
 * **Safety (§10, non-negotiable):** nothing here blinks. An event announces itself by
 * growing over `arrival_grow_s` and then fading over `event_life_s`, so no pixel
 * changes faster than a slow breath, let alone the 3 Hz photosensitivity limit. Under
 * `prefers-reduced-motion` the growth is skipped and the glyph simply appears.
 */

import type { PublicEvent, VisualConfig } from '../../../shared/protocol.js';
import { drawGlyph, type GlyphKind } from './glyphs.js';

export interface Drawn {
  readonly event: PublicEvent;
  /** Server-clock ms at which this becomes visible. */
  readonly playAt: number;
}

const COLOURS: Record<PublicEvent['type'], string> = {
  ewr_departure: '#e8b23a',
  ewr_arrival: '#5fb3d4',
  overflight_city: '#9d8cc4',
  overflight_high: '#6b7a8f',
  helicopter: '#d47a5f',
  // A ring crossing is drawn in the quietest colour on the page. Its size already
  // follows salience, which already follows distance, so one colour covers a 30 km
  // whisper and a 5 km one (§6.5).
  sky: '#6b8099',
  // An altitude crossing belongs to the same aircraft family as the rings, one step
  // warmer so a climb reads differently from a position.
  altitude_band: '#7e8fa6',
  // Rail is warm where the sky is cool, so a train is distinguishable from an
  // aircraft at a glance and without reading the caption.
  path_approaching: '#9c8f5a',
  path_arrival: '#d6c178',
};

/**
 * What each event type looks like. A plane is a plane and a train is a train: the
 * question "can we show an aircraft instead of a triangle?" had a good answer, since
 * the ground track needed for it was already in the feed and simply not kept.
 */
const GLYPHS: Record<PublicEvent['type'], GlyphKind> = {
  ewr_departure: 'plane',
  ewr_arrival: 'plane',
  overflight_city: 'plane',
  overflight_high: 'plane',
  sky: 'plane',
  altitude_band: 'plane',
  helicopter: 'helicopter',
  path_approaching: 'train',
  path_arrival: 'train',
};

export class CityMap {
  private readonly context: CanvasRenderingContext2D;
  private drawn: Drawn[] = [];
  private reducedMotion = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private visual: VisualConfig,
  ) {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('canvas 2d context unavailable');
    this.context = context;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = query.matches;
    query.addEventListener('change', (event) => (this.reducedMotion = event.matches));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  configure(visual: VisualConfig): void {
    this.visual = visual;
  }

  add(events: readonly PublicEvent[], playAt: number): void {
    for (const event of events) this.drawn.push({ event, playAt });
  }

  get visible(): number {
    return this.drawn.length;
  }

  private resize(): void {
    const ratio = window.devicePixelRatio;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  /** `serverNow` is the shared clock, not local wall time (§9.4). */
  render(serverNow: number): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const centreX = width / 2;
    const radius = Math.min(width, height) / 2 - 28;
    // On a phone the canvas is far taller than it is wide, so a centred circle leaves
    // a band of nothing above it and the captions sit over a second band below. The
    // circle moves up instead and the captions get the space they were overlapping.
    const centreY = Math.min(height / 2, radius + 44);
    const context = this.context;

    context.clearRect(0, 0, width, height);
    this.drawRings(centreX, centreY, radius);

    const lifeMs = this.visual.event_life_s * 1000;
    this.drawn = this.drawn.filter((item) => serverNow - item.playAt < lifeMs);

    for (const item of this.drawn) {
      const age = serverNow - item.playAt;
      if (age < 0) continue;
      const growMs = this.reducedMotion ? 0 : this.visual.arrival_grow_s * 1000;
      const grow = growMs === 0 ? 1 : Math.min(1, age / growMs);
      const fade = 1 - age / lifeMs;
      this.drawEvent(item.event, centreX, centreY, radius, grow, fade);
    }
  }

  /** Square-root scale: see the note at the top of the file. */
  private pixelsFor(km: number, radius: number): number {
    return radius * Math.sqrt(Math.min(km, this.visual.horizon_km) / this.visual.horizon_km);
  }

  private drawRings(cx: number, cy: number, radius: number): void {
    const context = this.context;
    context.save();
    context.strokeStyle = 'rgba(255,255,255,0.08)';
    context.font = '11px ui-monospace, monospace';
    context.lineWidth = 1;

    // Ring labels sit on the north-east diagonal. Straight up is where the compass
    // goes, and the two were printing on top of each other.
    const diagonal = Math.SQRT1_2;
    context.fillStyle = 'rgba(255,255,255,0.26)';
    for (const km of this.visual.rings_km) {
      const r = this.pixelsFor(km, radius);
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.stroke();
      context.fillText(`${String(km)} km`, cx + r * diagonal + 5, cy - r * diagonal - 3);
    }

    // The compass. §1.1's whole claim is that this picture is drawn from where the
    // listener is standing, and a bearing is unreadable without it.
    const marks: [string, number, number][] = [
      ['N', 0, -1],
      ['E', 1, 0],
      ['S', 0, 1],
      ['W', -1, 0],
    ];
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const [label, dx, dy] of marks) {
      // North is brighter than the rest: it is the one that orients the other three.
      context.fillStyle = label === 'N' ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
      context.fillText(label, cx + dx * (radius + 14), cy + dy * (radius + 14));
      context.strokeStyle = 'rgba(255,255,255,0.14)';
      context.beginPath();
      context.moveTo(cx + dx * (radius - 5), cy + dy * (radius - 5));
      context.lineTo(cx + dx * (radius + 3), cy + dy * (radius + 3));
      context.stroke();
    }

    // The listener. Everything else is placed relative to this dot.
    context.fillStyle = 'rgba(255,255,255,0.75)';
    context.beginPath();
    context.arc(cx, cy, 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  private drawEvent(
    event: PublicEvent,
    cx: number,
    cy: number,
    radius: number,
    grow: number,
    fade: number,
  ): void {
    // Bearing is degrees clockwise from north; canvas angles run clockwise from east.
    const angle = ((event.rel.bearing_deg - 90) * Math.PI) / 180;
    const r = this.pixelsFor(event.rel.distance_km, radius);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    // Salience is the governor's own priority, so the eye and the ear agree about
    // which events matter (§6.5).
    const size = (3 + event.salience * 7) * grow;

    const context = this.context;
    context.save();
    context.globalAlpha = Math.max(0, fade);
    context.strokeStyle = COLOURS[event.type];
    context.fillStyle = COLOURS[event.type];
    context.lineWidth = 1.5;

    drawGlyph(context, GLYPHS[event.type], x, y, size, event.attrs.track_deg);

    // A ring that opens outwards as the event ages: the visual equivalent of a note
    // decaying, and slow enough to be restful.
    context.globalAlpha = Math.max(0, fade * 0.3);
    context.beginPath();
    context.arc(x, y, size + (1 - fade) * 24, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
}
