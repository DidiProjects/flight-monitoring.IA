import { firefox } from 'playwright';
import type { Browser, BrowserContext, Cookie, Page } from 'playwright';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  contextOptions,
  BLOCKED_RESOURCES,
} from '../config/browser.ts';
import { dateRange } from '../utils/dates.ts';
import { logger } from '../utils/logger.ts';
import { acceptCookies } from '../browser/cookies.ts';
import { humanDelay } from '../browser/human.ts';
import { toTimestamp } from '../utils/airports.ts';
import type { FlightOffer, FlightFares, ScraperParams } from '../types/index.ts';

type LogCtx = { requestId?: string; routineId?: string; airline?: string };

const AZUL_HOME    = 'https://www.voeazul.com.br/br/pt/home';
const AZUL_RESULTS = 'https://www.voeazul.com.br/br/pt/home/selecao-voo';

// ── Session persistence ───────────────────────────────────────────────────────

const SESSION_FILE = path.join(process.cwd(), '.sessions', 'azul-cookies.json');

async function loadSavedCookies(): Promise<Cookie[]> {
  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf-8');
    const cookies: Cookie[] = JSON.parse(raw);
    const nowSec = Date.now() / 1000;
    const valid = cookies.filter(c => !c.expires || c.expires === -1 || c.expires > nowSec);
    logger.debug({ total: cookies.length, valid: valid.length }, 'Loaded Azul session cookies');
    return valid;
  } catch {
    return [];
  }
}

async function saveSessionCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
    await fs.writeFile(SESSION_FILE, JSON.stringify(cookies, null, 2));
    logger.debug({ count: cookies.length }, 'Saved Azul session cookies');
  } catch {
    // non-critical
  }
}

