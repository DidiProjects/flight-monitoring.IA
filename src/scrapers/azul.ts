import { chromium } from 'rebrowser-playwright';
import type { Browser, Page } from 'rebrowser-playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  launchOptions,
  contextOptions,
  BLOCKED_RESOURCES,
} from '../config/browser.ts';
import { dateRange } from '../utils/dates.ts';
import { logger } from '../utils/logger.ts';
import { acceptCookies } from '../browser/cookies.ts';
import { humanDelay } from '../browser/human.ts';
import type { FlightOffer, SearchParams } from '../types/index.ts';

const AZUL_HOME = 'https://www.voeazul.com.br/br/pt/home';

// ── Main entry ────────────────────────────────────────────────────────────────

export async function searchFlights(params: SearchParams): Promise<FlightOffer[]> {
  const browser = await chromium.launch(launchOptions);
  const results: FlightOffer[] = [];

  try {
    const outbound = await searchRoute(
      browser, params.origin, params.destination,
      params.outboundStart, params.outboundEnd ?? params.outboundStart,
      params, false,
    );
    results.push(...outbound);

    if (params.returnStart) {
      const ret = await searchRoute(
        browser, params.destination, params.origin,
        params.returnStart, params.returnEnd ?? params.returnStart,
        params, true,
      );
      results.push(...ret);
    }
  } finally {
    await browser.close();
  }

  const threshold = params.target * (1 + params.margin);
  results.forEach(o => { o.withinTarget = o.price <= threshold; });
  return results;
}

// ── Route search: one page, navigate calendar through date range ──────────────

async function searchRoute(
  browser: Browser,
  origin: string,
  destination: string,
  startDate: string,
  endDate: string,
  params: SearchParams,
  isReturn: boolean,
): Promise<FlightOffer[]> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  await page.route('**/*', route => {
    if (BLOCKED_RESOURCES.has(route.request().resourceType())) return route.abort();
    return route.continue();
  });

  const allOffers: FlightOffer[] = [];

  try {
    logger.info({ origin, destination, startDate, endDate }, 'Opening search page');

    await page.goto(AZUL_HOME, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await humanDelay(2_000, 3_500);

    // Warm-up: wait until page context is ready for evaluation (rebrowser race condition fix)
    await waitForEvalReady(page);
    logger.debug('Page loaded and context ready');

    await checkForBlock(page);
    await acceptCookies(page);
    // Let any post-cookie reload/navigation settle
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await humanDelay(800, 1_200);
    await hideOnetrust(page);
    await waitForSearchForm(page);
    logger.debug('Form ready');
    await saveSnapshot(page, params.runDir, `${origin}-${destination}-home`);

    // Fill form with the START date of the range
    await fillSearchForm(page, origin, destination, startDate, params.passengers);

    // Wait for results page to load
    const firstLoaded = await waitForResults(page);
    await saveSnapshot(page, params.runDir, `${origin}-${destination}-${startDate}-results`);
    const dates = [...dateRange(startDate, endDate)];

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]!;

      // First date is already displayed after form submission
      if (i === 0) {
        if (!firstLoaded) {
          logger.info({ date, origin, destination }, 'No flights for start date — skipping');
          continue;
        }
      } else {
        const navigated = await navigateCalendarToDate(page, date);
        if (!navigated) {
          logger.warn({ date }, 'Could not navigate to date — skipping');
          continue;
        }
        const loaded = await waitForResults(page);
        await saveSnapshot(page, params.runDir, `${origin}-${destination}-${date}-results`);
        if (!loaded) {
          logger.info({ date, origin, destination }, 'No flights for this date — skipping');
          continue;
        }
      }

      // Collect BRL
      await setCurrencyView(page, 'Reais');
      await humanDelay(600, 1_000);
      const brlFlights = await collectFlights(page, origin, destination, date);

      // Collect Points
      await setCurrencyView(page, 'Pontos');
      await humanDelay(600, 1_000);
      const ptsFlights = await collectFlights(page, origin, destination, date);

      logger.info({ date, origin, destination, brl: brlFlights.length, pts: ptsFlights.length }, 'Date collected');

      if (params.runDir) {
        const dateDir = path.join(params.runDir, date);
        await fs.mkdir(dateDir, { recursive: true });
        await fs.writeFile(
          path.join(dateDir, `${origin}-${destination}-brl.json`),
          JSON.stringify(brlFlights, null, 2),
        );
        await fs.writeFile(
          path.join(dateDir, `${origin}-${destination}-pts.json`),
          JSON.stringify(ptsFlights, null, 2),
        );
      }

      brlFlights.forEach(o => { o.isReturn = isReturn; });
      allOffers.push(...brlFlights);
    }

  } catch (err) {
    const errDir = params.runDir ? path.join(params.runDir, 'errors') : process.cwd();
    await fs.mkdir(errDir, { recursive: true }).catch(() => {});
    const base = `${origin}-${destination}`;
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

// ── Context warm-up ──────────────────────────────────────────────────────────

// Waits until page.evaluate succeeds — fixes rebrowser-playwright race condition
// when the page navigates during initial load and the CDP context gets destroyed.
async function waitForEvalReady(page: Page): Promise<void> {
  for (let i = 0; i < 8; i++) {
    try {
      await page.evaluate(() => document.readyState);
      return;
    } catch {
      await page.waitForTimeout(800);
    }
  }
  logger.warn('waitForEvalReady: context never stabilised — proceeding anyway');
}

// ── Bot detection ─────────────────────────────────────────────────────────────

async function checkForBlock(page: Page): Promise<void> {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  if (
    /comportamento incomum|acesso foi limitado|tente desativar sua vpn/i.test(body) ||
    /blocked|access denied|403/i.test(title)
  ) {
    throw new Error('Azul website blocked this request (bot/IP detection).');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function hideOnetrust(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sdk = document.querySelector('#onetrust-consent-sdk') as HTMLElement | null;
    if (sdk) sdk.style.display = 'none';
    const filter = document.querySelector('.onetrust-pc-dark-filter') as HTMLElement | null;
    if (filter) filter.style.display = 'none';
  }).catch(() => {});
  await page.waitForTimeout(500);
}

async function waitForSearchForm(page: Page): Promise<void> {
  await page
    .locator('input[aria-label*="Origem" i]')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => logger.warn('Search form attach timeout — proceeding'));
}

