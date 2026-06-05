import fs from 'node:fs/promises';
import path from 'node:path';
import type { AirportCoverageItem } from '../types/index.ts';

const RESULTS_DIR = process.env['RESULTS_DIR'] ?? './scraping-result';

export interface CoverageRunContext {
  dir: string;
  airline: string;
  log: (msg: string) => void;
  saveError: (err: unknown) => Promise<void>;
}

export async function createCoverageRun(airline: string): Promise<CoverageRunContext> {
  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const dir = path.join(RESULTS_DIR, `${ts}_coverage_${airline}`);
  await fs.mkdir(dir, { recursive: true });

  const lines: string[] = [
    `Run started  : ${new Date().toISOString()}`,
    `Airline      : ${airline}`,
    '',
  ];

  const log = (msg: string) => {
    lines.push(`[${new Date().toISOString()}] ${msg}`);
  };

  const saveError = async (err: unknown) => {
    lines.push('');
    lines.push(`[${new Date().toISOString()}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) lines.push(err.stack);
    await fs.writeFile(path.join(dir, 'execution.log'), lines.join('\n'));
  };

  return { dir, airline, log, saveError };
}

export async function saveCoverageResults(ctx: CoverageRunContext, airports: AirportCoverageItem[]): Promise<void> {
  await fs.writeFile(
    path.join(ctx.dir, 'coverage.json'),
    JSON.stringify(
      {
        airline:       ctx.airline,
        fetchedAt:     new Date().toISOString(),
        totalAirports: airports.length,
        airports,
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(ctx.dir, 'execution.log'),
    [
      `Run started  : ${new Date().toISOString()}`,
      `Airline      : ${ctx.airline}`,
      `Airports     : ${airports.length}`,
    ].join('\n'),
  );
}
