/**
 * The ticker. SPEC §1.2, §10.
 *
 * Every sound traces to a real event, and this is where the piece says so. The
 * caption is written by the server and is already privacy-filtered (§3.2) — the page
 * never composes one, because a second place that writes captions is a second place
 * that can leak a callsign.
 *
 * Replayed and simulated events arrive with `sim: true` and carry "(replay)" in their
 * own text, and the page marks them again visually. A listener must never be told a
 * plane just took off when it did not.
 */

import type { PublicEvent, VisualConfig } from '../../../shared/protocol.js';

export class Captions {
  private readonly lines: { el: HTMLElement; at: number }[] = [];

  constructor(
    private readonly host: HTMLElement,
    private visual: VisualConfig,
  ) {}

  configure(visual: VisualConfig): void {
    this.visual = visual;
  }

  add(events: readonly PublicEvent[], serverNow: number): void {
    for (const event of events) {
      const line = document.createElement('li');
      line.className = event.sim ? 'caption caption--sim' : 'caption';
      const time = document.createElement('time');
      time.textContent = new Date(event.t).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const text = document.createElement('span');
      text.textContent = event.caption;
      line.append(time, text);
      this.host.prepend(line);
      this.lines.unshift({ el: line, at: serverNow });
    }
    this.trim(serverNow);
  }

  trim(serverNow: number): void {
    const lifeMs = this.visual.caption_life_s * 1000;
    while (
      this.lines.length > this.visual.caption_lines ||
      (this.lines.length > 0 && serverNow - this.lines[this.lines.length - 1]!.at > lifeMs)
    ) {
      this.lines.pop()?.el.remove();
    }
  }
}
