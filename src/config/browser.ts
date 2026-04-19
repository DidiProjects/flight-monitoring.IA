import type { BrowserContextOptions, LaunchOptions } from 'playwright';

export const launchOptions: LaunchOptions = {
  headless: true,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=pt-BR',
  ],
};

export const contextOptions: BrowserContextOptions = {
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  extraHTTPHeaders: {
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  },
  // Block resource types that are irrelevant to data extraction
  // (handled via page.route in the scraper)
};

/** Resource types to abort — speeds up the scraper significantly */
export const BLOCKED_RESOURCES = new Set([
  'image',
  'media',
  'font',
  'stylesheet',
]);

/** URL patterns whose responses we want to capture as flight data */
export const FLIGHT_API_PATTERNS: RegExp[] = [
  /airSearch/i,
  /availability/i,
  /lowfare/i,
  /shopping/i,
  /GetShopping/i,
  /flights\/search/i,
  /passagens/i,
];
