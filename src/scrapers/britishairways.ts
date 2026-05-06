import { firefox } from 'playwright';
import type { Browser, Page } from 'playwright';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BLOCKED_RESOURCES } from '../config/browser.ts';
import { dateRange } from '../utils/dates.ts';
import { logger } from '../utils/logger.ts';
import { humanDelay } from '../browser/human.ts';
import { toTimestamp } from '../utils/airports.ts';
import type { FlightOffer, FlightFares, ScraperParams } from '../types/index.ts';

const SEARCH_BASE = 'https://www.britishairways.com/nx/b/airselect/en/gbr/book/search/';

function buildSearchUrl(
  origin: string,
  destination: string,
  date: string,
  passengers: number,
): string {
  const p = new URLSearchParams({
    trip: 'oneWay',
    departureDate: date,
    from: origin,
    to: destination,
    travelClass: 'economy',
    adults: String(passengers),
    youngAdults: '0',
    children: '0',
    infants: '0',
    bound: 'outbound',
  });
  return `${SEARCH_BASE}?${p.toString()}`;
}

// "11 hours 45 minutes" → 705
function parseDurationMin(text: string): number {
  const h = text.match(/(\d+)\s*hour/)?.[1];
  const m = text.match(/(\d+)\s*minute/)?.[1];
  return (h ? parseInt(h) * 60 : 0) + (m ? parseInt(m) : 0);
}

// "£642" or "£2,774" → 642 or 2774
function parseGBP(text: string): number | null {
  const m = text.match(/£([\d,]+)/);
  if (!m) return null;
  const val = parseFloat(m[1]!.replace(/,/g, ''));
  return isNaN(val) ? null : val;
}

// "British Airways • BA 247 • AIRBUS A350-1000" → "BA247"
function parseFlightNumber(text: string): string {
  const m = text.match(/•\s*([A-Z]{2}\s*\d+)\s*•/);
  if (!m) return '';
  return m[1]!.replace(/\s+/g, '');
}

