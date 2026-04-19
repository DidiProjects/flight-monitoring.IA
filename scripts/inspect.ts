/**
 * Abre o site da Azul com Chrome + stealth, aguarda carregar,
 * salva screenshot e dump dos elementos de formulário em /data/results/inspect/
 *
 * Uso no servidor:
 *   docker compose run --rm flight-tracker npx tsx scripts/inspect.ts
 */
import 'dotenv/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchOptions, contextOptions } from '../src/config/browser.ts';

chromium.use(StealthPlugin());

const OUT = process.env['RESULTS_DIR']
  ? path.join(process.env['RESULTS_DIR'], 'inspect')
  : './results/inspect';

await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ ...launchOptions, headless: true });
const context = await browser.newContext(contextOptions);
const page    = await context.newPage();

console.log('Navegando para voeazul.com.br…');
await page.goto('https://www.voeazul.com.br/br/pt/home', {
  waitUntil: 'networkidle',
  timeout: 60_000,
});

await page.waitForTimeout(3_000);
await page.screenshot({ path: path.join(OUT, 'home.png'), fullPage: false });
console.log(`Screenshot salvo → ${OUT}/home.png`);

const elements = await page.evaluate(() => {
  const result: Record<string, string | undefined>[] = [];
  for (const el of document.querySelectorAll(
    'input, select, textarea, button[type="submit"], [role="combobox"], [role="listbox"], [role="option"]',
  )) {
    const e = el as HTMLElement;
    const rec: Record<string, string | undefined> = {
      tag:         e.tagName.toLowerCase(),
      type:        (e as HTMLInputElement).type || undefined,
      role:        e.getAttribute('role') ?? undefined,
      id:          e.id || undefined,
      name:        e.getAttribute('name') ?? undefined,
      placeholder: e.getAttribute('placeholder') ?? undefined,
      ariaLabel:   e.getAttribute('aria-label') ?? undefined,
      dataTestId:  e.getAttribute('data-testid') ?? undefined,
      class:       e.className?.toString().slice(0, 120) || undefined,
    };
    if (Object.values(rec).filter(Boolean).length > 1) result.push(rec);
  }
  return result;
});

const dumpPath = path.join(OUT, 'elements.json');
await fs.writeFile(dumpPath, JSON.stringify(elements, null, 2));
console.log(`DOM dump salvo → ${dumpPath}`);
console.log(`\n${elements.length} elementos encontrados:`);
console.log(JSON.stringify(elements, null, 2));

await browser.close();
