import { firefox } from 'playwright';
import type { Browser, Page } from 'playwright';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { contextOptions, BLOCKED_RESOURCES } from '../config/browser.ts';
import { dateRange } from '../utils/dates.ts';
import { logger } from '../utils/logger.ts';
import { humanDelay } from '../browser/human.ts';
import { toTimestamp } from '../utils/airports.ts';
import type { FlightOffer, FlightFares, ScraperParams } from '../types/index.ts';

type LogCtx = { requestId?: string; routineId?: string; airline?: string };

const SEARCH_URL = 'https://www.latamairlines.com/br/pt/oferta-voos';

function buildSearchUrl(
  origin: string,
  destination: string,
  date: string,
  redemption: boolean,
  passengers: number,
): string {
  const outbound = encodeURIComponent(`${date}T00:00:00.000Z`);
  return `${SEARCH_URL}?origin=${origin}&outbound=${outbound}&destination=${destination}&inbound=null&adt=${passengers}&chd=0&inf=0&trip=OW&cabin=Economy&redemption=${redemption}&sort=RECOMMENDED`;
}

// "1 h 10 min." → 70
function parseDurationMin(text: string): number {
  const h = text.match(/(\d+)\s*h/)?.[1];
  const m = text.match(/(\d+)\s*min/)?.[1];
  return (h ? parseInt(h) * 60 : 0) + (m ? parseInt(m) : 0);
}

// "brl 538,54" or "brl 3.833,64" → 538.54
function parseBRL(text: string): number | null {
  const raw = text.toLowerCase().replace(/\s/g, '');
  const m = raw.match(/brl([\d.]+),([\d]{2})/);
  if (!m) return null;
  return parseFloat(m[1]!.replace(/\./g, '') + '.' + m[2]!);
}

// "15.778 milhas" → 15778
function parseMiles(text: string): number | null {
  const m = text.match(/([\d.]+)\s*milhas/i);
  if (!m) return null;
  return parseInt(m[1]!.replace(/\./g, ''));
}

// "Direto" → 0, "1 parada" → 1
function parseStops(text: string): number {
  if (/direto/i.test(text)) return 0;
  const m = text.match(/(\d+)\s*parada/i);
  return m ? parseInt(m[1]!) : 0;
}

// ── Main entry ─────────────────────────────────────────────────────────────────

export async function searchFlights(params: ScraperParams, cpf?: string, password?: string): Promise<FlightOffer[]> {
  const foxOptions = await camoufoxLaunchOptions({
    headless: true,
    os: 'windows',
    locale: 'pt-BR',
    humanize: true,
  });
  const browser = await firefox.launch(foxOptions);
  const allOffers: FlightOffer[] = [];

  try {
    // BRL outbound
    const brlOut = await searchDateRange(browser, params.origin, params.destination,
      params.outboundStart, params.outboundEnd ?? params.outboundStart,
      false, false, params);
    allOffers.push(...brlOut);

    // BRL return
    if (params.returnStart) {
      const brlRet = await searchDateRange(browser, params.destination, params.origin,
        params.returnStart, params.returnEnd ?? params.returnStart,
        false, true, params);
      allOffers.push(...brlRet);
    }

    // Points (only if credentials provided)
    if (cpf && password) {
      const ptsOut = await searchDateRange(browser, params.origin, params.destination,
        params.outboundStart, params.outboundEnd ?? params.outboundStart,
        true, false, params, cpf, password);
      mergePoints(allOffers, ptsOut);

      if (params.returnStart) {
        const ptsRet = await searchDateRange(browser, params.destination, params.origin,
          params.returnStart, params.returnEnd ?? params.returnStart,
          true, true, params, cpf, password);
        mergePoints(allOffers, ptsRet);
      }
    }
  } finally {
    await browser.close();
  }

  return allOffers;
}

// ── Date range loop ────────────────────────────────────────────────────────────

