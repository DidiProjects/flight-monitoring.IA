import { firefox } from 'playwright';
import type { Browser, BrowserContext, Cookie, Page } from 'playwright';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BLOCKED_RESOURCES } from '../config/browser.ts';
import { dateRange } from '../utils/dates.ts';
import { logger } from '../utils/logger.ts';
import { humanDelay } from '../browser/human.ts';
import { toTimestamp } from '../utils/airports.ts';
import type { FlightOffer, FlightFares, ScraperParams } from '../types/index.ts';

type LogCtx = { requestId?: string; routineId?: string; airline?: string };

const SEARCH_BASE = 'https://www.ryanair.com/gb/en/trip/flights/select';
const SESSION_FILE = path.join(process.cwd(), '.sessions', 'ryanair-cookies.json');

async function loadSavedCookies(): Promise<Cookie[]> {
  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf-8');
    const cookies: Cookie[] = JSON.parse(raw);
    const nowSec = Date.now() / 1000;
    return cookies.filter(c => !c.expires || c.expires === -1 || c.expires > nowSec);
  } catch { return []; }
}

async function saveSessionCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
    await fs.writeFile(SESSION_FILE, JSON.stringify(cookies, null, 2));
  } catch {}
}

function buildSearchUrl(origin: string, destination: string, date: string, passengers: number): string {
  const p = new URLSearchParams({
    adults: String(passengers),
    teens: '0',
    children: '0',
    infants: '0',
    dateOut: date,
    dateIn: '',
    isConnectedFlight: 'false',
    discount: '0',
    promoCode: '',
    isReturn: 'false',
    originIata: origin,
    destinationIata: destination,
    tpAdults: String(passengers),
    tpTeens: '0',
    tpChildren: '0',
    tpInfants: '0',
    tpStartDate: date,
    tpEndDate: '',
    tpDiscount: '0',
    tpPromoCode: '',
    tpOriginIata: origin,
    tpDestinationIata: destination,
  });
  return `${SEARCH_BASE}?${p.toString()}`;
}

// "3h 20m" → 200
function parseDurationMin(text: string): number {
  const h = text.match(/(\d+)\s*h/)?.[1];
  const m = text.match(/(\d+)\s*m/)?.[1];
  return (h ? parseInt(h) * 60 : 0) + (m ? parseInt(m) : 0);
}

// "€89.99" → 89.99
function parsePrice(text: string): number | null {
  const m = text.replace(',', '.').match(/\d+\.\d+|\d+/);
  if (!m) return null;
  const val = parseFloat(m[0]!);
  return isNaN(val) ? null : val;
}

function parseCurrency(text: string): string {
  if (text.includes('€')) return 'EUR';
  if (text.includes('£')) return 'GBP';
  if (text.includes('$')) return 'USD';
  return 'EUR';
}

// "FR 1316" → "FR1316"
function normalizeFlightNumber(raw: string): string {
  return raw.replace(/\s+/g, '');
}

// ── Main entry ──────────────────────────────────────────────────────────────────

export async function searchFlights(params: ScraperParams): Promise<FlightOffer[]> {
  const foxOptions = await camoufoxLaunchOptions({
    headless: true,
    os: 'windows',
    locale: 'en-GB',
    humanize: true,
  });
  const browser = await firefox.launch(foxOptions);
  const allOffers: FlightOffer[] = [];
  const savedCookies = await loadSavedCookies();

  try {
    const outbound = await searchDateRange(
      browser, params.origin, params.destination,
      params.outboundStart, params.outboundEnd ?? params.outboundStart,
      false, params, savedCookies,
    );
    allOffers.push(...outbound);

    if (params.returnStart) {
      const ret = await searchDateRange(
        browser, params.destination, params.origin,
        params.returnStart, params.returnEnd ?? params.returnStart,
        true, params, savedCookies,
      );
      allOffers.push(...ret);
    }
  } finally {
    await browser.close();
  }

  return allOffers;
}

// ── Date range loop ─────────────────────────────────────────────────────────────

