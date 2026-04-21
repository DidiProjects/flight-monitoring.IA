import type { Page } from 'playwright';
import { logger } from '../utils/logger.ts';

export async function acceptCookies(page: Page): Promise<boolean> {
  // ── Step 1: Wait for OneTrust accept button (most common on Azul) ──────────
  // The banner may be lazy-loaded up to 8s after page load.
  try {
    const otBtn = page.locator('#onetrust-accept-btn-handler');
    await otBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await otBtn.click({ timeout: 5_000 });
    // Wait for the banner to disappear so it doesn't intercept subsequent clicks
    await page.locator('#onetrust-banner-sdk').waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {});
    await page.waitForTimeout(500);
    logger.debug('Cookie banner dismissed via OneTrust accept button');
    return true;
  } catch {
    // OneTrust not found — try text-based fallbacks
  }

  // ── Step 2: Text-based fallback strategies ────────────────────────────────
  const textStrategies = [
    'Aceitar todos os cookies',
    'Aceitar todas as cookies',
    'Aceitar todos',
    'Aceitar todas',
    'Aceitar tudo',
    'Accept all cookies',
    'Accept all',
    'Aceitar',
    'Accept',
    'Concordo',
    'OK',
  ];

  for (const text of textStrategies) {
    try {
      const btn = page.locator(`button:text-is("${text}")`).first();
      const visible = await btn.isVisible({ timeout: 1_500 });
      if (!visible) continue;
      await btn.click({ timeout: 5_000 });
      await page.waitForTimeout(800);
      logger.debug({ text }, 'Cookie banner dismissed via text match');
      return true;
    } catch {
      continue;
    }
  }

  // ── Step 3: CookieBot ─────────────────────────────────────────────────────
  try {
    const cb = page.locator('#CybotCookiebotDialogBodyButtonAccept');
    if (await cb.isVisible({ timeout: 1_000 })) {
      await cb.click({ timeout: 5_000 });
      return true;
    }
  } catch { /* ignore */ }

  return false;
}
