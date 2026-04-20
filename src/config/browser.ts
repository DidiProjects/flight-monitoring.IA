import type { BrowserContextOptions, LaunchOptions } from 'rebrowser-playwright';

export const launchOptions: LaunchOptions = {
  headless: false,
  channel: 'chrome',   // Real Chrome — TLS/JA3 fingerprint idêntico ao de um usuário comum
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-blink-features=AutomationControlled',
    '--lang=pt-BR',
    '--window-size=1920,1080',
  ],
};

export const contextOptions: BrowserContextOptions = {
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1920, height: 1080 },
  // User agent é definido automaticamente pelo Chrome instalado
  extraHTTPHeaders: {
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  },
};

/** Resource types to abort — speeds up the scraper significantly */
export const BLOCKED_RESOURCES = new Set([
  'image',
  'media',
  'font',
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