async function searchDateRange(
  browser: Browser,
  origin: string,
  destination: string,
  startDate: string,
  endDate: string,
  isReturn: boolean,
  params: ScraperParams,
  savedCookies: Cookie[] = [],
): Promise<FlightOffer[]> {
  const logCtx: LogCtx = { requestId: params.requestId, routineId: params.routineId, airline: params.airline };
  const context = await browser.newContext({
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'en-GB,en;q=0.9' },
  });

  if (savedCookies.length > 0) {
    await context.addCookies(savedCookies);
    logger.debug({ count: savedCookies.length }, 'Ryanair: session cookies restored');
  }

  const page = await context.newPage();

  await page.route('**/*', route => {
    if (BLOCKED_RESOURCES.has(route.request().resourceType())) return route.abort();
    return route.continue();
  });

  const allOffers: FlightOffer[] = [];

  try {
    for (const date of dateRange(startDate, endDate)) {
      const url = buildSearchUrl(origin, destination, date, params.passengers);
      logger.debug({ origin, destination, date }, 'Navigating to Ryanair search');

      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await humanDelay(3_000, 5_000);
      await dismissCookieBanner(page);

      const hasCards = await waitForCards(page, logCtx);
      await saveSnapshot(page, params.runDir, `ryanair-${origin}-${destination}-${date}`);

      if (!hasCards) {
        // Disambiguate genuine empty-state from a silent bot/IP block.
        const genuineEmpty = await isGenuineEmptyState(page);
        if (!genuineEmpty) {
          const msg = `Ryanair: zero cards and no empty-state marker for ${origin}→${destination} on ${date} — likely bot/IP block.`;
          logger.warn({ ...logCtx, origin, destination, date }, 'Suspected bot/IP block: empty result without empty-state marker');
          throw new Error(msg);
        }
        logger.debug({ date, origin, destination }, 'No Ryanair flights for this date');
        continue;
      }

      const offers = await extractCards(page, origin, destination, date);
      offers.forEach(o => { o.isReturn = isReturn; });

      logger.debug({ date, origin, destination, count: offers.length }, 'Ryanair date collected');

      if (params.runDir) {
        const dateDir = path.join(params.runDir, date);
        await fs.mkdir(dateDir, { recursive: true });
        await fs.writeFile(
          path.join(dateDir, `ryanair-${origin}-${destination}.json`),
          JSON.stringify(offers, null, 2),
        );
      }

      allOffers.push(...offers);
      await humanDelay(1_500, 3_000);
    }
  } catch (err) {
    const errDir = params.runDir ? path.join(params.runDir, 'errors') : process.cwd();
    await fs.mkdir(errDir, { recursive: true }).catch(() => {});
    const base = `ryanair-${origin}-${destination}`;
    await page.screenshot({ path: path.join(errDir, `debug-${base}.png`), fullPage: true }).catch(() => {});
    await page.evaluate(() => document.documentElement.outerHTML)
      .then(html => fs.writeFile(path.join(errDir, `dom-${base}.html`), html))
      .catch(() => {});
    throw err;
  } finally {
    await saveSessionCookies(context);
    await context.close();
  }

  return allOffers;
}

// ── Cookie banner ───────────────────────────────────────────────────────────────

async function dismissCookieBanner(page: Page): Promise<void> {
  // Try Ryanair's known cookie button selectors, then fall back to text matching
  const btn = page.locator('[data-ref="cookie.accept-all"]');
  if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await btn.click();
    logger.debug('Ryanair cookie banner dismissed');
  }
}

// ── Wait for cards ──────────────────────────────────────────────────────────────

async function waitForCards(page: Page, logCtx: LogCtx = {}): Promise<boolean> {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const hasCard = await page.locator('[data-ref="flight-card_all_information"]')
      .count().then(c => c > 0).catch(() => false);
    if (hasCard) return true;

    const noFlights = await page.evaluate(() =>
      document.querySelector('[data-ref="no-flights-container"]') !== null ||
      /no flights|sold out|unavailable/i.test(document.body.innerText),
    ).catch(() => false);
    if (noFlights) return false;

    await page.waitForTimeout(1_000);
  }

  logger.warn({ ...logCtx }, 'Ryanair waitForCards timed out');
  return false;
}

