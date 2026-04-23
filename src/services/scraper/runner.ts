import { searchFlights } from '../../scrapers/azul.ts';
import { sendResult } from '../result/sender.ts';
import { createRun, saveResults, pruneOldRuns } from '../../utils/runs.ts';
import { logger } from '../../utils/logger.ts';
import type { ScrapeRequest } from '../../types/scrape.ts';

export async function runScrapeJob(request: ScrapeRequest): Promise<void> {
  const run = await createRun(request.origin, request.destination);
  logger.info({ requestId: request.requestId, runDir: run.dir }, 'Scrape job started');

  try {
    const flights = await searchFlights({
      origin: request.origin,
      destination: request.destination,
      outboundStart: request.outboundStart,
      outboundEnd: request.outboundEnd,
      returnStart: request.returnStart,
      returnEnd: request.returnEnd,
      passengers: request.passengers,
      runDir: run.dir,
    });

    await saveResults(run, flights);
    await sendResult({
      requestId: request.requestId,
      origin: request.origin,
      destination: request.destination,
      flights,
      scrapedAt: new Date().toISOString(),
    });
  } catch (err) {
    await run.saveError(err);
    logger.error({ requestId: request.requestId, err }, 'Scrape job failed');
    await sendResult({
      requestId: request.requestId,
      origin: request.origin,
      destination: request.destination,
      flights: [],
      scrapedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await pruneOldRuns();
  }
}
