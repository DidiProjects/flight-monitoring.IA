import { searchFlights as azulSearch } from '../../scrapers/azul.ts';
import { searchFlights as latamSearch } from '../../scrapers/latam.ts';
import { searchFlights as baSearch } from '../../scrapers/britishairways.ts';
import { searchFlights as ryanairSearch } from '../../scrapers/ryanair.ts';
import { buildCallbackPayload, sendResult } from '../result/sender.ts';
import { createRun, saveResults, saveResponse, pruneOldRuns } from '../../utils/runs.ts';
import { logger } from '../../utils/logger.ts';
import { abortableSleep, isAbortError } from '../../utils/abortable.ts';
import { markRunning, markFinishing, unregisterJob } from '../../jobs/registry.ts';
import { jobStarted, jobProgress, jobFinished } from '../../realtime/telemetry.ts';
import type { ScrapeRequest, ScrapeResult } from '../../types/scrape.ts';
import type { FlightOffer } from '../../types/index.ts';

// Minimum gap between consecutive Azul jobs — Akamai WAF flags the IP
// when multiple automated sessions hit in quick succession from the same origin.
const AZUL_MIN_GAP_MS = 180_000;
let lastAzulRunAt = 0;

function categorizeError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('comportamento incomum') || msg.includes('acesso foi limitado') || msg.includes('bot') || msg.includes('block')) return 'bot_detection';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  if (msg.includes('navigation') || msg.includes('navigate')) return 'navigation';
  if (msg.includes('unsupported airline')) return 'unsupported_airline';
  return 'unknown';
}

export async function runScrapeJob(request: ScrapeRequest, signal?: AbortSignal): Promise<void> {
  const startTime = Date.now();
  const logCtx = { requestId: request.requestId, routineId: request.routineId, airline: request.airline, origin: request.origin, destination: request.destination };

  markRunning(request.requestId);
  jobStarted(request.requestId, { airline: request.airline, origin: request.origin, destination: request.destination, flightDate: request.outboundStart });
  const run = await createRun(request.requestId, request.routineId, request.origin, request.destination);
  logger.info({ ...logCtx, runDir: run.dir }, 'Scrape job started');

  const send = async (result: ScrapeResult) => {
    const payload = buildCallbackPayload(result);
    await saveResponse(run, payload);
    await sendResult(result);
  };

  let flights: FlightOffer[] = [];
  let scraperError: string | undefined;
  let cancelled = false;

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
      signal,
    };

    const airline = request.airline.toLowerCase();
    if (airline === 'azul') {
      const gap = Date.now() - lastAzulRunAt;
      if (lastAzulRunAt > 0 && gap < AZUL_MIN_GAP_MS) {
        const wait = AZUL_MIN_GAP_MS - gap;
        logger.info({ ...logCtx, waitMs: wait }, 'Azul cooldown: waiting between consecutive runs');
        jobProgress(request.requestId, 'cooldown', `aguardando ${Math.round(wait / 1000)}s (anti-bot)`);
        await abortableSleep(wait, signal);
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
    jobFinished(request.requestId, 'success', { faresFound: flights.length, durationMs: Date.now() - startTime });
  } catch (err) {
    // Cancelamento ≠ falha: não dispara retry e descarta resultado parcial (§15.5).
    if (signal?.aborted || isAbortError(err)) {
      cancelled = true;
      logger.info({ ...logCtx, duration_ms: Date.now() - startTime, status: 'cancelled' }, 'Scrape job cancelled');
      jobFinished(request.requestId, 'cancelled', { durationMs: Date.now() - startTime });
    } else {
      scraperError = err instanceof Error ? err.message : String(err);
      await run.saveError(err);
      logger.error({ ...logCtx, err, error_type: categorizeError(err), duration_ms: Date.now() - startTime, status: 'error' }, 'Scrape job failed');
      jobFinished(request.requestId, 'failed', { durationMs: Date.now() - startTime, error: scraperError });
    }
  }

  // Job cancelado não envia callback de resultado (não há tarifas; o estado
  // 'cancelled' já foi propagado via WS acima). Só limpa e sai.
  if (cancelled) {
    unregisterJob(request.requestId);
    await pruneOldRuns().catch(() => {});
    return;
  }

  markFinishing(request.requestId);
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
    unregisterJob(request.requestId);
    await pruneOldRuns().catch(() => {});
  }
}
