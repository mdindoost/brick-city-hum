/**
 * The recorder. SPEC §3.5, and the piece Phase 0 cannot be completed without:
 * §13 requires at least two full days of recorded aircraft data, which is 48 hours
 * of wall clock that no amount of work compresses.
 *
 * Two things are written, for two different reasons:
 *
 *  - **observations** — the normalized, privacy-filtered readings. These feed the
 *    simulator (§3.5) and the listening lab (§7.3).
 *  - **raw** — every field the API returned *except* identity. §3.2's thresholds are
 *    explicitly starting values to be tuned, and tuning against normalized output
 *    only would mean recording another 48 hours from scratch each time. Identity is
 *    stripped upstream in the collector, because these files are append-only and
 *    long-lived: a tail number written here cannot be unwritten by fixing the code
 *    later (§3.7).
 *
 * Gzipped **line by line**, so the file is a concatenation of independent gzip
 * members. A crash mid-write therefore damages only the final member.
 *
 * Read it with a STREAMING reader (`zlib.createGunzip`), not `gunzipSync`: verified
 * on a deliberately truncated file, `gunzipSync` throws `Z_BUF_ERROR` and returns
 * **nothing**, losing the whole day, while the streaming reader emits every complete
 * line and then errors. `readRecording` below is the supported reader and is what the
 * simulator (§3.5) and the lab (§7.3) must use. An earlier version of this comment
 * claimed "a crash costs one line" without qualification; that is true only for a
 * tolerant streaming consumer.
 *
 * ~91 MB/day measured, and §11.3 caps the rolling window at 30 days (~2.7 GB).
 */

import {
  accessSync,
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  mkdirSync,
  type WriteStream,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createGunzip, gzipSync } from 'node:zlib';
import type { Observation } from './observation.js';

export type RecordKind = 'observation' | 'raw' | 'poll';

export interface RecorderOptions {
  readonly directory: string;
  /** Injectable so tests do not depend on the real date. */
  readonly now?: () => number;
}

/** `YYYY-MM-DD` in UTC. UTC deliberately: a local-time boundary would duplicate or
 * skip an hour twice a year, and these files are keyed by day. Captions and dayparts
 * use Newark local time (§6.2); file names do not. */
