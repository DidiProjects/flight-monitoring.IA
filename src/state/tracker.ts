import fs from 'node:fs/promises';
import path from 'node:path';
import type { FlightOffer, Targets } from '../types/index.ts';
import { computeWithinTarget } from '../types/index.ts';

const RESULTS_DIR = process.env['RESULTS_DIR'] ?? './results';
const STATE_FILE  = path.join(RESULTS_DIR, 'state.json');

export interface BestEntry {
  amount: number;
  offer: FlightOffer;
}

export interface DirectionBest {
  brl?: BestEntry;
  pts?: BestEntry;
  hyb?: BestEntry;
}

interface DailyState {
  runCount: number;
  best: {
    outbound: DirectionBest;
    return: DirectionBest;
  };
  // Tracks the amounts that were last emailed per direction.
  // Re-send triggered whenever a direction gets a strictly lower amount.
  lastEmailed?: {
    outbound?: number;
    return?: number;
    type?: 'brl' | 'pts' | 'hyb';
  };
  bestOfDayEmailSentAt?: string;
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
    state.days[date] = { runCount: 0, best: { outbound: {}, return: {} } };
  }
  const day = state.days[date]!;
  if (!day.best.outbound) (day.best as any).outbound = {};
  if (!day.best.return)   (day.best as any).return   = {};
  return day;
}

export function incrementRun(state: AppState, date: string): number {
  const day = getDay(state, date);
  day.runCount += 1;
  return day.runCount;
}

export function updateBestOffers(state: AppState, date: string, offers: FlightOffer[], targets: Targets): void {
  const day = getDay(state, date);

  for (const offer of offers) {
    const dir = offer.isReturn ? day.best.return : day.best.outbound;

    if (targets.brl != null && offer.fares.brl) {
      const v = offer.fares.brl.amount;
      if (!dir.brl || v < dir.brl.amount) dir.brl = { amount: v, offer };
    }
    if (targets.pts != null && offer.fares.points) {
      const v = offer.fares.points.amount;
      if (!dir.pts || v < dir.pts.amount) dir.pts = { amount: v, offer };
    }
    if ((targets.hybPts != null || targets.hybBrl != null) && offer.fares.hybrid) {
      const v = offer.fares.hybrid.points;
      if (!dir.hyb || v < dir.hyb.amount) dir.hyb = { amount: v, offer };
    }
  }
}

// Returns true if outbound or return amount is strictly lower than what was last emailed.
// Also returns true if nothing has been emailed yet (first hit).
export function hasOfferImproved(
  state: AppState,
  date: string,
  outboundAmount: number | undefined,
  returnAmount: number | undefined,
): boolean {
  const emailed = state.days[date]?.lastEmailed;

  // No emails today yet — fall back to yesterday to avoid re-sending unchanged prices on day rollover
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  const yesterday = prev.toISOString().slice(0, 10);
  const reference = emailed ?? state.days[yesterday]?.lastEmailed;

  if (!reference) return true;

  if (outboundAmount != null && (reference.outbound == null || outboundAmount < reference.outbound)) return true;
  if (returnAmount   != null && (reference.return   == null || returnAmount   < reference.return))   return true;
  return false;
}

export function markEmailed(
  state: AppState,
  date: string,
  outboundAmount: number | undefined,
  returnAmount: number | undefined,
  type: 'brl' | 'pts' | 'hyb',
): void {
  const day = getDay(state, date);
  day.lastEmailed = {
    outbound: outboundAmount ?? day.lastEmailed?.outbound,
    return:   returnAmount   ?? day.lastEmailed?.return,
    type,
  };
}

export function bestOfDayAlreadySent(state: AppState, date: string): boolean {
  return !!state.days[date]?.bestOfDayEmailSentAt;
}

export function markBestOfDaySent(state: AppState, date: string): void {
  getDay(state, date).bestOfDayEmailSentAt = new Date().toISOString();
}

export function getOffersWithinTarget(
  offers: FlightOffer[],
  targets: Targets,
  margin: number,
): FlightOffer[] {
  return offers.filter(o => computeWithinTarget(o, targets, margin));
}

export function pickBestOffer(
  state: AppState,
  date: string,
): { outbound: BestEntry | null; ret: BestEntry | null; type: 'brl' | 'pts' | 'hyb' } | null {
  const day = state.days[date];
  if (!day) return null;
  const ob = day.best.outbound;
  const rt = day.best.return;
  if (ob.brl || rt.brl) return { outbound: ob.brl ?? null, ret: rt.brl ?? null, type: 'brl' };
  if (ob.pts || rt.pts) return { outbound: ob.pts ?? null, ret: rt.pts ?? null, type: 'pts' };
  if (ob.hyb || rt.hyb) return { outbound: ob.hyb ?? null, ret: rt.hyb ?? null, type: 'hyb' };
  return null;
}
