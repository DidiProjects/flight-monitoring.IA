import type { BrowserContextOptions } from 'playwright';

export const contextOptions: BrowserContextOptions = {
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1920, height: 1080 },
  extraHTTPHeaders: {
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  },
};

/** Resource types to abort, speeds up the scraper significantly */
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