// Builds the direct deep-link URL for a flight search
// date: "YYYY-MM-DD", currency: "BRL" | "PTS"
function buildSearchUrl(origin: string, destination: string, date: string, currency: 'BRL' | 'PTS', passengers: number): string {
  const [year, month, day] = date.split('-');
  const std = `${month}/${day}/${year}`; // MM/DD/YYYY, Azul's expected format
  return `${AZUL_RESULTS}?c[0].ds=${origin}&c[0].std=${std}&c[0].as=${destination}&p[0].t=ADT&p[0].c=${passengers}&p[0].cp=false&f.dl=3&f.dr=3&cc=${currency}`;
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function searchFlights(params: ScraperParams): Promise<FlightOffer[]> {
  const foxOptions = await camoufoxLaunchOptions({
    headless: false,
    os: 'windows',
    locale: 'pt-BR',
    humanize: true,
  });
  const browser = await firefox.launch(foxOptions);
  const results: FlightOffer[] = [];

  const savedCookies = await loadSavedCookies();

  try {
    const outbound = await searchRoute(
      browser, params.origin, params.destination,
      params.outboundStart, params.outboundEnd ?? params.outboundStart,
      params, false, savedCookies,
    );
    results.push(...outbound);

    if (params.returnStart) {
      await humanDelay(8_000, 15_000);
      const ret = await searchRoute(
        browser, params.destination, params.origin,
        params.returnStart, params.returnEnd ?? params.returnStart,
        params, true, savedCookies,
      );
      results.push(...ret);
    }
  } finally {
    await browser.close();
  }

  return results;
}

// ── Route search: one page, navigate calendar through date range ──────────────

async function searchRoute(
  browser: Browser,
  origin: string,
  destination: string,
  startDate: string,
  endDate: string,
  params: ScraperParams,
  isReturn: boolean,
  savedCookies: Cookie[] = [],
): Promise<FlightOffer[]> {
  const context = await browser.newContext(contextOptions);

  if (savedCookies.length > 0) {
    await context.addCookies(savedCookies);
    logger.debug({ count: savedCookies.length }, 'Injected persisted Azul session cookies');
  }

  const page = await context.newPage();

  await page.route('**/*', route => {
    if (BLOCKED_RESOURCES.has(route.request().resourceType())) return route.abort();
    return route.continue();
  });

  const allOffers: FlightOffer[] = [];
  const logCtx: LogCtx = { requestId: params.requestId, routineId: params.routineId, airline: params.airline };

  try {
    logger.info({ ...logCtx, origin, destination, startDate, endDate }, 'Opening search page');

    // ── Primary: direct URL → Fallback: form fill (with retry on API error) ────
    let firstLoaded = false;
    const directOk = await tryDirectNavigation(page, origin, destination, startDate, params.passengers, logCtx);

    if (directOk) {
      firstLoaded = await waitForResults(page, logCtx);
      await saveSnapshot(page, params.runDir, `${origin}-${destination}-${startDate}-results`);
    }

    if (!directOk || !firstLoaded) {
      // Fallback: form fill — also used as retry when direct URL returns API error
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt > 1) {
          logger.info({ ...logCtx, origin, destination }, 'API error — waiting 120s before retry');
          await new Promise(r => setTimeout(r, 120_000));
        }
        logger.info({ ...logCtx, origin, destination, attempt }, 'Falling back to form fill');
        await page.goto(AZUL_HOME, { waitUntil: 'load', timeout: 60_000 });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await humanDelay(3_000, 5_000);
        await waitForEvalReady(page);
        await checkForBlock(page);
        await acceptCookies(page);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await humanDelay(1_500, 3_000);
        await hideOnetrust(page);
        await waitForSearchForm(page, logCtx);
        await saveSnapshot(page, params.runDir, `${origin}-${destination}-home`);
        await fillSearchForm(page, origin, destination, startDate, params.passengers, logCtx);
        firstLoaded = await waitForResults(page, logCtx);
        await saveSnapshot(page, params.runDir, `${origin}-${destination}-${startDate}-results`);

        if (firstLoaded) break;

        // Only retry if it was an API error modal (retryable), not genuine no-flights
        const isApiError = (await page.locator('button:text("Ok, entendi")').count().catch(() => 0)) > 0;
        if (!isApiError) break;
        await page.locator('button:text("Ok, entendi")').first().click({ timeout: 3_000 }).catch(() => {});
        logger.warn({ ...logCtx, attempt }, 'Dismissed API error modal, will retry');
      }
    }
    const dates = [...dateRange(startDate, endDate)];

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i]!;

      if (i > 0) {
        await humanDelay(6_000, 12_000);
      }

      if (i === 0) {
        // First date already loaded by tryDirectNavigation (or form fill)
        if (!firstLoaded) {
          logger.info({ date, origin, destination }, 'No flights for start date, skipping');
          continue;
        }
      } else {
        // Primary: direct URL navigation for this specific date
        let loaded: boolean;
        const ok = await tryDirectNavigation(page, origin, destination, date, params.passengers, logCtx);
        if (ok) {
          loaded = await waitForResults(page, logCtx);
        } else {
          // Fallback: calendar navigation (only works if still on the results page)
          logger.warn({ ...logCtx, date }, 'Direct URL failed, trying calendar navigation');
          const navigated = await navigateCalendarToDate(page, date, logCtx);
          if (!navigated) {
            logger.warn({ ...logCtx, date, origin, destination }, 'Calendar navigation also failed, skipping date');
            continue;
          }
          loaded = await waitForResults(page, logCtx);
        }
        await saveSnapshot(page, params.runDir, `${origin}-${destination}-${date}-results`);
        if (!loaded) {
          logger.info({ date, origin, destination }, 'No flights for this date, skipping');
          continue;
        }
      }

      // Collect all fares (BRL + points + hybrid) in a single pass
      const flights = await collectAllFares(page, origin, destination, date, params.runDir, logCtx);
      flights.forEach(o => { o.isReturn = isReturn; });

      logger.info({ date, origin, destination, count: flights.length }, 'Date collected');

      if (params.runDir) {
        const dateDir = path.join(params.runDir, date);
        await fs.mkdir(dateDir, { recursive: true });
        await fs.writeFile(
          path.join(dateDir, `${origin}-${destination}.json`),
          JSON.stringify(flights, null, 2),
        );
      }

      allOffers.push(...flights);
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
    await saveSessionCookies(context);
    await context.close();
  }

  return allOffers;
}

