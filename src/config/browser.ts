import type { BrowserContextOptions } from 'playwright';

export const contextOptions: BrowserContextOptions = {
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1920, height: 1080 },
  extraHTTPHeaders: {
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  },
};

/** Resource types to abort.
 *  Blocking images/fonts is a detectable bot signal — Akamai inspects which
 *  resource types are requested. Only block media (video/audio) which is never
 *  relevant to flight search and has no fingerprinting role. */
export const BLOCKED_RESOURCES = new Set([
  'media',
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
