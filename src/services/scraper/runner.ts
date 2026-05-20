import { searchFlights as azulSearch } from '../../scrapers/azul.ts';
import { searchFlights as latamSearch } from '../../scrapers/latam.ts';
import { searchFlights as baSearch } from '../../scrapers/britishairways.ts';
import { searchFlights as ryanairSearch } from '../../scrapers/ryanair.ts';
import { buildCallbackPayload, sendResult } from '../result/sender.ts';
import { createRun, saveResults, saveResponse, pruneOldRuns } from '../../utils/runs.ts';
import { logger } from '../../utils/logger.ts';
import { env } from '../../config/env.ts';
import type { ScrapeRequest, ScrapeResult } from '../../types/scrape.ts';
import type { FlightOffer } from '../../types/index.ts';

// Minimum gap between consecutive Azul jobs — Akamai WAF flags the IP
// when multiple automated sessions hit in quick succession from the same origin.
const AZUL_MIN_GAP_MS = 180_000;
let lastAzulRunAt = 0;

function categorizeError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('comportamento incomum') || msg.includes('acesso foi limitado') || msg.includes('bot')) return 'bot_detection';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('navigation') || msg.includes('navigate')) return 'navigation';
  if (msg.includes('unsupported airline')) return 'unsupported_airline';
  return 'unknown';
}

export async function runScrapeJob(request: ScrapeRequest): Promise<void> {
  const startTime = Date.now();
  const logCtx = { requestId: request.requestId, routineId: request.routineId, airline: request.airline, origin: request.origin, destination: request.destination };

  const run = await createRun(request.requestId, request.routineId, request.origin, request.destination);
  logger.info({ ...logCtx, runDir: run.dir }, 'Scrape job started');

  const send = async (result: ScrapeResult) => {
    const payload = buildCallbackPayload(result);
    await saveResponse(run, payload);
    await sendResult(result);
  };

  let flights: FlightOffer[] = [];
  let scraperError: string | undefined;

  try {
    const scraperParams = {
      origin:        request.origin,
      destination:   request.destination,
      outboundStart: request.outboundStart,
      outboundEnd:   request.outboundEnd,
      returnStart:   request.returnStart,
      returnEnd:     request.returnEnd,
      passengers:    request.passengers,
      runDir:        run.dir,
      requestId:     request.requestId,
      routineId:     request.routineId,
      airline:       request.airline,
    };

    const airline = request.airline.toLowerCase();
    if (airline === 'azul') {
      const gap = Date.now() - lastAzulRunAt;
      if (lastAzulRunAt > 0 && gap < AZUL_MIN_GAP_MS) {
        const wait = AZUL_MIN_GAP_MS - gap;
        logger.info({ ...logCtx, waitMs: wait }, 'Azul cooldown: waiting between consecutive runs');
        await new Promise(r => setTimeout(r, wait));
      }
      lastAzulRunAt = Date.now();
      flights = await azulSearch(scraperParams);
    } else if (airline === 'latam') {
      flights = await latamSearch(scraperParams);
    } else if (airline === 'britishairways') {
      flights = await baSearch(scraperParams);
    } else if (airline === 'ryanair') {
      flights = await ryanairSearch(scraperParams);
    } else {
      throw new Error(`Unsupported airline: ${request.airline}`);
    }

    await saveResults(run, flights);
    logger.info({ ...logCtx, results_count: flights.length, duration_ms: Date.now() - startTime, status: 'success' }, 'Scrape job completed');
  } catch (err) {
    scraperError = err instanceof Error ? err.message : String(err);
    await run.saveError(err);
    logger.error({ ...logCtx, err, error_type: categorizeError(err), duration_ms: Date.now() - startTime, status: 'error' }, 'Scrape job failed');
  }

  try {
    await send({
      requestId:   request.requestId,
      routineId:   request.routineId,
      airline:     request.airline,
      origin:      request.origin,
      destination: request.destination,
      flights,
      scrapedAt:   new Date().toISOString(),
      error:       scraperError,
    });
  } catch (sendErr) {
    logger.warn({ ...logCtx, err: sendErr instanceof Error ? { message: sendErr.message, code: (sendErr as NodeJS.ErrnoException).code } : sendErr, status: 'error' }, 'Failed to deliver callback to flight.API');
  } finally {
    await pruneOldRuns();
  }
}
