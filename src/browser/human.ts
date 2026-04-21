import type { Page } from 'playwright';

/** Delay aleatório entre min e max ms, simula comportamento humano */
export const humanDelay = (min = 300, max = 900): Promise<void> =>
  new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

/**
 * Digita texto com velocidade humana (~60–120 wpm).
 * Usa pressSequentially com delay variável em vez de fill() instantâneo.
 */
export async function humanType(
  page: Page,
  locator: ReturnType<Page['locator']>,
  text: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
  await locator.click({ timeout: 15_000 });
  await locator.clear().catch(() => {});
  await humanDelay(200, 400);
  await locator.pressSequentially(text, { delay: 80 + Math.random() * 80 });
}