// Converts "YYYY-MM-DD" → "DDMMYYYY" (Azul date input format)
function toDDMMYYYY(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}${month}${year}`;
}

// ── Form filling ──────────────────────────────────────────────────────────────

async function fillSearchForm(
  page: Page,
  origin: string,
  destination: string,
  date: string,
  passengers: number,
): Promise<void> {
  logger.debug({ origin, destination, date }, 'Filling search form');

  // Origin — opacity:0 input, click via parent container coords
  await clickVisibleContainer(page, 'input[aria-label*="Origem" i]');
  await humanDelay(300, 600);
  await page.keyboard.type(origin, { delay: 80 + Math.random() * 80 });
  await humanDelay(800, 1_400);
  await selectAirportOption(page, origin);
  await humanDelay(600, 1_000);

  // Destination
  await clickVisibleContainer(page, 'input[aria-label*="Destino" i]');
  await humanDelay(300, 600);
  await page.keyboard.type(destination, { delay: 80 + Math.random() * 80 });
  await humanDelay(800, 1_400);
  await selectAirportOption(page, destination);
  await humanDelay(400, 800);

  // Date — type DDMMYYYY directly (no modal opens)
  await clickVisibleContainer(page, 'input[aria-label*="Datas" i]');
  await humanDelay(300, 500);
  await page.keyboard.type(toDDMMYYYY(date), { delay: 100 + Math.random() * 50 });
  await humanDelay(400, 700);

  if (passengers > 1) {
    await setPassengers(page, passengers);
  }

  await clickBuscarPassagens(page);
  logger.debug('Search form submitted');
}

// Clicks the visible parent container of an opacity:0 input, then focuses the input
async function clickVisibleContainer(page: Page, inputSel: string): Promise<void> {
  const coords = await page.evaluate((sel) => {
    const input = document.querySelector(sel) as HTMLElement | null;
    if (!input) return null;
    let el: HTMLElement | null = input;
    for (let i = 0; i < 6; i++) {
      const r = el.getBoundingClientRect();
      if (r.width >= 40 && r.height >= 20) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      el = el.parentElement;
      if (!el) break;
    }
    return null;
  }, inputSel).catch(() => null);

  if (coords && coords.y > 0 && coords.y < 1200) {
    await page.mouse.click(coords.x, coords.y);
  } else {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) el.click();
    }, inputSel).catch(() => {});
  }

  // Explicitly focus the input so keyboard events land correctly
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (el) el.focus();
  }, inputSel).catch(() => {});
}

// Selects the airport code option from the autocomplete dropdown
async function selectAirportOption(page: Page, code: string): Promise<void> {
  // Poll for autocomplete options to appear (avoids page.waitForFunction serialization issues)
  const optionLoc = page.locator('button[role="option"]');
  const pollStart = Date.now();
  while (Date.now() - pollStart < 6_000) {
    if ((await optionLoc.count().catch(() => 0)) > 0) break;
    await page.waitForTimeout(200);
  }

  const clicked = await page.evaluate((c) => {
    const opts = Array.from(document.querySelectorAll<HTMLElement>('button[role="option"]'));
    const opt = opts.find(o => o.querySelector('b')?.textContent?.trim() === c)
      ?? opts.find(o => o.textContent?.includes(c));
    if (opt) {
      opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      opt.click();
      return true;
    }
    return false;
  }, code);

  if (!clicked) {
    logger.warn({ code }, 'Autocomplete option not found — pressing Enter');
    await page.keyboard.press('Enter');
  }
}

// Clicks "Buscar passagens" button via DOM (class names are hashed, match by text)
async function clickBuscarPassagens(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('button'));
    const btn = btns.find(b => b.textContent?.trim() === 'Buscar passagens');
    if (btn) { btn.click(); return true; }
    return false;
  });

  if (!clicked) {
    await page
      .locator('button')
      .filter({ hasText: 'Buscar passagens' })
      .first()
      .click({ timeout: 8_000 });
  }
}

async function setPassengers(page: Page, count: number): Promise<void> {
  const btn = page.getByRole('button', { name: /passageiro|passenger/i }).first();
  if (await btn.count() === 0) return;
  await btn.click();
  const addBtn = page.getByRole('button', { name: /\+/ }).first();
  for (let i = 1; i < count; i++) {
    await addBtn.click();
    await humanDelay(200, 400);
  }
}

// ── Wait for results ──────────────────────────────────────────────────────────

// Returns true if results loaded, false if empty-state (no flights available).
// Uses locator polling — avoids page.waitForFunction serialization issues with tsx.
async function waitForResults(page: Page): Promise<boolean> {
  const deadline = Date.now() + 35_000;

  while (Date.now() < deadline) {
    if ((await page.locator('p.results').count().catch(() => 0)) > 0) {
      logger.debug('Results ready — p.results found');
      return true;
    }
    if ((await page.locator('p.css-1wdbheb').count().catch(() => 0)) > 0) {
      logger.info('Empty result state — no flights available for this date');
      return false;
    }
    if ((await page.locator('.booking-calendar__cards').count().catch(() => 0)) > 0) {
      logger.debug('Results ready — booking-calendar visible');
      return true;
    }
    await page.waitForTimeout(500);
  }

  logger.warn('waitForResults timed out — proceeding');
  return true;
}

// ── Booking-calendar navigation ───────────────────────────────────────────────

async function navigateCalendarToDate(page: Page, date: string): Promise<boolean> {
  const [, month, day] = date.split('-')!;
  const ddmm = `${day}/${month}`; // "25/05"

  logger.debug({ date, ddmm }, 'Navigating calendar to date');

  const clicked = await page.evaluate((target) => {
    const container = document.querySelector('.booking-calendar__cards');
    const btns = container
      ? Array.from(container.querySelectorAll<HTMLElement>('button'))
      : Array.from(document.querySelectorAll<HTMLElement>('button'));

    const btn = btns.find(b => (b.getAttribute('aria-label') ?? '').includes(target));
    if (btn) { btn.click(); return true; }
    return false;
  }, ddmm);

  if (clicked) {
    await humanDelay(800, 1_500);
  } else {
    logger.warn({ date, ddmm }, 'Calendar date button not found');
  }
  return clicked;
}

// ── Currency toggle ───────────────────────────────────────────────────────────

async function setCurrencyView(page: Page, view: 'Reais' | 'Pontos'): Promise<void> {
  await page.evaluate((v) => {
    const btns = Array.from(document.querySelectorAll<HTMLElement>('button'));
    const btn = btns.find(b =>
      b.getAttribute('aria-label') === v || b.textContent?.trim() === v,
    );
    if (btn) btn.click();
  }, view);
  await humanDelay(400, 700);
}

// ── Flight data collection ────────────────────────────────────────────────────

async function collectFlights(
  page: Page,
  origin: string,
  destination: string,
  date: string,
): Promise<FlightOffer[]> {
  // Walk the DOM looking for elements that contain both time patterns and price/points content
  // Uses iterative stack to avoid named functions inside evaluate (tsx __name issue)
  const rawCards = await page.evaluate(() => {
    const results: Array<{ html: string; text: string }> = [];
    const seen = new Set<string>();
    const root = document.querySelector('main') ?? document.body;
    const stack: Array<[Element, number]> = [[root, 0]];

    while (stack.length > 0) {
      const item = stack.pop()!;
      const el = item[0];
      const depth = item[1];
      if (depth > 12) continue;
      const childCount = el.children.length;
      const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
      const hasTime = /\b\d{2}:\d{2}\b/.test(text);
      const hasPrice = /R\$|pontos|\d{3,}/i.test(text);
      if (hasTime && hasPrice && childCount >= 2 && childCount <= 40) {
        const html = (el as HTMLElement).outerHTML;
        if (html.length > 80 && html.length < 12_000) {
          const key = text.slice(0, 120).replace(/\s+/g, ' ');
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ html, text: text.replace(/\s+/g, ' ').trim() });
            continue; // Don't recurse into a matched card
          }
        }
      }
      for (let i = el.children.length - 1; i >= 0; i--) {
        stack.push([el.children[i]!, depth + 1]);
      }
    }

    return results.slice(0, 40);
  });

  logger.debug({ count: rawCards.length, date, origin, destination }, 'Flight card candidates found');

  const offers: FlightOffer[] = [];
  const seen = new Set<string>();

  for (const { text, html } of rawCards) {
    const offer = parseFlightCard(text, html, origin, destination, date);
    if (!offer) continue;
    const key = `${offer.departure}-${offer.arrival}-${offer.price}`;
    if (!seen.has(key)) {
      seen.add(key);
      offers.push(offer);
    }
  }

  return offers;
}

function parseFlightCard(
  text: string,
  html: string,
  origin: string,
  destination: string,
  date: string,
): FlightOffer | null {
  // Need at least two time tokens for departure + arrival
  const times = [...text.matchAll(/\b(\d{2}:\d{2})\b/g)].map(m => m[1]!);
  if (times.length < 2) return null;

  const departure = times[0]!;
  const arrival = times[1]!;

  // Price
  let price = 0;
  let currency = 'BRL';

  const brlMatch = text.match(/R\$\s*([\d.,]+)/);
  const ptsMatch = text.match(/([\d.,]+)\s*pontos?/i) ?? text.match(/(\d{3,})\s*pts\b/i);

  if (brlMatch) {
    price = parseFloat(brlMatch[1]!.replace(/\./g, '').replace(',', '.'));
    currency = 'BRL';
  } else if (ptsMatch) {
    price = parseFloat(ptsMatch[1]!.replace(/\./g, '').replace(',', '.'));
    currency = 'PTS';
  }

  if (price <= 0 || isNaN(price)) return null;

  // Flight number
  const fnMatch = (html + text).match(/AD[\s-]?(\d{3,4})/i);
  const flightNumber = fnMatch ? `AD${fnMatch[1]}` : 'AD???';

  // Stops
  let stops = 0;
  if (/\b2\s*esc/i.test(text)) stops = 2;
  else if (/\b1\s*esc|1\s*parada/i.test(text)) stops = 1;
  else if (/direto|nonstop|non.?stop/i.test(text)) stops = 0;

  // Duration
  const durMatch = text.match(/(\d+)h\s*(\d+)?m?/i);
  const durationMin = durMatch
    ? parseInt(durMatch[1]!) * 60 + (durMatch[2] ? parseInt(durMatch[2]) : 0)
    : 0;

  return {
    date,
    origin,
    destination,
    flightNumber,
    departure,
    arrival,
    durationMin,
    stops,
    price,
    currency,
    isReturn: false,
    withinTarget: false,
  };
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

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
