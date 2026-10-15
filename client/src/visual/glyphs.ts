/**
 * The shapes on the map. SPEC §10.
 *
 * Each one is drawn at the origin, pointing north, so the caller can translate and
 * rotate it. They are deliberately small and flat — a silhouette reads at 8 px where
 * a detailed icon becomes a smudge, and this page is looked at sideways while
 * something else has the viewer's attention.
 *
 * **An aircraft is rotated to its ground track, which is real data** (`track_deg`,
 * carried from ADS-B). It is *not* the bearing from the listener: an aircraft due
 * north of campus heading west must be drawn heading west. Without the track we draw
 * a dot, because a silhouette pointing nowhere in particular would be an invention,
 * and §1.3 does not allow one.
 */

export type GlyphKind = 'plane' | 'helicopter' | 'train' | 'ship' | 'dot';

/** A swept airliner silhouette, nose up, roughly 2.6 × 2.4 units. */
function plane(context: CanvasRenderingContext2D, size: number): void {
  const s = size;
  context.beginPath();
  // Nose, down the right side of the fuselage to the tailplane, and back.
  context.moveTo(0, -s * 1.3);
  context.lineTo(s * 0.16, -s * 0.5);
  context.lineTo(s * 1.15, s * 0.15); // starboard wing
  context.lineTo(s * 1.15, s * 0.42);
  context.lineTo(s * 0.16, s * 0.15);
  context.lineTo(s * 0.16, s * 0.75);
  context.lineTo(s * 0.5, s * 1.05); // starboard tailplane
  context.lineTo(s * 0.5, s * 1.25);
  context.lineTo(0, s * 1.05);
  context.lineTo(-s * 0.5, s * 1.25);
  context.lineTo(-s * 0.5, s * 1.05);
  context.lineTo(-s * 0.16, s * 0.75);
  context.lineTo(-s * 0.16, s * 0.15);
  context.lineTo(-s * 1.15, s * 0.42);
  context.lineTo(-s * 1.15, s * 0.15);
  context.lineTo(-s * 0.16, -s * 0.5);
  context.closePath();
  context.fill();
}

/** Rotor disc and tail boom. Reads as a helicopter even at a few pixels. */
function helicopter(context: CanvasRenderingContext2D, size: number): void {
  const s = size;
  context.beginPath();
  context.arc(0, -s * 0.2, s * 0.42, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = Math.max(1, s * 0.16);
  context.beginPath();
  // The rotor, as two crossed strokes rather than a disc: a filled disc at this size
  // is indistinguishable from the overflight circle.
  context.moveTo(-s * 1.15, -s * 0.2);
  context.lineTo(s * 1.15, -s * 0.2);
  context.moveTo(0, -s * 1.25);
  context.lineTo(0, s * 0.85);
  context.stroke();
  context.beginPath();
  context.moveTo(-s * 0.45, s * 1.0);
  context.lineTo(s * 0.45, s * 1.0);
  context.stroke();
}

/** A carriage seen from above: a rounded box on the ground, not something flying. */
function train(context: CanvasRenderingContext2D, size: number): void {
  const s = size;
  const w = s * 0.62;
  const h = s * 1.2;
  const r = s * 0.22;
  context.beginPath();
  context.moveTo(-w + r, -h);
  context.lineTo(w - r, -h);
  context.quadraticCurveTo(w, -h, w, -h + r);
  context.lineTo(w, h - r);
  context.quadraticCurveTo(w, h, w - r, h);
  context.lineTo(-w + r, h);
  context.quadraticCurveTo(-w, h, -w, h - r);
  context.lineTo(-w, -h + r);
  context.quadraticCurveTo(-w, -h, -w + r, -h);
  context.closePath();
  context.fill();
  // The gap between two coupled cars, so it is not read as a plain rectangle.
  context.clearRect(-w, -s * 0.08, w * 2, s * 0.16);
}

/** A hull seen from above, bow north. Ready for AIS (§3.1 M1, Phase 3). */
function ship(context: CanvasRenderingContext2D, size: number): void {
  const s = size;
  context.beginPath();
  context.moveTo(0, -s * 1.35);
  context.quadraticCurveTo(s * 0.62, -s * 0.5, s * 0.55, s * 0.9);
  context.lineTo(-s * 0.55, s * 0.9);
  context.quadraticCurveTo(-s * 0.62, -s * 0.5, 0, -s * 1.35);
  context.closePath();
  context.fill();
}

function dot(context: CanvasRenderingContext2D, size: number): void {
  context.beginPath();
  context.arc(0, 0, size * 0.5, 0, Math.PI * 2);
  context.fill();
}

/**
 * Draw one glyph at (x, y).
 *
 * `headingDeg` is degrees clockwise from north, or null when unknown — in which case
 * anything with a nose is drawn as a dot instead of pointing somewhere invented.
 */
export function drawGlyph(
  context: CanvasRenderingContext2D,
  kind: GlyphKind,
  x: number,
  y: number,
  size: number,
  headingDeg: number | null,
): void {
  const needsHeading = kind === 'plane' || kind === 'ship';
  const effective: GlyphKind = needsHeading && headingDeg === null ? 'dot' : kind;

  context.save();
  context.translate(x, y);
  if (headingDeg !== null) context.rotate((headingDeg * Math.PI) / 180);
  switch (effective) {
    case 'plane':
      plane(context, size);
      break;
    case 'helicopter':
      helicopter(context, size);
      break;
    case 'train':
      train(context, size);
      break;
    case 'ship':
      ship(context, size);
      break;
    default:
      dot(context, size);
  }
  context.restore();
}