// "Direct" → 0, "1 stop" → 1, "1 connection" → 1
function parseStops(text: string): number {
  if (/direct/i.test(text)) return 0;
  const m = text.match(/(\d+)\s*(stop|connection)/i);
  return m ? parseInt(m[1]!) : 0;
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

  try {
    const outbound = await searchDateRange(
      browser, params.origin, params.destination,
      params.outboundStart, params.outboundEnd ?? params.outboundStart,
      false, params,
    );
    allOffers.push(...outbound);

    if (params.returnStart) {
      const ret = await searchDateRange(
        browser, params.destination, params.origin,
        params.returnStart, params.returnEnd ?? params.returnStart,
        true, params,
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
): Promise<FlightOffer[]> {
  const context = await browser.newContext({
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'en-GB,en;q=0.9' },
  });
  const page = await context.newPage();

  await page.route('**/*', route => {
    if (BLOCKED_RESOURCES.has(route.request().resourceType())) return route.abort();
    return route.continue();
  });

  const allOffers: FlightOffer[] = [];

  try {
    for (const date of dateRange(startDate, endDate)) {
      const url = buildSearchUrl(origin, destination, date, params.passengers);
      logger.info({ origin, destination, date }, 'Navigating to BA search');

      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await humanDelay(1_500, 2_500);
      await dismissCookieBanner(page);

      const hasCards = await waitForCards(page);
      await saveSnapshot(page, params.runDir, `ba-${origin}-${destination}-${date}`);

      if (!hasCards) {
        logger.info({ date, origin, destination }, 'No BA flights for this date');
        continue;
      }

      const offers = await extractCards(page, origin, destination, date, params.runDir);
      offers.forEach(o => { o.isReturn = isReturn; });

      logger.info({ date, origin, destination, count: offers.length }, 'BA date collected');

      if (params.runDir) {
        const dateDir = path.join(params.runDir, date);
        await fs.mkdir(dateDir, { recursive: true });
        await fs.writeFile(
          path.join(dateDir, `ba-${origin}-${destination}.json`),
          JSON.stringify(offers, null, 2),
        );
      }

      allOffers.push(...offers);
    }
  } catch (err) {
    const errDir = params.runDir ? path.join(params.runDir, 'errors') : process.cwd();
    await fs.mkdir(errDir, { recursive: true }).catch(() => {});
    const base = `ba-${origin}-${destination}`;
    await page.screenshot({ path: path.join(errDir, `debug-${base}.png`), fullPage: true }).catch(() => {});
    await page.evaluate(() => document.documentElement.outerHTML)
      .then(html => fs.writeFile(path.join(errDir, `dom-${base}.html`), html))
      .catch(() => {});
    throw err;
  } finally {
    await context.close();
  }

  return allOffers;
}

// ── Cookie banner ───────────────────────────────────────────────────────────────

async function dismissCookieBanner(page: Page): Promise<void> {
  const btn = page.locator('#onetrust-accept-btn-handler');
  const visible = await btn.isVisible().catch(() => false);
  if (!visible) return;
  await btn.click();
  await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  logger.debug('BA cookie banner dismissed');
}

// ── Wait for cards ──────────────────────────────────────────────────────────────

async function waitForCards(page: Page): Promise<boolean> {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const hasCard = await page.locator('[data-ds-cr-name="Card"]')
      .count().then(c => c > 0).catch(() => false);
    if (hasCard) return true;

    const noFlights = await page.evaluate(() =>
      /no flights|no results|unavailable|0 flights/i.test(document.body.innerText),
    ).catch(() => false);
    if (noFlights) return false;

    await page.waitForTimeout(1_000);
  }

  logger.warn('BA waitForCards timed out');
  return false;
}

// ── Card extraction ─────────────────────────────────────────────────────────────

type RawCard = {
  depIata: string;
  depTime: string;
  arrIata: string;
  arrTime: string;
  durationText: string;
  stopsText: string;
  priceText: string;
  agreementText: string;
};

async function extractCards(
  page: Page,
  origin: string,
  destination: string,
  date: string,
  runDir?: string,
): Promise<FlightOffer[]> {
  const rawCards: RawCard[] = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-ds-cr-name="Card"]'));

    const results: RawCard[] = [];
    for (const card of cards) {
      const header = card.querySelector('[data-testid^="offerFlightHeader-"]');
      if (!header) continue;

      const depIata = header.querySelector('[data-testid$="--departure-airport-code--text-custom"]')?.textContent?.trim() ?? '';
      // Note: "deperture" is a typo in BA's DOM (confirmed from site HTML)
      const depTime = header.querySelector('[data-testid$="--deperture-time--text-custom"]')?.textContent?.trim() ?? '';
      const arrIata = header.querySelector('[data-testid$="--arrival-airport-code--text-custom"]')?.textContent?.trim() ?? '';
      const arrTime = header.querySelector('[data-testid$="--arrival-time--text-custom"]')?.textContent?.trim() ?? '';
      const durationText = header.querySelector('[data-testid$="--flight-duration--text-custom"]')?.textContent?.trim() ?? '';
      const stopsText = header.querySelector('[data-testid$="--flight-stops--text-custom"]')?.textContent?.trim() ?? '';

      // Economy price: .ds-cr-text-xl is the price amount inside the economy button
      const economyBtn = card.querySelector('[data-testid="travel-class-option-economy"]');
      const priceText = economyBtn?.querySelector('.ds-cr-text-xl')?.textContent?.trim() ?? '';

      // Flight number: accordion content is in the DOM even when collapsed
      const agreementText = card.querySelector('[data-testid="agreement-type"]')?.textContent?.trim() ?? '';

      if (!depTime || !arrTime) continue;
      results.push({ depIata, depTime, arrIata, arrTime, durationText, stopsText, priceText, agreementText });
    }

    return results;
  });

  const offers: FlightOffer[] = [];

  for (const card of rawCards) {
    const priceGBP = parseGBP(card.priceText);
    if (priceGBP === null || priceGBP <= 0) continue;

    const fares: FlightFares = {
      brl: { amount: priceGBP, currency: 'GBP' },
    };

    offers.push({
      date,
      flightNumber: parseFlightNumber(card.agreementText),
      origin: {
        iata: card.depIata || origin,
        timestamp: toTimestamp(date, card.depTime, card.depIata || origin),
      },
      destination: {
        iata: card.arrIata || destination,
        timestamp: toTimestamp(date, card.arrTime, card.arrIata || destination),
      },
      durationMin: parseDurationMin(card.durationText),
      stops: parseStops(card.stopsText),
      fares,
      isReturn: false,
    });
  }

  if (runDir) {
    const snapDir = path.join(runDir, 'snapshots');
    await fs.mkdir(snapDir, { recursive: true }).catch(() => {});
    const html = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
    await fs.writeFile(path.join(snapDir, `ba-${origin}-${destination}-${date}-extracted.html`), html).catch(() => {});
  }

  return offers;
}

// ── Snapshots ───────────────────────────────────────────────────────────────────

async function saveSnapshot(page: Page, runDir: string | undefined, label: string): Promise<void> {
  if (!runDir) return;
  const snapDir = path.join(runDir, 'snapshots');
  await fs.mkdir(snapDir, { recursive: true }).catch(() => {});
  try {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    await fs.writeFile(path.join(snapDir, `${label}.html`), html);
    logger.debug({ label }, 'Snapshot saved');
  } catch {
    logger.debug({ label }, 'Snapshot save failed');
  }
}