// ── Context warm-up ──────────────────────────────────────────────────────────

// Waits until page.evaluate succeeds, fixes rebrowser-playwright race condition
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
  logger.warn('waitForEvalReady: context never stabilised, proceeding anyway');
}

// ── Direct URL navigation ─────────────────────────────────────────────────────

// Tries navigating straight to the results deep-link up to 3 times.
// Returns true if a results page loaded successfully; false if all attempts fail.
async function tryDirectNavigation(
  page: Page,
  origin: string,
  destination: string,
  date: string,
  passengers: number,
  logCtx: LogCtx = {},
): Promise<boolean> {
  const url = buildSearchUrl(origin, destination, date, 'BRL', passengers);

  for (let attempt = 1; attempt <= 3; attempt++) {
    logger.debug({ attempt, origin, destination, date }, 'Trying direct URL navigation');
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await humanDelay(1_500, 2_500);
      await waitForEvalReady(page);
      await checkForBlock(page);
      await acceptCookies(page);
      await hideOnetrust(page);

      // Verify we landed on the results page, not silently redirected to home.
      // For i>0 dates, the session cookie already exists from the form fill on the
      // first date, so direct URL navigation lands on the real results page.
      const onResults = await page.evaluate(() =>
        window.location.pathname.includes('selecao-voo') ||
        document.querySelector('div.flight-card[id]') !== null ||
        document.querySelector('p.results') !== null ||
        document.querySelector('.booking-calendar__cards') !== null,
      ).catch(() => false);

      if (!onResults) {
        logger.warn({ ...logCtx, attempt }, 'Direct navigation redirected away from results, retrying');
        if (attempt < 3) await humanDelay(4_000, 6_000);
        continue;
      }

      logger.info({ origin, destination, date, attempt }, 'Direct URL navigation succeeded');
      return true;
    } catch (err) {
      logger.warn({ ...logCtx, attempt, err: String(err).slice(0, 120) }, 'Direct URL navigation attempt failed');
      if (attempt < 3) await humanDelay(4_000, 6_000);
    }
  }

  logger.warn({ ...logCtx, origin, destination, date }, 'All direct URL attempts failed, will use form fill');
  return false;
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