// Distinguishes a legitimate "no flights" page from a silent block: if zero cards
// AND none of the known empty-state markers are present, it's almost certainly a block.
async function isGenuineEmptyState(page: Page): Promise<boolean> {
  return await page.evaluate(() =>
    document.querySelector('[data-ref="no-flights-container"]') !== null ||
    /no flights|sold out|unavailable/i.test(document.body.innerText),
  ).catch(() => false);
}

// ── Card extraction ─────────────────────────────────────────────────────────────

type RawCard = {
  depIata: string;
  depTime: string;
  arrIata: string;
  arrTime: string;
  durationText: string;
  priceText: string;
  flightNum: string;
};

async function extractCards(
  page: Page,
  origin: string,
  destination: string,
  date: string,
): Promise<FlightOffer[]> {
  const rawCards: RawCard[] = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-ref="flight-card_all_information"]'));
    const results: RawCard[] = [];

    for (const card of cards) {
      // Departure: data-ref on city span encodes IATA ("origin-airport__NAP")
      const depSeg = card.querySelector('[data-ref="flight-segment.departure"]');
      const depTime = depSeg?.querySelector('.flight-info__hour')?.textContent?.trim() ?? '';
      const depRef = card.querySelector('[data-ref^="origin-airport__"]')?.getAttribute('data-ref') ?? '';
      const depIata = depRef.split('__')[1] ?? '';

      // Arrival
      const arrSeg = card.querySelector('[data-ref="flight-segment.arrival"]');
      const arrTime = arrSeg?.querySelector('.flight-info__hour')?.textContent?.trim() ?? '';
      const arrRef = card.querySelector('[data-ref^="destination-airport__"]')?.getAttribute('data-ref') ?? '';
      const arrIata = arrRef.split('__')[1] ?? '';

      // Duration
      const durationText = card.querySelector('[data-ref="flight_duration"]')?.textContent?.trim() ?? '';

      // Flight number: data-ref attribute IS the flight number (e.g. "FR 1316")
      const flightNum = card.querySelector('.card-flight-num__content[data-ref]')?.getAttribute('data-ref')?.trim() ?? '';

      // Price: current selling price (discounted if applicable)
      const priceText = card.querySelector('[data-e2e="flight-card-price"]')?.textContent?.trim() ?? '';

      if (!depTime || !arrTime) continue;
      results.push({ depIata, depTime, arrIata, arrTime, durationText, priceText, flightNum });
    }

    return results;
  });

  const offers: FlightOffer[] = [];

  for (const card of rawCards) {
    const price = parsePrice(card.priceText);
    if (price === null || price <= 0) continue;

    const durationMin = parseDurationMin(card.durationText);
    if (durationMin <= 0) {
      logger.warn({ depIata: card.depIata, arrIata: card.arrIata }, 'Could not parse Ryanair duration, skipping flight');
      continue;
    }

    const fares: FlightFares = {
      cash: { amount: price, currency: parseCurrency(card.priceText) },
    };

    offers.push({
      date,
      flightNumber: normalizeFlightNumber(card.flightNum),
      origin: {
        iata: card.depIata || origin,
        timestamp: toTimestamp(date, card.depTime, card.depIata || origin),
      },
      destination: {
        iata: card.arrIata || destination,
        timestamp: toTimestamp(date, card.arrTime, card.arrIata || destination),
      },
      durationMin,
      stops: 0,
      fares,
      isReturn: false,
    });
  }

  return offers;
}

// ── Snapshots ───────────────────────────────────────────────────────────────────

async function saveSnapshot(page: Page, runDir: string | undefined, label: string): Promise<void> {
  if (!runDir) return;
  const snapDir = path.join(runDir, 'snapshots');
  await fs.mkdir(snapDir, { recursive: true }).catch(() => {});
  await Promise.all([
    page.evaluate(() => document.documentElement.outerHTML)
      .then(html => fs.writeFile(path.join(snapDir, `${label}.html`), html))
      .catch(() => {}),
    page.screenshot({ path: path.join(snapDir, `${label}.png`), fullPage: false })
      .catch(() => {}),
  ]);
  logger.debug({ label }, 'Snapshot saved');
}
