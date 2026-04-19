import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page, Response } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  launchOptions,
  contextOptions,
  BLOCKED_RESOURCES,
  FLIGHT_API_PATTERNS,
} from '../config/browser.ts';
import { withRetry } from '../utils/retry.ts';
import { dateRange } from '../utils/dates.ts';
import { logger } from '../utils/logger.ts';
import { acceptCookies } from '../browser/cookies.ts';
import { humanDelay, humanType } from '../browser/human.ts';
import type { FlightOffer, SearchParams } from '../types/index.ts';

// Aplica o plugin stealth — remove todos os indicadores de automação do browser
chromium.use(StealthPlugin());

// ── Azul URLs ─────────────────────────────────────────────────────────────────

const AZUL_HOME = 'https://www.voeazul.com.br/br/pt/home';


export async function searchFlights(params: SearchParams): Promise<FlightOffer[]> {
  const browser = await chromium.launch(launchOptions);
  const results: FlightOffer[] = [];

  try {
    // Outbound leg
    for (const date of dateRange(params.outboundStart, params.outboundEnd)) {
      logger.debug({ date, origin: params.origin, destination: params.destination }, 'Searching outbound');
      const offers = await withRetry(
        () => searchSingleDate(browser, params.origin, params.destination, date, params),
        { label: `${params.origin}->${params.destination} ${date}` },
      );
      results.push(...offers);
    }

    // Return leg (optional)
    if (params.returnStart) {
      for (const date of dateRange(params.returnStart, params.returnEnd)) {
        logger.debug({ date, origin: params.destination, destination: params.origin }, 'Searching return');
        const offers = await withRetry(
          () => searchSingleDate(browser, params.destination, params.origin, date, params),
          { label: `${params.destination}->${params.origin} ${date} (return)` },
        );
        offers.forEach(o => { o.isReturn = true; });
        results.push(...offers);
      }
    }
  } finally {
    await browser.close();
  }

  // Mark offers within target + margin
  const threshold = params.target * (1 + params.margin);
  results.forEach(o => { o.withinTarget = o.price <= threshold; });

  return results;
}

// ── Per-date search ───────────────────────────────────────────────────────────

async function searchSingleDate(
  browser: Browser,
  origin: string,
  destination: string,
  date: string,
  params: SearchParams,
): Promise<FlightOffer[]> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Block irrelevant resources for speed
  await page.route('**/*', route => {
    if (BLOCKED_RESOURCES.has(route.request().resourceType())) {
      return route.abort();
    }
    return route.continue();
  });

  const capturedResponses: Array<{ url: string; body: unknown }> = [];

  // Intercept API responses that look like flight data
  page.on('response', async (response: Response) => {
    const url = response.url();
    const isFlightApi = FLIGHT_API_PATTERNS.some(pattern => pattern.test(url));
    if (!isFlightApi) return;

    try {
      const body = await response.json();
      capturedResponses.push({ url, body });
      logger.debug({ url }, 'Captured flight API response');
    } catch {
      // Not JSON — skip
    }
  });

  let failed = false;
  try {
    await page.goto(AZUL_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await humanDelay(1_500, 3_000);  // Simula usuário lendo a página inicial
    await checkForBlock(page);
    await acceptCookies(page);
    await fillSearchForm(page, origin, destination, date, params.passengers);
    await waitForResults(page, capturedResponses);

    const offers = parseCaptures(capturedResponses, origin, destination, date);

    if (offers.length === 0) {
      logger.warn({ origin, destination, date }, 'No Azul offers found — falling back to DOM parsing');
      return parseDom(page, origin, destination, date);
    }

    return offers;
  } catch (err) {
    failed = true;
    const errDir = params.runDir ? path.join(params.runDir, 'errors') : process.cwd();
    await fs.mkdir(errDir, { recursive: true }).catch(() => {});
    await page
      .screenshot({ path: path.join(errDir, `debug-${origin}-${destination}-${date}.png`) })
      .catch(() => {});
    throw err;
  } finally {
    if (params.verbose && !failed && params.runDir) {
      await page
        .screenshot({ path: path.join(params.runDir, `debug-${origin}-${destination}-${date}.png`) })
        .catch(() => {});
    }
    await context.close();
  }
}

