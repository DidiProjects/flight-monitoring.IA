import fs from 'node:fs/promises';
import path from 'node:path';
import type { FlightOffer, Targets } from '../types/index.ts';
import { computeWithinTarget } from '../types/index.ts';

const RESULTS_DIR = process.env['RESULTS_DIR'] ?? './results';
const STATE_FILE  = path.join(RESULTS_DIR, 'state.json');

interface BestEntry {
  amount: number;
  offer: FlightOffer;
}

interface DailyState {
  emailSentAt?: string;
  runCount: number;
  best: {
    brl?: BestEntry;
    pts?: BestEntry;
    hyb?: BestEntry;
  };
}

interface AppState {
  days: Record<string, DailyState>;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadState(): Promise<AppState> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as AppState;
  } catch {
    return { days: {} };
  }
}

export async function saveState(state: AppState): Promise<void> {
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function getDay(state: AppState, date: string): DailyState {
  if (!state.days[date]) {
    state.days[date] = { runCount: 0, best: {} };
  }
  return state.days[date]!;
}

export function incrementRun(state: AppState, date: string): number {
  const day = getDay(state, date);
  day.runCount += 1;
  return day.runCount;
}

export function updateBestOffers(state: AppState, date: string, offers: FlightOffer[], targets: Targets): void {
  const day = getDay(state, date);

  for (const offer of offers) {
    if (targets.brl != null && offer.fares.brl) {
      const v = offer.fares.brl.amount;
      if (!day.best.brl || v < day.best.brl.amount) {
        day.best.brl = { amount: v, offer };
      }
    }
    if (targets.pts != null && offer.fares.points) {
      const v = offer.fares.points.amount;
      if (!day.best.pts || v < day.best.pts.amount) {
        day.best.pts = { amount: v, offer };
      }
    }
    if ((targets.hybPts != null || targets.hybBrl != null) && offer.fares.hybrid) {
      const v = offer.fares.hybrid.points;
      if (!day.best.hyb || v < day.best.hyb.amount) {
        day.best.hyb = { amount: v, offer };
      }
    }
  }
}

export function emailAlreadySentToday(state: AppState, date: string): boolean {
  return !!state.days[date]?.emailSentAt;
}

export function markEmailSent(state: AppState, date: string): void {
  const day = getDay(state, date);
  day.emailSentAt = new Date().toISOString();
}

export function getOffersWithinTarget(
  offers: FlightOffer[],
  targets: Targets,
  margin: number,
): FlightOffer[] {
  return offers.filter(o => computeWithinTarget(o, targets, margin));
}

// Returns the single best offer to send in the 20th-run fallback email.
// Priority: BRL → PTS → HYB
export function pickBestOffer(state: AppState, date: string): { entry: BestEntry; type: 'brl' | 'pts' | 'hyb' } | null {
  const day = state.days[date];
  if (!day) return null;
  if (day.best.brl) return { entry: day.best.brl, type: 'brl' };
  if (day.best.pts) return { entry: day.best.pts, type: 'pts' };
  if (day.best.hyb) return { entry: day.best.hyb, type: 'hyb' };
  return null;
}
