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

export async function runScrapeJob(request: ScrapeRequest): Promise<void> {
  const run = await createRun(request.requestId, request.routineId, request.origin, request.destination);
  logger.info({ requestId: request.requestId, routineId: request.routineId, runDir: run.dir }, 'Scrape job started');

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
    };

    const airline = request.airline.toLowerCase();
    if (airline === 'azul') {
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
  } catch (err) {
    scraperError = err instanceof Error ? err.message : String(err);
    await run.saveError(err);
    logger.error({ requestId: request.requestId, routineId: request.routineId, err }, 'Scrape job failed');
  }

  try {
    await send({
      requestId:   request.requestId,
      routineId:   request.routineId,
      origin:      request.origin,
      destination: request.destination,
      flights,
      scrapedAt:   new Date().toISOString(),
      error:       scraperError,
    });
  } catch (sendErr) {
    logger.warn({ requestId: request.requestId, err: sendErr instanceof Error ? { message: sendErr.message, code: (sendErr as NodeJS.ErrnoException).code } : sendErr }, 'Failed to deliver callback to flight.API');
  } finally {
    await pruneOldRuns();
  }
}