// ── Bot-detection guard ───────────────────────────────────────────────────────

async function checkForBlock(page: Page): Promise<void> {
  const title = await page.title();
  const body = await page.locator('body').innerText().catch(() => '');
  const isBlocked =
    /comportamento incomum|acesso foi limitado|tente desativar sua vpn/i.test(body) ||
    /blocked|access denied|403/i.test(title);

  if (isBlocked) {
    throw new Error(
      'Azul website blocked this request (bot/IP detection). ' +
      'Run from a Brazilian residential network without a VPN.',
    );
  }
}

// ── Form filling ──────────────────────────────────────────────────────────────

async function fillSearchForm(
  page: Page,
  origin: string,
  destination: string,
  date: string,
  passengers: number,
): Promise<void> {
  logger.debug('Filling search form');

  // ── Origin field ─────────────────────────────────────────────────────────
  const originInput = page
    .getByRole('combobox', { name: /origem|origin/i })
    .or(page.getByLabel(/origem|origin/i).first())
    .or(page.locator([
      'input[aria-label*="Origem" i]',
      'input[placeholder*="Origem" i]',
      'input[placeholder*="origin" i]',
      'input[name="origin"]',
      'input[name="ORIGIN"]',
      '[data-id="origin"] input',
      '[data-testid*="origin" i] input',
      '[data-testid*="origem" i] input',
    ].join(', ')).first());

  await humanType(page, originInput, origin);
  await humanDelay(600, 1_200);
  await page
    .locator([
      `[data-testid*="suggestion"]`,
      `li:has-text("${origin}")`,
      `[role="option"]:has-text("${origin}")`,
      `[class*="suggestion"]:has-text("${origin}")`,
      `[class*="autocomplete"] li:has-text("${origin}")`,
    ].join(', '))
    .first()
    .click({ timeout: 8_000 })
    .catch(() => page.keyboard.press('Enter'));

  await humanDelay(400, 800);

  // ── Destination field ────────────────────────────────────────────────────
  const destInput = page
    .getByRole('combobox', { name: /destino|destination/i })
    .or(page.getByLabel(/destino|destination/i).first())
    .or(page.locator([
      'input[aria-label*="Destino" i]',
      'input[placeholder*="Destino" i]',
      'input[placeholder*="destination" i]',
      'input[name="destination"]',
      'input[name="DESTINATION"]',
      '[data-id="destination"] input',
      '[data-testid*="destination" i] input',
      '[data-testid*="destino" i] input',
    ].join(', ')).first());

  await humanType(page, destInput, destination);
  await humanDelay(600, 1_200);
  await page
    .locator([
      `[data-testid*="suggestion"]`,
      `li:has-text("${destination}")`,
      `[role="option"]:has-text("${destination}")`,
      `[class*="suggestion"]:has-text("${destination}")`,
      `[class*="autocomplete"] li:has-text("${destination}")`,
    ].join(', '))
    .first()
    .click({ timeout: 8_000 })
    .catch(() => page.keyboard.press('Enter'));

  await humanDelay(400, 800);

  // ── Date field ───────────────────────────────────────────────────────────
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const dateInput = page
    .getByRole('textbox', { name: /data de ida|outbound|departure date|ida/i })
    .or(page.getByLabel(/data de ida|ida|outbound|departure/i).first())
    .or(page.locator([
      'input[type="date"]',
      '[data-id="date"] input',
      '[data-testid*="date" i] input',
      '[name*="date"]',
      '[name*="Data"]',
    ].join(', ')).first());

  await dateInput.click({ timeout: 10_000 });

  // Navigate calendar to the correct month if a date-picker is shown
  await navigateCalendar(page, year, month, day);

  // ── Passengers ───────────────────────────────────────────────────────────
  if (passengers > 1) {
    await setPassengers(page, passengers);
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  await page
    .getByRole('button', { name: /buscar|search|ver voos|pesquisar/i })
    .or(page.locator('[data-testid*="search" i] button, button[type="submit"]').first())
    .click({ timeout: 10_000 });
}

async function navigateCalendar(page: Page, year: number, month: number, day: number): Promise<void> {
  // If a native date input is available, fill directly
  const nativeDate = page.locator('input[type="date"]').first();
  if (await nativeDate.count() > 0) {
    await nativeDate.fill(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    return;
  }

  // Otherwise interact with a calendar widget
  const target = new Date(year, month - 1, day);
  for (let i = 0; i < 12; i++) {
    const dayCell = page.locator(`[aria-label*="${day}"]`).or(
      page.locator(`td:has-text("${day}"):not(:has-text("${day + 1}"))`).first(),
    );
    if (await dayCell.isVisible().catch(() => false)) {
      await dayCell.click();
      return;
    }
    // Advance calendar one month
    await page.getByRole('button', { name: /next|próximo|>/i }).first().click();
    await page.waitForTimeout(400);
  }

  logger.warn({ year, month, day }, 'Could not navigate calendar — pressing Enter on date input');
  await page.keyboard.press('Enter');
}

async function setPassengers(page: Page, count: number): Promise<void> {
  const passengerBtn = page
    .getByRole('button', { name: /passageiro|passenger/i })
    .or(page.locator('[data-id="passengers"]').first());

  if (await passengerBtn.count() === 0) return;

  await passengerBtn.click();
  // Click "+" for adults (count - 1) additional times
  const addAdult = page.getByRole('button', { name: /\+/ }).first();
  for (let i = 1; i < count; i++) {
    await addAdult.click();
    await page.waitForTimeout(200);
  }
}

// ── Wait for results ──────────────────────────────────────────────────────────

async function waitForResults(
  page: Page,
  captures: Array<{ url: string; body: unknown }>,
): Promise<void> {
  // Wait until we have captured at least one flight API response OR the DOM shows results
  const startTime = Date.now();
  const timeout = 30_000;

  while (Date.now() - startTime < timeout) {
    if (captures.length > 0) return;

    const hasResults = await page
      .locator('[class*="flight"], [class*="voo"], [data-testid*="flight"]')
      .count()
      .then(n => n > 0)
      .catch(() => false);

    if (hasResults) return;

    await page.waitForTimeout(500);
  }

  logger.warn('Timed out waiting for flight results');
}

// ── Parse intercepted API responses ──────────────────────────────────────────

function parseCaptures(
  captures: Array<{ url: string; body: unknown }>,
  origin: string,
  destination: string,
  date: string,
): FlightOffer[] {
  const offers: FlightOffer[] = [];

  for (const { url, body } of captures) {
    try {
      const extracted = extractFlightsFromJson(body, origin, destination, date);
      if (extracted.length > 0) {
        logger.debug({ url, count: extracted.length }, 'Parsed offers from API response');
        offers.push(...extracted);
      }
    } catch (err) {
      logger.debug({ url, err }, 'Could not parse response as flight data');
    }
  }

  // Deduplicate by flight number + date
  const seen = new Set<string>();
  return offers.filter(o => {
    const key = `${o.flightNumber}-${o.date}-${o.departure}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFlightsFromJson(data: any, origin: string, destination: string, date: string): FlightOffer[] {
  if (!data || typeof data !== 'object') return [];

  const offers: FlightOffer[] = [];

  // Navitaire-style: { journeys: [...] }
  const journeys: unknown[] = (
    data.journeys ??
    data.data?.journeys ??
    data.result?.journeys ??
    data.Journeys ??
    []
  );

  if (Array.isArray(journeys) && journeys.length > 0) {
    for (const journey of journeys) {
      const offer = mapNavitaireJourney(journey, origin, destination, date);
      if (offer) offers.push(offer);
    }
    return offers;
  }

  // Fallback: recurse into nested objects looking for journey arrays
  for (const value of Object.values(data)) {
    if (Array.isArray(value) && value.length > 0 && isJourneyLike(value[0])) {
      for (const item of value) {
        const offer = mapNavitaireJourney(item, origin, destination, date);
        if (offer) offers.push(offer);
      }
    }
  }

  return offers;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isJourneyLike(obj: any): boolean {
  return obj && typeof obj === 'object' && (
    'fares' in obj || 'segments' in obj || 'fareAmount' in obj || 'price' in obj
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapNavitaireJourney(journey: any, origin: string, destination: string, date: string): FlightOffer | null {
  try {
    const segments: unknown[] = journey.segments ?? journey.Segments ?? [];
    const firstSeg: any = segments[0] ?? journey;
    const lastSeg: any = segments[segments.length - 1] ?? journey;

    const departureStr: string =
      firstSeg.std ?? firstSeg.sto ?? firstSeg.departureTime ?? firstSeg.departure ?? '';
    const arrivalStr: string =
      lastSeg.sta ?? lastSeg.arrivalTime ?? lastSeg.arrival ?? '';

    const departure = formatTime(departureStr);
    const arrival = formatTime(arrivalStr);

    const identifier = firstSeg.identifier ?? {};
    const carrier: string = identifier.carrierCode ?? firstSeg.carrierCode ?? 'AD';
    const number: string = String(identifier.identifier ?? identifier.number ?? firstSeg.flightNumber ?? '');
    const flightNumber = `${carrier}${number}`;

    const fares: unknown[] = Array.isArray(journey.fares)
      ? journey.fares
      : Object.values(journey.fares ?? {});

    let price = 0;
    let currency = 'BRL';
    for (const fare of fares) {
      if (!fare || typeof fare !== 'object') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = fare as any;
      const amount: number = f.fareAmount ?? f.amount ?? f.totalAmount ?? 0;
      if (amount > 0 && (price === 0 || amount < price)) {
        price = amount;
        currency = f.currency ?? 'BRL';
      }
    }

    if (price === 0) return null;

    return {
      date,
      origin,
      destination,
      flightNumber,
      departure,
      arrival,
      durationMin: journey.duration ?? estimateDuration(departureStr, arrivalStr),
      stops: Math.max(0, segments.length - 1),
      price,
      currency,
      isReturn: false,
      withinTarget: false,
    };
  } catch {
    return null;
  }
}

// ── DOM fallback parser ───────────────────────────────────────────────────────

async function parseDom(page: Page, origin: string, destination: string, date: string): Promise<FlightOffer[]> {
  logger.debug('Attempting DOM-based parsing');

  // Generic selectors that cover common Navitaire / airline booking UI patterns
  const flightRows = page.locator(
    '[class*="flight-card"], [class*="voo"], [class*="result-item"], [data-testid*="flight"]',
  );

  const count = await flightRows.count();
  if (count === 0) {
    logger.warn('DOM parser found no flight elements');
    return [];
  }

  const offers: FlightOffer[] = [];

  for (let i = 0; i < count; i++) {
    const row = flightRows.nth(i);
    const text = await row.innerText().catch(() => '');

    const priceMatch = text.match(/R\$\s*([\d.,]+)/);
    const timeMatch = text.match(/(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/);
    const flightMatch = text.match(/AD\s*(\d{3,4})/i);

    if (!priceMatch) continue;

    const rawPrice = priceMatch[1]!.replace('.', '').replace(',', '.');

    offers.push({
      date,
      origin,
      destination,
      flightNumber: flightMatch ? `AD${flightMatch[1]}` : 'AD???',
      departure: timeMatch ? timeMatch[1]! : '--:--',
      arrival: timeMatch ? timeMatch[2]! : '--:--',
      durationMin: 0,
      stops: 0,
      price: parseFloat(rawPrice),
      currency: 'BRL',
      isReturn: false,
      withinTarget: false,
    });
  }

  return offers;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(isoOrTime: string): string {
  if (!isoOrTime) return '--:--';
  if (isoOrTime.includes('T')) return isoOrTime.split('T')[1]!.slice(0, 5);
  return isoOrTime.slice(0, 5);
}

function estimateDuration(departure: string, arrival: string): number {
  try {
    const dep = new Date(departure).getTime();
    const arr = new Date(arrival).getTime();
    return Math.round((arr - dep) / 60_000);
  } catch {
    return 0;
  }
}
