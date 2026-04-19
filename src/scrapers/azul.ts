import { chromium } from 'rebrowser-playwright';
import type { Browser, Page, Response } from 'rebrowser-playwright';
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
    await page.goto(AZUL_HOME, { waitUntil: 'load', timeout: 60_000 });
    // Wait for React to finish rendering the search form (networkidle = no pending XHR)
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await humanDelay(1_500, 2_500);
    await checkForBlock(page);
    await acceptCookies(page);

    // Ensure OneTrust overlay is gone before interacting with the form
    await page.evaluate(() => {
      const el = document.querySelector('#onetrust-consent-sdk') as HTMLElement | null;
      if (el) el.style.display = 'none';
      const filter = document.querySelector('.onetrust-pc-dark-filter') as HTMLElement | null;
      if (filter) filter.style.display = 'none';
    }).catch(() => {});
    await page.waitForTimeout(800);
    await waitForSearchForm(page);

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
    const base = `${origin}-${destination}-${date}`;
    await page
      .screenshot({ path: path.join(errDir, `debug-${base}.png`), fullPage: true })
      .catch(() => {});
    await page.evaluate(() => document.documentElement.outerHTML)
      .then(html => fs.writeFile(path.join(errDir, `dom-${base}.html`), html))
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

// ── Wait for search form ──────────────────────────────────────────────────────

async function waitForSearchForm(page: Page): Promise<void> {
  // Wait for the Origem input to be attached to DOM (it may be opacity:0 — not "visible" per Playwright)
  try {
    await page
      .locator('input[aria-label*="Origem" i]')
      .first()
      .waitFor({ state: 'attached', timeout: 20_000 });
    logger.debug('Search form is attached to DOM');
  } catch {
    logger.warn('Search form attach timeout — proceeding anyway');
  }
}

// ── Native focus helper ───────────────────────────────────────────────────────

async function nativeFocusInput(page: Page, selector: string): Promise<void> {
  // Try using real mouse coordinates first (most reliable for opening dropdowns/calendars)
  const coords = await page.evaluate((sel) => {
    // Click the parent label/container that's visually shown (not the hidden input itself)
    const input = document.querySelector(sel) as HTMLElement | null;
    if (!input) return null;
    const container = input.closest('label') ?? input.parentElement ?? input;
    container.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = container.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, selector);

  if (coords && coords.y > 0 && coords.y < 1080) {
    await page.mouse.click(coords.x, coords.y);
  } else {
    // Fallback: synthetic DOM events if element is off-screen
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) return;
      el.focus();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, selector);
  }
  // Always explicitly focus the INPUT (not the container) to receive keyboard events
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (el) el.focus();
  }, selector);
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
  // Azul uses styled-components with opacity:0 floating labels. We use native
  // JS focus to interact with the input regardless of CSS visibility/position.
  await nativeFocusInput(page, 'input[aria-label*="Origem" i]');
  await humanDelay(300, 500);
  await page.keyboard.type(origin, { delay: 80 + Math.random() * 80 });
  await humanDelay(600, 1_200);
  // Use native events for autocomplete selection (bypasses any overlay)
  const originSelected = await page.evaluate((query) => {
    const options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, [class*="suggestion"] li, [class*="autocomplete"] li'));
    const opt = options.find(o => o.textContent?.includes(query)) as HTMLElement | null;
    if (opt) { opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); opt.click(); return true; }
    return false;
  }, origin);
  if (!originSelected) await page.keyboard.press('Enter');

  await humanDelay(600, 1_000);

  // ── Destination field ────────────────────────────────────────────────────
  await nativeFocusInput(page, 'input[aria-label*="Destino" i]');
  await humanDelay(300, 500);
  await page.keyboard.type(destination, { delay: 80 + Math.random() * 80 });
  await humanDelay(600, 1_200);
  const destSelected = await page.evaluate((query) => {
    const options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, [class*="suggestion"] li, [class*="autocomplete"] li'));
    const opt = options.find(o => o.textContent?.includes(query)) as HTMLElement | null;
    if (opt) { opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); opt.click(); return true; }
    return false;
  }, destination);
  if (!destSelected) await page.keyboard.press('Enter');

  await humanDelay(400, 800);

  // ── Date field ───────────────────────────────────────────────────────────
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  await openAndFillCalendar(page, year, month, day);

  // ── Passengers ───────────────────────────────────────────────────────────
  if (passengers > 1) {
    await setPassengers(page, passengers);
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  await page
    .locator('button[data-cy*="search" i], button[data-cy*="buscar" i]')
    .or(page.getByRole('button', { name: /^buscar$|^search$|^ver voos$/i }))
    .first()
    .click({ timeout: 10_000 });
}