async function waitForSearchForm(page: Page, logCtx: LogCtx = {}): Promise<void> {
  await page
    .locator('input[aria-label*="Origem" i]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
    .catch(() => logger.warn({ ...logCtx }, 'Search form attach timeout, proceeding'));
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
  logCtx: LogCtx = {},
): Promise<void> {
  logger.debug({ origin, destination, date }, 'Filling search form');

  // Origin, opacity:0 input, click via parent container coords
  await clickVisibleContainer(page, 'input[aria-label*="Origem" i]');
  await humanDelay(300, 600);
  await page.keyboard.type(origin, { delay: 80 + Math.random() * 80 });
  await humanDelay(800, 1_400);
  await selectAirportOption(page, origin, logCtx);
  await humanDelay(600, 1_000);

  // Destination
  await clickVisibleContainer(page, 'input[aria-label*="Destino" i]');
  await humanDelay(300, 600);
  await page.keyboard.type(destination, { delay: 80 + Math.random() * 80 });
  await humanDelay(800, 1_400);
  await selectAirportOption(page, destination, logCtx);
  await humanDelay(400, 800);

  // Date, type DDMMYYYY directly (no modal opens)
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
async function selectAirportOption(page: Page, code: string, logCtx: LogCtx = {}): Promise<void> {
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
    logger.warn({ ...logCtx, code }, 'Autocomplete option not found, pressing Enter');
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

// Returns true if results loaded, false if empty-state or API error.
// When returning false due to API error, the "Ok, entendi" modal is intentionally
// left open so the caller can detect it and decide whether to retry.
async function waitForResults(page: Page, logCtx: LogCtx = {}): Promise<boolean> {
  const deadline = Date.now() + 35_000;

  while (Date.now() < deadline) {
    if ((await page.locator('p.results').count().catch(() => 0)) > 0) {
      logger.debug('Results ready, p.results found');
      return true;
    }
    if ((await page.locator('p.css-1wdbheb').count().catch(() => 0)) > 0) {
      logger.info('Empty result state, no flights available for this date');
      return false;
    }
    if ((await page.locator('.booking-calendar__cards').count().catch(() => 0)) > 0) {
      logger.debug('Results ready, booking-calendar visible');
      return true;
    }
    // Azul API error modal — leave it open so the caller can detect + retry
    if ((await page.locator('button:text("Ok, entendi")').count().catch(() => 0)) > 0) {
      logger.warn({ ...logCtx }, 'Azul API error modal detected');
      return false;
    }
    await page.waitForTimeout(500);
  }

  logger.warn({ ...logCtx }, 'waitForResults timed out, proceeding');
  return true;
}

// ── Booking-calendar navigation ───────────────────────────────────────────────

async function navigateCalendarToDate(page: Page, date: string, logCtx: LogCtx = {}): Promise<boolean> {
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
    logger.warn({ ...logCtx, date, ddmm }, 'Calendar date button not found');
  }
  return clicked;
}

// ── Currency toggle ───────────────────────────────────────────────────────────

async function setCurrencyView(page: Page, view: 'Reais' | 'Pontos', logCtx: LogCtx = {}): Promise<void> {
  const isPoints = view === 'Pontos';
  const value    = isPoints ? 'score' : 'currency';

  // Target the results-section toggle specifically (inside .currencySelector, right above card-list)
  // Falls back to first match if currencySelector is not found
  const btn = page.locator(`.currencySelector button[value="${value}"]`).first();
  const btnFallback = page.locator(`button[value="${value}"]`).first();
  const target = (await btn.count().catch(() => 0)) > 0 ? btn : btnFallback;
  const exists = (await target.count().catch(() => 0)) > 0;

  if (exists) {
    try {
      await target.scrollIntoViewIfNeeded({ timeout: 3_000 });
      await target.click({ timeout: 5_000 });
    } catch {
      // Fallback: PointerEvent sequence bubbles through React's root listener
      await page.evaluate((val) => {
        const container = document.querySelector('.currencySelector') ?? document;
        const b = container.querySelector<HTMLElement>(`button[value="${val}"]`);
        if (b) {
          b.scrollIntoView({ behavior: 'instant', block: 'center' });
          ['pointerdown', 'pointerup'].forEach(t =>
            b.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true })),
          );
          b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      }, value);
    }
  }

  // Wait for any network requests triggered by the currency toggle to settle
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

  // Dismiss error modal if the currency switch triggered an API error
  const errorBtn = page.locator('button:text("Ok, entendi")').first();
  if ((await errorBtn.count().catch(() => 0)) > 0) {
    await errorBtn.click({ timeout: 3_000 }).catch(() => {});
    logger.warn({ ...logCtx, view }, 'Dismissed error modal after currency switch');
  }

  // Wait for at least one fare price element to reflect the new view
  // Use [data-test-id~="fare-price"] (word match) to catch both "fare-price" and "fare-price fare-price-with-points"
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const switched = await page.evaluate((pts) => {
      const el = document.querySelector<HTMLElement>('[data-test-id~="fare-price"]');
      if (!el) return false;
      const text = el.textContent ?? '';
      return pts ? /pontos/i.test(text) : /R\$/.test(text);
    }, isPoints).catch(() => false);
    if (switched) break;
    await page.waitForTimeout(300);
  }

  await humanDelay(200, 400);
}

// ── Flight data collection ────────────────────────────────────────────────────

