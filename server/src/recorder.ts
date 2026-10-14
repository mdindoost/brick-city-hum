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
 * Gzipped line-by-line rather than as one stream per file, so a crash or a `docker
 * kill` loses at most the last line instead of corrupting the day. At ~450 MB/day raw
 * this costs real disk, and §11.3 caps the rolling window at 30 days.
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Observation } from './observation.js';

export type RecordKind = 'observation' | 'raw';

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

  constructor(private readonly options: RecorderOptions) {
    this.now = options.now ?? Date.now;
    mkdirSync(options.directory, { recursive: true });
  }

  private streamFor(kind: RecordKind, epochMs: number): WriteStream {
    const name = `${dayStamp(epochMs)}-${kind}.ndjson.gz`;
    const existing = this.streams.get(name);
    if (existing !== undefined) return existing;
    // `flags: 'a'` matters: on restart we continue the day's file rather than
    // truncating it, so a reboot costs no recorded history (SPEC §11.3).
    const stream = createWriteStream(join(this.options.directory, name), { flags: 'a' });
    this.streams.set(name, stream);
    return stream;
  }

  private write(kind: RecordKind, epochMs: number, payload: unknown): void {
    // Each line is independently gzipped, so the file is a concatenation of gzip
    // members. `zcat` and Node's gunzip both read that correctly, and a truncated
    // final line costs one record rather than the whole day.
    this.streamFor(kind, epochMs).write(gzipSync(`${JSON.stringify(payload)}\n`));
  }

  recordObservations(observations: readonly Observation[], receivedAt: number): void {
    if (observations.length === 0) return;
    this.write('observation', receivedAt, { t: receivedAt, observations });
  }

  recordRaw(
    source: string,
    aircraft: readonly Record<string, unknown>[],
    receivedAt: number,
  ): void {
    if (aircraft.length === 0) return;
    this.write('raw', receivedAt, { t: receivedAt, source, aircraft });
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
