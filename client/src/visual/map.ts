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
  // Ring crossings are texture, so they are drawn in the quietest colours on the
  // page: present, countable, never competing with an arrival (§6.5).
  sky_far: '#4a5568',
  sky_mid: '#5d7085',
  sky_near: '#7d93a8',
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
    const centreY = height / 2;
    const radius = Math.min(width, height) / 2 - 28;
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
    context.fillStyle = 'rgba(255,255,255,0.28)';
    context.font = '11px ui-monospace, monospace';
    context.lineWidth = 1;
    for (const km of this.visual.rings_km) {
      const r = this.pixelsFor(km, radius);
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.stroke();
      context.fillText(`${String(km)} km`, cx + 4, cy - r - 4);
    }
    // The listener. Everything else is placed relative to this dot.
    context.fillStyle = 'rgba(255,255,255,0.75)';
    context.beginPath();
    context.arc(cx, cy, 3, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.45)';
    context.fillText('N', cx - 4, cy - radius - 10);
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
    const size = (4 + event.salience * 9) * grow;

    const context = this.context;
    context.save();
    context.globalAlpha = Math.max(0, fade);
    context.strokeStyle = COLOURS[event.type];
    context.fillStyle = COLOURS[event.type];
    context.lineWidth = 1.5;
    context.translate(x, y);

    switch (event.type) {
      case 'ewr_departure':
        this.triangle(size, 'up');
        break;
      case 'ewr_arrival':
        this.triangle(size, 'down');
        break;
      case 'helicopter':
        // Rotor: two crossed strokes, which reads as a helicopter at any size.
        context.beginPath();
        context.moveTo(-size, -size);
        context.lineTo(size, size);
        context.moveTo(size, -size);
        context.lineTo(-size, size);
        context.stroke();
        break;
      case 'sky_far':
      case 'sky_mid':
      case 'sky_near':
        // A filled dot, not an outline: at this size an outline reads as noise.
        context.beginPath();
        context.arc(0, 0, size * 0.45, 0, Math.PI * 2);
        context.fill();
        break;
      default:
        context.beginPath();
        context.arc(0, 0, size * 0.6, 0, Math.PI * 2);
        context.stroke();
    }

    // A ring that opens outwards as the event ages: the visual equivalent of a note
    // decaying, and slow enough to be restful.
    context.globalAlpha = Math.max(0, fade * 0.35);
    context.beginPath();
    context.arc(0, 0, size + (1 - fade) * 26, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  /**
   * A triangle pointing the way the aircraft is going.
   *
   * Canvas y grows downward, so 'up' needs the apex at a negative y. Getting this
   * backwards is invisible in a test and obvious on screen: the first render had
   * every arrival pointing skyward.
   */
  private triangle(size: number, facing: 'up' | 'down'): void {
    const apex = facing === 'up' ? -size : size;
    const base = facing === 'up' ? size * 0.7 : -size * 0.7;
    const context = this.context;
    context.beginPath();
    context.moveTo(0, apex);
    context.lineTo(-size * 0.85, base);
    context.lineTo(size * 0.85, base);
    context.closePath();
    context.fill();
  }
}
