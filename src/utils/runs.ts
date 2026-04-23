import fs from 'node:fs/promises';
import path from 'node:path';
import type { FlightOffer } from '../types/index.ts';

const RESULTS_DIR = process.env['LOGS_DIR'] ?? './logs';
const MAX_RUNS = 10;

export interface RunContext {
  dir: string;
  log: (msg: string) => void;
  saveError: (err: unknown) => Promise<void>;
}

export async function createRun(origin: string, destination: string): Promise<RunContext> {
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const dir = path.join(RESULTS_DIR, ts);
  await fs.mkdir(dir, { recursive: true });

  const lines: string[] = [
    `Run started : ${new Date().toISOString()}`,
    `Route       : ${origin} → ${destination}`,
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
    if (err instanceof Error && err.stack) lines.push(err.stack);

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

export async function saveResults(ctx: RunContext, results: FlightOffer[]): Promise<void> {
  await fs.writeFile(
    path.join(ctx.dir, 'results.json'),
    JSON.stringify({ runAt: new Date().toISOString(), totalFound: results.length, results }, null, 2),
  );
  ctx.log(`Saved ${results.length} result(s) → results.json`);
}

export async function pruneOldRuns(): Promise<void> {
  const entries = await fs.readdir(RESULTS_DIR).catch(() => [] as string[]);
  const sorted = entries.filter(e => /^\d{4}-\d{2}-\d{2}T/.test(e)).sort();
  for (const old of sorted.slice(0, Math.max(0, sorted.length - MAX_RUNS))) {
    await fs.rm(path.join(RESULTS_DIR, old), { recursive: true, force: true });
  }
}