// Collects base info + BRL fares (in Reais view) + points/hybrid fares (in Pontos view)
// in a single function, returning a unified FlightOffer per card.
async function collectAllFares(
  page: Page,
  origin: string,
  destination: string,
  date: string,
  runDir?: string,
  logCtx: LogCtx = {},
): Promise<FlightOffer[]> {
  // ── Step 1: BRL view ──────────────────────────────────────────────────────
  await setCurrencyView(page, 'Reais', logCtx);
  await humanDelay(600, 1_000);

  type BrlCard = {
    cardId: string;
    depTime: string; depIata: string;
    arrTime: string; arrIata: string;
    durLabel: string; legText: string;
    priceText: string;
  };

  const brlCards: BrlCard[] = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('div.flight-card[id]'));
    return cards.map(card => {
      const cardId = card.id;

      const depEl = card.querySelector('h4.departure');
      const depTime = (depEl?.firstChild as Text | null)?.data?.trim() ?? '';
      const depIata = depEl?.querySelector('span.iata-day')?.textContent?.trim() ?? '';

      const arrEl = card.querySelector('h4.arrival');
      const arrTime = (arrEl?.firstChild as Text | null)?.data?.trim() ?? '';
      const arrIata = arrEl?.querySelector('.iata-day.arrival, span.iata-day')?.textContent?.trim() ?? '';

      const durBtn = card.querySelector<HTMLElement>('button.duration');
      const durLabel = durBtn?.getAttribute('aria-label') ?? '';

      const legBtn = card.querySelector('.flight-leg-info button');
      const legText = legBtn?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

      const priceEl = card.querySelector<HTMLElement>('h4[data-test-id="fare-price"]');
      const priceText = (priceEl?.innerText ?? priceEl?.textContent ?? '').replace(/\s+/g, '');

      return { cardId, depTime, depIata, arrTime, arrIata, durLabel, legText, priceText } as {
        cardId: string; depTime: string; depIata: string;
        arrTime: string; arrIata: string;
        durLabel: string; legText: string; priceText: string;
      };
    });
  });

  // ── Step 2: Points view ───────────────────────────────────────────────────
  await setCurrencyView(page, 'Pontos', logCtx);

  // setCurrencyView already waited for "pontos" to appear in the fare price text
  await humanDelay(400, 700);

  type PtsCard = { cardId: string; ptsText: string; condText: string; debug: string };

  const ptsCards: PtsCard[] = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('div.flight-card[id]'));
    return cards.map(card => {
      // Points-only price: dedicated element with data-test-id containing "fare-price-with-points"
      // HTML example: <h4 data-test-id="fare-price fare-price-with-points">399.960<span class="points">pontos</span></h4>
      const ptsOnlyEl =
        card.querySelector<HTMLElement>('.fare-container [data-test-id~="fare-price-with-points"]') ??
        card.querySelector<HTMLElement>('[data-test-id~="fare-price-with-points"]') ??
        card.querySelector<HTMLElement>('[data-test-id~="fare-price"]');
      const fareText = (ptsOnlyEl?.textContent ?? '').replace(/\s+/g, ' ').trim();

      // Points amount: "399.960 pontos" or "230.000 pontos"
      const ptsMatch = fareText.match(/([\d.]+)\s*pontos/i);
      const ptsText = ptsMatch ? ptsMatch[1]! : '';

      // Hybrid: p.condition → "ou 16.100 pontos + R$ 2.409,96"
      const condEl = card.querySelector<HTMLElement>('p.condition');
      const condText = condEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

      return { cardId: card.id, ptsText, condText, debug: fareText.slice(0, 40) } as PtsCard;
    });
  });

  if (runDir) {
    const snapDir = path.join(runDir, 'snapshots');
    await fs.mkdir(snapDir, { recursive: true }).catch(() => {});
    await page.screenshot({ path: path.join(snapDir, `${origin}-${destination}-${date}-pts-view.png`), fullPage: false }).catch(() => {});
  }
  await saveSnapshot(page, runDir, `${origin}-${destination}-${date}-pts-view`);

  const ptsMap = new Map(ptsCards.map(c => [c.cardId, c]));

  // ── Step 3: Merge ─────────────────────────────────────────────────────────
  logger.debug({ count: brlCards.length, date, origin, destination }, 'Flight cards found');

  const offers: FlightOffer[] = [];
  const seen = new Set<string>();

  for (const b of brlCards) {
    if (!b.depTime || !b.arrTime) continue;
    if (seen.has(b.cardId)) continue;
    seen.add(b.cardId);

    // Duration from aria-label: "Tempo de duração: 1 dia 2 hora 50 minuto. Ver detalhes"
    const dias  = b.durLabel.match(/(\d+)\s*dia/i)?.[1];
    const horas = b.durLabel.match(/(\d+)\s*hora/i)?.[1];
    const mins  = b.durLabel.match(/(\d+)\s*minuto/i)?.[1];
    const durationMin = (dias  ? parseInt(dias)  * 1440 : 0)
                      + (horas ? parseInt(horas) * 60   : 0)
                      + (mins  ? parseInt(mins)          : 0);

    if (durationMin <= 0) {
      logger.warn({ ...logCtx, cardId: b.cardId, durLabel: b.durLabel }, 'Could not parse duration, skipping flight');
      continue;
    }

    // Stops + flight number from leg text: "1 conexão    •  Voo 8751" or "Direto  •  Voo 1234"
    let stops = 0;
    const conexMatch = b.legText.match(/(\d+)\s*conex/i);
    if (conexMatch) stops = parseInt(conexMatch[1]!);
    else if (/direto/i.test(b.legText)) stops = 0;

    const vooMatch = b.legText.match(/Voo\s*(\d+)/i);
    const flightNumber = vooMatch ? `AD${vooMatch[1]}` : 'AD???';

    // BRL fare: "R$2.843,50" or "R$2.84350"
    const fares: FlightFares = {};
    const brlMatch = b.priceText.match(/R?\$?([\d.]+)[,.](\d{2})$/);
    if (brlMatch) {
      const amount = parseFloat(brlMatch[1]!.replace(/\./g, '') + '.' + brlMatch[2]!);
      if (amount > 0) fares.cash = { amount, currency: 'BRL' };
    } else {
      const brlSimple = b.priceText.match(/[\d.,]+/);
      if (brlSimple) {
        const amount = parseFloat(brlSimple[0]!.replace(/\./g, '').replace(',', '.'));
        if (amount > 0) fares.cash = { amount, currency: 'BRL' };
      }
    }

    // Points fare
    const pts = ptsMap.get(b.cardId);
    if (pts) {
      const ptsAmount = parseInt(pts.ptsText.replace(/\./g, '').replace(/\D/g, ''));
      if (ptsAmount > 0) fares.points = { amount: ptsAmount, currency: 'PTS' };

      // Hybrid: "ou 16.100 pontos + R$ 2.409,96"
      const hybMatch = pts.condText.match(/([\d.]+)\s*pontos?\s*\+\s*R\$\s*([\d.,]+)/i);
      if (hybMatch) {
        const hybPoints = parseInt(hybMatch[1]!.replace(/\./g, ''));
        const hybCash   = parseFloat(hybMatch[2]!.replace(/\./g, '').replace(',', '.'));
        if (hybPoints > 0 && hybCash > 0) {
          fares.hybrid = { points: hybPoints, cash: hybCash, currency: 'BRL' };
        }
      }
    }

    offers.push({
      date,
      flightNumber,
      origin:      { iata: b.depIata || origin,      timestamp: toTimestamp(date, b.depTime, b.depIata || origin) },
      destination: { iata: b.arrIata || destination, timestamp: toTimestamp(date, b.arrTime, b.arrIata || destination) },
      durationMin,
      stops,
      fares,
      isReturn: false,
    });
  }

  return offers;
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

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