async function openAndFillCalendar(page: Page, year: number, month: number, day: number): Promise<void> {
  const DATE_SELECTOR = 'input[aria-label*="Data de ida" i], input[aria-label*="Datas" i], input[aria-label*="date" i]';

  // ── Step 1: open the calendar picker ────────────────────────────────────────
  const calendarOpen = async (): Promise<boolean> => {
    return page.waitForFunction(
      () => {
        const btns = Array.from(document.querySelectorAll<HTMLElement>('button'));
        if (btns.some(b => /selecionar data|confirmar/i.test(b.textContent ?? ''))) return true;
        if (document.querySelector('[role="grid"],[role="dialog"],[class*="DayPicker"],[class*="datepick"],[class*="calendar" i]')) return true;
        return false;
      },
      { timeout: 5_000 },
    ).then(() => true).catch(() => false);
  };

  // Click the visible date container with real mouse coords
  const clickDateField = async (): Promise<void> => {
    const coords = await page.evaluate((sel) => {
      const input = document.querySelector<HTMLElement>(sel);
      if (!input) return null;
      // Walk up to find a reasonably-sized clickable ancestor
      let el: HTMLElement | null = input;
      for (let i = 0; i < 5; i++) {
        const r = el.getBoundingClientRect();
        if (r.width >= 40 && r.height >= 20) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        el = el.parentElement;
        if (!el) break;
      }
      // Absolute fallback: focus the input
      input.focus();
      return null;
    }, DATE_SELECTOR);

    if (coords) {
      await page.mouse.click(coords.x, coords.y);
    } else {
      await page.evaluate((sel) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) { el.focus(); el.click(); }
      }, DATE_SELECTOR);
    }
  };

  await clickDateField();
  await humanDelay(600, 900);

  let visible = await calendarOpen();

  if (!visible) {
    // Some Azul variants need a Space/Enter key press to open the picker
    await page.keyboard.press('Space');
    await humanDelay(400, 600);
    visible = await calendarOpen();
  }

  if (!visible) {
    // Look for a calendar-icon button adjacent to the input and click it
    const iconClicked = await page.evaluate((sel) => {
      const input = document.querySelector<HTMLElement>(sel);
      if (!input) return false;
      const parent = input.closest('[class]') ?? input.parentElement;
      if (!parent) return false;
      // Find sibling button with SVG (calendar icon)
      const iconBtn = parent.parentElement?.querySelector<HTMLElement>('button svg')?.closest('button');
      if (iconBtn) { (iconBtn as HTMLElement).click(); return true; }
      return false;
    }, DATE_SELECTOR);

    if (iconClicked) {
      await humanDelay(500, 800);
      visible = await calendarOpen();
    }
  }

  if (!visible) {
    // Last resort: type date in dd/mm/yyyy format directly into the input
    const formatted = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    logger.warn({ year, month, day, formatted }, 'Calendar did not open — typing date directly');
    await page.evaluate((sel) => {
      const el = document.querySelector<HTMLInputElement>(sel);
      if (el) { el.focus(); el.select(); }
    }, DATE_SELECTOR);
    await page.keyboard.type(formatted, { delay: 120 });
    await page.keyboard.press('Tab');
    return;
  }

  logger.debug({ year, month, day }, 'Calendar picker opened');

  // ── Step 2: navigate to the correct month ────────────────────────────────────
  const MONTHS_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const targetMonthPt = MONTHS_PT[month - 1]!;

  for (let attempt = 0; attempt < 14; attempt++) {
    const shownMonth = await page.evaluate((target) => {
      const all = Array.from(document.querySelectorAll('*'));
      return all.some(el => {
        const text = (el.children.length === 0 ? el.textContent ?? '' : '').toLowerCase();
        return text.includes(target.toLowerCase());
      });
    }, targetMonthPt);

    if (shownMonth) {
      // ── Step 3: click the day ──────────────────────────────────────────────
      const clicked = await page.evaluate((d) => {
        // Anchor search on "Selecionar data" button — walk up to find the calendar root
        const confirmBtn = Array.from(document.querySelectorAll<HTMLElement>('button'))
          .find(b => /selecionar data|confirmar/i.test(b.textContent ?? ''));
        let root: HTMLElement = confirmBtn ? confirmBtn : document.body;
        for (let i = 0; i < 8 && root.parentElement; i++) root = root.parentElement as HTMLElement;

        const dayBtns = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'));
        for (const btn of dayBtns) {
          // Match a button whose ONLY numeric text content equals the day number
          const text = btn.textContent?.trim() ?? '';
          if (text === String(d) || btn.querySelector('span')?.textContent?.trim() === String(d)) {
            btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            btn.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
            btn.click();
            return true;
          }
        }
        return false;
      }, day);

      if (clicked) {
        await page.waitForTimeout(400);
        // Confirm with "Selecionar data" button if present
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll<HTMLElement>('button'))
            .find(b => /selecionar data|confirmar/i.test(b.textContent ?? ''));
          if (btn) btn.click();
        });
        logger.debug({ year, month, day }, 'Calendar day selected');
        await humanDelay(300, 500);
        return;
      }
    }

    // Advance to next month
    const advanced = await page.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button'));
      const nextBtn = allBtns.find(b => {
        const label = b.getAttribute('aria-label') ?? '';
        const text = b.textContent?.trim() ?? '';
        return (
          (/next|próximo|avançar/i.test(label) || text === '>' || text === '›') &&
          !b.hasAttribute('disabled')
        ) || (
          b.querySelector('svg') !== null &&
          text === '' &&
          !b.hasAttribute('disabled') &&
          // Ensure it's not a day button
          !b.closest('[role="gridcell"]')
        );
      });
      if (nextBtn) { nextBtn.click(); return true; }
      // Fallback: last enabled SVG-only button (right-arrow)
      const svgBtns = allBtns.filter(b =>
        b.querySelector('svg') && b.textContent?.trim() === '' && !b.hasAttribute('disabled')
      );
      if (svgBtns.length > 0) { svgBtns[svgBtns.length - 1]!.click(); return true; }
      return false;
    });

    if (!advanced) {
      logger.warn({ year, month, day }, 'Cannot advance calendar month');
      break;
    }
    await page.waitForTimeout(600);
  }

  logger.warn({ year, month, day }, 'Calendar navigation failed — pressing Enter as fallback');
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