async function searchDateRange(
  browser: Browser,
  origin: string,
  destination: string,
  startDate: string,
  endDate: string,
  redemption: boolean,
  isReturn: boolean,
  params: ScraperParams,
  cpf?: string,
  password?: string,
): Promise<FlightOffer[]> {
  const logCtx: LogCtx = { requestId: params.requestId, routineId: params.routineId, airline: params.airline };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  await page.route('**/*', route => {
    if (BLOCKED_RESOURCES.has(route.request().resourceType())) return route.abort();
    return route.continue();
  });

  const allOffers: FlightOffer[] = [];
  let cookiesAccepted = false;
  let loggedIn = false;

  try {
    for (const date of dateRange(startDate, endDate)) {
      const url = buildSearchUrl(origin, destination, date, redemption, params.passengers);
      logger.info({ origin, destination, date, redemption }, 'Navigating to LATAM search');

      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await humanDelay(1_000, 2_000);

      if (!cookiesAccepted) {
        cookiesAccepted = await acceptCookies(page);
      }
      await dismissCountrySuggestion(page);

      // Login once for points searches
      if (redemption && !loggedIn && cpf && password) {
        loggedIn = await latamLogin(page, cpf, password, logCtx);
        if (!loggedIn) {
          logger.warn({ ...logCtx }, 'LATAM login failed, skipping points search for remaining dates');
          break;
        }
        // Re-navigate to search URL after login
        await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await humanDelay(1_000, 2_000);
      }

      const hasCards = await waitForCards(page, logCtx);
      await saveSnapshot(page, params.runDir, `latam-${origin}-${destination}-${date}-${redemption ? 'pts' : 'cash'}`);

      if (!hasCards) {
        logger.info({ date, origin, destination }, 'No LATAM flights for this date');
        continue;
      }

      const offers = await extractCards(page, origin, destination, date, redemption, params.runDir);
      offers.forEach(o => { o.isReturn = isReturn; });

      logger.info({ date, origin, destination, count: offers.length }, 'LATAM date collected');

      if (params.runDir) {
        const dateDir = path.join(params.runDir, date);
        await fs.mkdir(dateDir, { recursive: true });
        await fs.writeFile(
          path.join(dateDir, `latam-${origin}-${destination}${redemption ? '-pts' : ''}.json`),
          JSON.stringify(offers, null, 2),
        );
      }

      allOffers.push(...offers);
    }
  } catch (err) {
    const errDir = params.runDir ? path.join(params.runDir, 'errors') : process.cwd();
    await fs.mkdir(errDir, { recursive: true }).catch(() => {});
    const base = `latam-${origin}-${destination}`;
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

// ── Cookie acceptance ──────────────────────────────────────────────────────────

async function acceptCookies(page: Page): Promise<boolean> {
  try {
    const btn = page.locator('[data-testid="cookies-politics-button--button"]');
    if ((await btn.count().catch(() => 0)) > 0) {
      await btn.click({ timeout: 5_000 });
      await humanDelay(500, 1_000);
      logger.debug('LATAM cookies accepted');
    }
    return true;
  } catch {
    return true;
  }
}

// ── Country suggestion modal ───────────────────────────────────────────────────

async function dismissCountrySuggestion(page: Page): Promise<void> {
  try {
    const btn = page.locator('[data-testid="country-suggestion-reject-change--button"]');
    if ((await btn.count().catch(() => 0)) > 0) {
      await btn.click({ timeout: 3_000 });
      await humanDelay(300, 600);
      logger.debug('LATAM country suggestion dismissed');
    }
  } catch {
    // Modal not present or already dismissed
  }
}

// ── Login ──────────────────────────────────────────────────────────────────────

async function latamLogin(page: Page, cpf: string, password: string, logCtx: LogCtx = {}): Promise<boolean> {
  try {
    const cpfInput = page.locator('[data-testid="form-input--alias-textfield-input"]');
    await cpfInput.waitFor({ state: 'visible', timeout: 15_000 });

    await cpfInput.click();
    await humanDelay(300, 600);
    await page.keyboard.type(cpf, { delay: 80 + Math.random() * 50 });
    await humanDelay(500, 1_000);

    await page.locator('[data-testid="primary-button-button"]').first().click({ timeout: 5_000 });
    await humanDelay(1_000, 2_000);

    const pwdInput = page.locator('[data-testid="form-input--password-textfield-input"]');
    await pwdInput.waitFor({ state: 'visible', timeout: 10_000 });
    await pwdInput.click();
    await humanDelay(300, 600);
    await page.keyboard.type(password, { delay: 80 + Math.random() * 50 });
    await humanDelay(500, 1_000);

    await page.locator('[data-testid="primary-button-button"]').first().click({ timeout: 5_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await humanDelay(1_500, 2_500);

    // Wait up to 30s for either search results or the 2FA modal
    let outcome: 'cards' | '2fa' | 'timeout' = 'timeout';
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const hasCards = await page.locator('[data-testid="wrapper-card-header-0"]').count().then(c => c > 0).catch(() => false);
      if (hasCards) { outcome = 'cards'; break; }
      const has2fa = await page.locator('[data-testid="radio-group-channels-radio-group"]').count().then(c => c > 0).catch(() => false);
      if (has2fa) { outcome = '2fa'; break; }
      await page.waitForTimeout(500);
    }

    if (outcome === 'cards') {
      logger.info('LATAM login successful');
      return true;
    }

    if (outcome === 'timeout') {
      logger.warn({ ...logCtx }, 'LATAM login: no cards or 2FA detected within 15s');
      return false;
    }

    // ── 2FA handling ──────────────────────────────────────────────────────────────
    logger.info('LATAM 2FA modal detected, selecting email verification');

    await page.locator('[data-testid="radio-EMAIL-radio"]').click({ timeout: 5_000 });
    await humanDelay(500, 800);
    await page.locator('[data-testid="form-button--primaryAction-button"]').click({ timeout: 5_000 });
    await humanDelay(1_000, 2_000);

    await page.locator('[data-testid="form-input--code-0-textfield-input"]').waitFor({ state: 'visible', timeout: 10_000 });
    logger.info('LATAM 2FA: code input ready — polling authorization-code.json');

    let code: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.waitForTimeout(20_000);
      try {
        const raw = await fs.readFile(path.join(process.cwd(), 'authorization-code.json'), 'utf-8');
        const parsed = JSON.parse(raw) as { code?: unknown };
        const candidate = String(parsed.code ?? '').replace(/\D/g, '');
        if (candidate.length === 6) { code = candidate; break; }
      } catch {
        logger.debug({ attempt: attempt + 1 }, 'LATAM 2FA: authorization-code.json not ready');
      }
    }

    if (!code) {
      logger.warn({ ...logCtx }, 'LATAM 2FA: code not obtained after 5 attempts, skipping points');
      return false;
    }

    logger.info('LATAM 2FA: code obtained, filling inputs');
    await page.locator('[data-testid="form-input--code-0-textfield-input"]').click();
    await page.keyboard.type(code, { delay: 100 + Math.random() * 50 });
    await humanDelay(500, 800);

    await page.locator('[data-testid="form-button--primaryAction-button"]').click({ timeout: 5_000 });

    const cardsAfter2fa = await page.locator('[data-testid="wrapper-card-header-0"]')
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true).catch(() => false);

    if (cardsAfter2fa) {
      logger.info('LATAM 2FA login successful');
      return true;
    }

    logger.warn({ ...logCtx }, 'LATAM 2FA: cards did not appear after code submission');
    return false;
  } catch (err) {
    logger.warn({ ...logCtx, err: String(err).slice(0, 120) }, 'LATAM login error');
    return false;
  }
}

// ── Wait for cards ─────────────────────────────────────────────────────────────

async function waitForCards(page: Page, logCtx: LogCtx = {}): Promise<boolean> {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const hasCard = await page.locator('[data-testid="wrapper-card-header-0"]')
      .count().then(c => c > 0).catch(() => false);
    if (hasCard) return true;

    const noFlights = await page.evaluate(() =>
      /não encontramos voos|não há voos disponíveis|nenhum resultado/i.test(document.body.innerText),
    ).catch(() => false);
    if (noFlights) return false;

    await page.waitForTimeout(500);
  }

  logger.warn({ ...logCtx }, 'waitForCards timed out');
  return false;
}

