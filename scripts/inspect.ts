import { chromium } from 'playwright';
import { launchOptions, contextOptions } from '../src/config/browser.ts';

const browser = await chromium.launch({ ...launchOptions, headless: false });
const context = await browser.newContext(contextOptions);
const page = await context.newPage();

console.log('Navigating to Azul home…');
await page.goto('https://www.voeazul.com.br/br/pt/home', { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(4_000);
await page.screenshot({ path: 'debug-home.png', fullPage: false });
console.log('Screenshot saved → debug-home.png');

const elements = await page.evaluate(() => {
  const sel = 'input, select, textarea, button, [role="combobox"], [role="listbox"], [role="option"]';
  const result: Record<string, string | undefined>[] = [];
  for (const el of document.querySelectorAll(sel)) {
    const e = el as HTMLElement;
    const rec: Record<string, string | undefined> = {
      tag: e.tagName.toLowerCase(),
      type: (e as HTMLInputElement).type || undefined,
      role: e.getAttribute('role') ?? undefined,
      id: e.id || undefined,
      name: e.getAttribute('name') ?? undefined,
      placeholder: e.getAttribute('placeholder') ?? undefined,
      ariaLabel: e.getAttribute('aria-label') ?? undefined,
      dataTestId: e.getAttribute('data-testid') ?? undefined,
      class: e.className?.toString().slice(0, 100) || undefined,
      innerText: e.innerText?.slice(0, 60).replace(/\n/g, ' ') || undefined,
    };
    // Only include elements with at least some identifying info
    if (rec.id || rec.name || rec.placeholder || rec.ariaLabel || rec.dataTestId || rec.role) {
      result.push(rec);
    }
  }
  return result;
});

console.log(JSON.stringify(elements, null, 2));
await page.waitForTimeout(2_000);
await browser.close();
