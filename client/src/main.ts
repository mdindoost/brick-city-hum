/**
 * Brick City Hum — client entry point.
 *
 * SPEC §2.1: audio must never start before the listener's ▶ gesture, and §2.3
 * requires `navigator.audioSession.type = "playback"` to be set inside that
 * handler on iOS. Phase 0 has no audio at all; this only proves the bundle builds.
 */

function main(): void {
  const status = document.querySelector<HTMLElement>('.status');
  if (status !== null) {
    status.textContent = 'Phase 0 — scaffold only, no audio yet.';
  }
}

main();