// ── Card extraction ────────────────────────────────────────────────────────────

type RawCard = {
  depTime: string;
  depIata: string;
  arrTime: string;
  arrIata: string;
  durationText: string;
  stopsText: string;
  priceText: string;
  flightNumber: string;
};

async function extractCards(
  page: Page,
  origin: string,
  destination: string,
  date: string,
  redemption: boolean,
  runDir?: string,
): Promise<FlightOffer[]> {
  const rawCards: RawCard[] = await page.evaluate((redemptionMode) => {
    const cards: RawCard[] = [];
    let i = 0;

    while (true) {
      if (!document.querySelector(`[data-testid="wrapper-card-header-${i}"]`)) break;

      // Origin: first span = departure time, second = IATA
      const originDiv = document.querySelector(`[data-testid="flight-info-${i}-origin"]`);
      const originSpans = originDiv ? Array.from(originDiv.querySelectorAll(':scope > span')) : [];
      const depTime = originSpans[0]?.textContent?.trim() ?? '';
      const depIata = originSpans[1]?.textContent?.trim() ?? '';

      // Duration: second span inside duration div ("1 h 10 min.")
      const durationDiv = document.querySelector(`[data-testid="flight-info-${i}-duration"]`);
      const durationSpans = durationDiv ? Array.from(durationDiv.querySelectorAll('span')) : [];
      const durationText = (durationSpans[1] ?? durationSpans[0])?.textContent?.trim() ?? '';

      // Destination: first text node of first span (ignores nested "+1 day" span), second span = IATA
      const destDiv = document.querySelector(`[data-testid="flight-info-${i}-destination"]`);
      const destSpans = destDiv ? Array.from(destDiv.querySelectorAll(':scope > span')) : [];
      const arrTime = Array.from(destSpans[0]?.childNodes ?? [])
        .filter(n => n.nodeType === 3)
        .map(n => (n as Text).data.trim())
        .join('')
        .trim();
      const arrIata = destSpans[1]?.textContent?.trim() ?? '';

      // Stops: from footer card anchor text
      const footerCard = document.querySelector(`[data-testid="footer-card-${i}"]`);
      const stopsAnchor = document.querySelector(`[data-testid="itinerary-modal-${i}-details-anchor--link"]`);
      const stopsText = stopsAnchor?.querySelector('span')?.textContent?.trim() ?? '';

      // Price
      let priceText = '';
      if (redemptionMode && footerCard) {
        const loyaltyWrapper = footerCard.querySelector('[data-testid="loyalty-points-wrapper"]');
        if (loyaltyWrapper) {
          const displayAmount = loyaltyWrapper.querySelector('.displayAmount span, .displayAmount');
          priceText = displayAmount?.textContent?.trim() ?? loyaltyWrapper.textContent?.trim() ?? '';
        }
      } else {
        const amountDiv = document.querySelector(`[data-testid="flight-info-${i}-amount"]`);
        if (amountDiv) {
          const currencySpan = amountDiv.querySelector('[aria-hidden="true"]');
          priceText = currencySpan?.textContent?.trim() ?? '';
        }
      }

      cards.push({ depTime, depIata, arrTime, arrIata, durationText, stopsText, priceText, flightNumber: '' });
      i++;
    }

    return cards;
  }, redemption);

  // Click each card's itinerary anchor using native DOM click (bypasses Playwright actionability)
  for (let i = 0; i < rawCards.length; i++) {
    const flightNumber = await page.evaluate(async (cardIndex) => {
      // Wait for any previous modal to fully close
      await new Promise<void>((resolve) => {
        const existingTitle = document.querySelector('[data-testid="incoming-outcoming-title"]');
        if (!existingTitle || existingTitle.getBoundingClientRect().height === 0) { resolve(); return; }
        const interval = setInterval(() => {
          const el = document.querySelector('[data-testid="incoming-outcoming-title"]');
          if (!el || el.getBoundingClientRect().height === 0) { clearInterval(interval); clearTimeout(bail); resolve(); }
        }, 100);
        const bail = setTimeout(() => { clearInterval(interval); resolve(); }, 3_000);
      });

      const anchor = document.querySelector(`[data-testid="itinerary-modal-${cardIndex}-details-anchor--link"]`);
      if (!anchor) return '__NO_ANCHOR__';
      (anchor as HTMLElement).click();

      // Wait for modal + airline-wrapper to appear
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          const el = document.querySelector('[data-testid="incoming-outcoming-title"]');
          if (el && el.getBoundingClientRect().height > 0 && el.querySelector('[data-testid="airline-wrapper"]')) {
            clearInterval(interval); clearTimeout(bail); resolve();
          }
        }, 100);
        const bail = setTimeout(() => { clearInterval(interval); resolve(); }, 8_000);
      });

      // Extra wait for React to finish hydrating the correct content
      await new Promise(r => setTimeout(r, 3_000));

      // Read first incoming-outcoming-title (for connections, the first segment is what we want)
      const el = document.querySelector('[data-testid="incoming-outcoming-title"]');
      if (!el) return '__NO_TITLE__';
      const wrapper = el.querySelector('[data-testid="airline-wrapper"]');
      if (!wrapper) return '__NO_WRAPPER__';
      const text = Array.from(wrapper.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => (n as Text).data.trim())
        .find(t => t.length > 0) ?? '';

      // Close modal
      const closeBtn =
        document.querySelector(`[data-testid="itinerary-modal-${cardIndex}--dialog-close-button"]`) ??
        document.querySelector('[data-testid*="--dialog-close-button"]');
      if (closeBtn) (closeBtn as HTMLElement).click();

      return text || '__NO_TEXT__';
    }, i).catch(() => '__EVAL_ERROR__');

    logger.debug({ i, flightNumber }, 'LATAM modal: flight number');
    rawCards[i]!.flightNumber = flightNumber.startsWith('__') ? '' : flightNumber;

    // Debug: save modal DOM state right after close for first card
    if (i === 0 && runDir) {
      const snapDir = path.join(runDir, 'snapshots');
      await fs.mkdir(snapDir, { recursive: true }).catch(() => {});
      const modalHtml = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
      await fs.writeFile(path.join(snapDir, `modal-card-0.html`), modalHtml).catch(() => {});
    }

    await humanDelay(300, 500);
  }

  const offers: FlightOffer[] = [];

  for (const card of rawCards) {
    if (!card.depTime || !card.arrTime) continue;

    const durationMin = parseDurationMin(card.durationText);
    const stops      = parseStops(card.stopsText);

    const flightNumber = card.flightNumber;

    const fares: FlightFares = {};

    if (redemption) {
      const pts = parseMiles(card.priceText);
      if (pts !== null && pts > 0) fares.points = { amount: pts, currency: 'PTS' };
    } else {
      const cash = parseBRL(card.priceText);
      if (cash !== null && cash > 0) fares.cash = { amount: cash, currency: 'BRL' };
    }

    if (Object.keys(fares).length === 0) continue;

    offers.push({
      date,
      flightNumber,
      origin:      { iata: card.depIata || origin,      timestamp: toTimestamp(date, card.depTime, card.depIata || origin) },
      destination: { iata: card.arrIata || destination, timestamp: toTimestamp(date, card.arrTime, card.arrIata || destination) },
      durationMin,
      stops,
      fares,
      isReturn: false,
    });
  }

  return offers;
}

// ── Merge points into BRL offers ───────────────────────────────────────────────

function mergePoints(brlOffers: FlightOffer[], ptsOffers: FlightOffer[]): void {
  for (const pts of ptsOffers) {
    const depTime = pts.origin.timestamp.slice(11, 16);
    const match = brlOffers.find(o =>
      o.date === pts.date &&
      o.isReturn === pts.isReturn &&
      o.origin.iata === pts.origin.iata &&
      o.destination.iata === pts.destination.iata &&
      o.origin.timestamp.slice(11, 16) === depTime &&
      (!o.flightNumber || !pts.flightNumber || o.flightNumber === pts.flightNumber),
    );
    if (match) {
      match.fares.points = pts.fares.points;
    } else {
      brlOffers.push(pts);
    }
  }
}

// ── Snapshots ──────────────────────────────────────────────────────────────────

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
