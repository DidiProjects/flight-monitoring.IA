import fs from 'node:fs/promises';
import path from 'node:path';
import type { FlightOffer, SearchParams } from '../types/index.ts';

const RESULTS_DIR = process.env['RESULTS_DIR'] ?? './results';
const MAX_RUNS = 10;

// ── Public API ────────────────────────────────────────────────────────────────

export interface RunContext {
  dir: string;
  log: (msg: string) => void;
  /** Flush log lines to errors/execution.log and move any .png files there. */
  saveError: (err: unknown) => Promise<void>;
}

export async function createRun(params: SearchParams): Promise<RunContext> {
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const dir = path.join(RESULTS_DIR, ts);
  await fs.mkdir(dir, { recursive: true });

  const lines: string[] = [
    `Run started : ${new Date().toISOString()}`,
    `Origin      : ${params.origin}`,
    `Destination : ${params.destination}`,
    `Target      : ${params.target} (margin ${(params.margin * 100).toFixed(0)}%)`,
    `Outbound    : ${params.outboundStart}${params.outboundEnd ? ` → ${params.outboundEnd}` : ''}`,
    params.returnStart
      ? `Return      : ${params.returnStart}${params.returnEnd ? ` → ${params.returnEnd}` : ''}`
      : 'Return      : (one-way)',
    `Passengers  : ${params.passengers}`,
    '',
  ];

  const log = (msg: string) => {
    lines.push(`[${new Date().toISOString()}] ${msg}`);
  };

  const saveError = async (err: unknown) => {
    const errDir = path.join(dir, 'errors');
    await fs.mkdir(errDir, { recursive: true });

    lines.push('');
    lines.push(`[${new Date().toISOString()}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      lines.push(err.stack);
    }

    // Move any debug screenshots already in the run dir into errors/
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of entries) {
      if (f.endsWith('.png')) {
        await fs.rename(path.join(dir, f), path.join(errDir, f)).catch(() => {});
      }
    }

    await fs.writeFile(path.join(errDir, 'execution.log'), lines.join('\n'));
  };

  return { dir, log, saveError };
}

export async function saveResults(ctx: RunContext, params: SearchParams, results: FlightOffer[]): Promise<void> {
  const payload = {
    runAt:        new Date().toISOString(),
    params:       { ...params, runDir: undefined },
    totalFound:   results.length,
    withinTarget: results.filter(r => r.withinTarget).length,
    results,
  };
  await fs.writeFile(
    path.join(ctx.dir, 'results.json'),
    JSON.stringify(payload, null, 2),
  );
  ctx.log(`Saved ${results.length} result(s) → results.json`);
}

export async function pruneOldRuns(): Promise<void> {
  const entries = await fs.readdir(RESULTS_DIR).catch(() => [] as string[]);
  // ISO-timestamp dirs sort chronologically
  const sorted = entries.filter(e => /^\d{4}-\d{2}-\d{2}T/.test(e)).sort();
  for (const old of sorted.slice(0, Math.max(0, sorted.length - MAX_RUNS))) {
    await fs.rm(path.join(RESULTS_DIR, old), { recursive: true, force: true });
  }
}
