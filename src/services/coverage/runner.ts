import { logger } from '../../utils/logger.ts';
import { sendCoverage } from './sender.ts';
import { createCoverageRun, saveCoverageResults } from '../../utils/coverage-runs.ts';
import type { AirportCoverageItem } from '../../types/index.ts';

const RYANAIR_COVERAGE_URL = 'https://www.ryanair.com/api/views/locate/5/airports/pt/active';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRyanairAirport(raw: any): AirportCoverageItem {
  return {
    code:        raw.code,
    name:        raw.name,
    timezone:    raw.timeZone,
    countryCode: raw.country?.code ?? '',
    countryName: raw.country?.name ?? '',
    city:        raw.city?.name ?? '',
    region:      raw.region?.name ?? '',
    currency:    raw.country?.currency ?? undefined,
  };
}

async function runRyanairCoverage(): Promise<void> {
  const ctx = await createCoverageRun('ryanair');

  try {
    ctx.log('Fetching airports from Ryanair API...');

    const response = await fetch(RYANAIR_COVERAGE_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Ryanair coverage API returned ${response.status}`);
    }

    const json = await response.json();

    if (!Array.isArray(json) || json.length === 0) {
      throw new Error('Ryanair coverage API returned empty or invalid data');
    }

    const airports: AirportCoverageItem[] = json.map(mapRyanairAirport);

    ctx.log(`Fetched ${airports.length} airports`);
    await saveCoverageResults(ctx, airports);

    logger.info({ airportCount: airports.length }, 'Ryanair coverage fetched, sending to flight.API');
    await sendCoverage({ airline: 'ryanair', airports });
  } catch (err) {
    await ctx.saveError(err);
    throw err;
  }
}

const BA_COVERAGE_URL = 'https://www.britishairways.com/nx/b/bff/marketing-web-homepage/v0/locations/all?language=en&market=gb';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBAirport(raw: any): AirportCoverageItem {
  return {
    code:        raw.airport?.code ?? raw.city?.code,
    name:        raw.airport?.name,
    city:        raw.city?.name,
    countryCode: raw.country?.code?.toLowerCase(),
  };
}

async function runBritishAirwaysCoverage(): Promise<void> {
  const ctx = await createCoverageRun('britishairways');

  try {
    ctx.log('Fetching airports from British Airways API...');

    const response = await fetch(BA_COVERAGE_URL, {
      headers: {
        'Accept':                 'application/json, text/plain, */*',
        'Content-Type':           'application/json',
        'User-Agent':             'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
        'Referer':                'https://www.britishairways.com/',
        'Origin':                 'https://www.britishairways.com',
        'sec-fetch-dest':         'empty',
        'sec-fetch-mode':         'cors',
        'sec-fetch-site':         'same-origin',
        'x-ba-application-name': 'web-homepage',
        'x-ba-client-name':      'web-homepage',
        'x-ba-channel':          'WEB',
        'x-ba-market':           'gb',
        'x-ba-language':         'en',
        'x-ba-action-name':      'not-defined',
        'x-amzn-waf-ba-rule':    'EMPTY',
        'x-ba-track-id':         crypto.randomUUID(),
        'x-ba-request-id':       crypto.randomUUID(),
        'x-ba-user-anon-id':     crypto.randomUUID(),
        'x-ba-device-id':        crypto.randomUUID(),
        'x-ba-interaction-id':   crypto.randomUUID(),
      },
    });

    if (!response.ok) {
      throw new Error(`British Airways coverage API returned ${response.status}`);
    }

    const json = await response.json();
    const locations = json?.data?.locations;

    if (!Array.isArray(locations) || locations.length === 0) {
      throw new Error('British Airways coverage API returned empty or invalid data');
    }

    const airports: AirportCoverageItem[] = locations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((loc: any) => loc.locationType === 'airport')
      .map(mapBAirport)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((a: any) => !!a.code);

    ctx.log(`Fetched ${airports.length} airports`);
    await saveCoverageResults(ctx, airports);

    logger.info({ airportCount: airports.length }, 'British Airways coverage fetched, sending to flight.API');
    await sendCoverage({ airline: 'britishairways', airports });
  } catch (err) {
    await ctx.saveError(err);
    throw err;
  }
}

export async function runCoverageJob(airline: string): Promise<void> {
  try {
    if (airline === 'ryanair') {
      await runRyanairCoverage();
    } else if (airline === 'britishairways') {
      await runBritishAirwaysCoverage();
    } else {
      throw new Error(`Coverage automática não suportada para airline: ${airline}`);
    }
  } catch (err) {
    logger.error({ airline, err }, 'Coverage job failed');
  }
}
