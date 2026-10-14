/**
 * Brick City Hum — server entry point.
 *
 * SPEC §5: collectors → normalizer → event bus → governor → WebSocket fan-out.
 * Phase 0 scaffold: nothing is wired up yet beyond proving the process starts and
 * the config loads. See docs/plan-phase0.md.
 */

const PORT = Number(process.env['PORT'] ?? 8080);

function contactAddress(): string {
  const contact = process.env['CONTACT_EMAIL'];
  if (contact === undefined || contact.length === 0) {
    // SPEC §9.1 requires an honest User-Agent with a contact address. We start
    // anyway rather than block development, but say so loudly: every request we
    // make until this is set is one a maintainer cannot trace back to us.
    console.warn(
      '[config] CONTACT_EMAIL is not set. Outbound requests will identify as "unconfigured".\n' +
        '         Set it in .env — see .env.example and SPEC §9.1.',
    );
    return 'unconfigured';
  }
  return contact;
}

export function userAgent(): string {
  return `brick-city-hum/0.1 (+https://github.com/mdindoost/brick-city-hum; contact: ${contactAddress()})`;
}

function main(): void {
  console.log(`[boot] brick-city-hum server starting on port ${String(PORT)}`);
  console.log(`[boot] User-Agent: ${userAgent()}`);
}

main();