export function dayStamp(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export class Recorder {
  private readonly streams = new Map<string, WriteStream>();
  private readonly now: () => number;
  private written = 0;
  private failures = 0;
  private lastError: string | null = null;

  constructor(private readonly options: RecorderOptions) {
    this.now = options.now ?? Date.now;
    mkdirSync(options.directory, { recursive: true });
    // Fail at boot, not per-write. Recording IS the Phase 0 deliverable (§13 needs
    // 48 unbroken hours), so a server that cannot write is not worth starting — and
    // discovering it one failed write at a time buries the cause in log noise.
    // This failed for real on the first containerised run: the image's `node` user
    // is uid 1000 and the host user is 1001, so the bind mount was unwritable.
    try {
      accessSync(options.directory, fsConstants.W_OK);
    } catch (cause) {
      throw new Error(
        `Recordings directory ${options.directory} is not writable. ` +
          `In Docker this usually means the container's user id does not match the ` +
          `owner of the bind-mounted directory — set HOST_UID and HOST_GID in .env ` +
          `(see .env.example).`,
        { cause },
      );
    }
  }

  private streamFor(kind: RecordKind, epochMs: number): WriteStream | undefined {
    const day = dayStamp(epochMs);
    const name = `${day}-${kind}.ndjson.gz`;
    const existing = this.streams.get(name);
    if (existing !== undefined) return existing;

    // Close any stream of this kind from a previous day. Without this we leak two
    // file descriptors per UTC day, which is harmless over 48 hours and not harmless
    // for something §13 Phase 4 expects to run for months.
    for (const [openName, openStream] of this.streams) {
      if (openName.endsWith(`-${kind}.ndjson.gz`) && openName !== name) {
        openStream.end();
        this.streams.delete(openName);
      }
    }

    // `flags: 'a'` matters: on restart we continue the day's file rather than
    // truncating it, so a reboot costs no recorded history (SPEC §11.3).
    const stream = createWriteStream(join(this.options.directory, name), { flags: 'a' });
    // Without an 'error' listener, ENOSPC or EACCES emits an uncaught exception.
    // The disk budget here is ~2.7 GB, so a full disk is a realistic failure, and the
    // dangerous version is the silent one: health would keep reporting `ok` while
    // nothing was being written.
    stream.on('error', (error: Error) => {
      console.error(`[recorder] write failed for ${name}: ${error.message}`);
      this.failures += 1;
      this.lastError = error.message;
      this.streams.delete(name);
    });
    this.streams.set(name, stream);
    return stream;
  }

  private write(kind: RecordKind, epochMs: number, payload: unknown): void {
    const stream = this.streamFor(kind, epochMs);
    if (stream === undefined) return;
    stream.write(gzipSync(`${JSON.stringify(payload)}\n`));
    this.written += 1;
  }

  recordObservations(observations: readonly Observation[], receivedAt: number): void {
    if (observations.length === 0) return;
    this.write('observation', receivedAt, { t: receivedAt, observations });
  }

  recordRaw(
    source: string,
    aircraft: readonly Record<string, unknown>[],
    receivedAt: number,
    sourceNow: number | null = null,
  ): void {
    if (aircraft.length === 0) return;
    // `sourceNow` is the feed's own clock. Kept so that during tuning we can tell
    // our latency from the feed's, rather than attributing both to one number.
    this.write('raw', receivedAt, { t: receivedAt, source, sourceNow, aircraft });
  }

  /**
   * One line per poll, including empty ones.
   *
   * Cheap (a few bytes) and it buys a distinction the other two files cannot make:
   * an empty sky at 4 a.m. and a collector that was not running both produce no
   * observation lines. The simulator (§3.5) needs to know which it is, and so does
   * the P0-8 validation when it asks why a window has no events.
   */
  recordPoll(
    source: string,
    receivedAt: number,
    observations: number,
    skipped: number,
    total: number,
  ): void {
    this.write('poll', receivedAt, { t: receivedAt, source, observations, skipped, total });
  }

  /** Write health, for /healthz — a recorder that has stopped writing must be visible. */
  stats(): { written: number; failures: number; lastError: string | null } {
    return { written: this.written, failures: this.failures, lastError: this.lastError };
  }

  /** Flush and close every open file. Called on shutdown. */
  async close(): Promise<void> {
    const closing = [...this.streams.values()].map(
      (stream) =>
        new Promise<void>((resolve, reject) => {
          stream.end((error?: Error | null) => {
            if (error) reject(error);
            else resolve();
          });
        }),
    );
    this.streams.clear();
    await Promise.all(closing);
  }

  /** Current day stamp, for logging and the admin page. */
  today(): string {
    return dayStamp(this.now());
  }
}

/**
 * Read a recording back, tolerating a truncated final member.
 *
 * The supported reader for everything downstream — the simulator (§3.5), the lab
 * (§7.3), and P0-8's validation. `gunzipSync` must not be used: on a file whose last
 * gzip member was cut short by a crash it throws and yields nothing, turning a
 * one-line loss into a whole-day loss.
 */
export async function readRecording(path: string): Promise<unknown[]> {
  const records: unknown[] = [];
  const gunzip = createGunzip();
  const input = createReadStream(path).pipe(gunzip);

  // A truncated tail is the expected shape of a crash, not an exception: every
  // complete member before it is still valid data. Listeners prevent an unhandled
  // 'error' event; the try/catch catches the rejection the async iterator raises.
  gunzip.on('error', () => undefined);
  input.on('error', () => undefined);

  const lines = createInterface({ input });
  try {
    for await (const line of lines) {
      if (line.length === 0) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // A half-written final line. Everything before it stands.
      }
    }
  } catch {
    // The stream ended mid-member. `records` holds everything that was intact.
  } finally {
    lines.close();
  }
  return records;
}
