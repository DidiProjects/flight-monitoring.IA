import { env } from '../../config/env.ts';
import { post } from '../../http/client.ts';
import { logger } from '../../utils/logger.ts';
import type { ScrapeResult } from '../../types/scrape.ts';
import type { FlightOffer } from '../../types/index.ts';

function toCallbackOffer(offer: FlightOffer, airline: string) {
  return {
    airline,
    flightNumber:  offer.flightNumber,
    date:          offer.date,
    isReturn:      offer.isReturn,
    origin:        offer.origin.iata,
    departureTime: offer.origin.timestamp.slice(11, 16),
    destination:   offer.destination.iata,
    arrivalTime:   offer.destination.timestamp.slice(11, 16),
    durationMin:   offer.durationMin,
    stops:         offer.stops,
    currency:      offer.fares.cash?.currency ?? offer.fares.points?.currency ?? offer.fares.hybrid?.currency,
    fareCash:      offer.fares.cash?.amount,
    farePts:       offer.fares.points?.amount,
    fareHybPts:    offer.fares.hybrid?.points,
    fareHybCash:   offer.fares.hybrid?.cash,
  };
}

export function buildCallbackPayload(result: ScrapeResult) {
  return {
    requestId:   result.requestId,
    routineId:   result.routineId,
    airline:     result.airline,
    origin:      result.origin,
    destination: result.destination,
    flights:     result.flights.map((o) => toCallbackOffer(o, result.airline)),
    scrapedAt:   result.scrapedAt,
    error:       result.error,
  };
}

export async function sendResult(result: ScrapeResult): Promise<void> {
  const payload = buildCallbackPayload(result);
  await post(`${env.FLIGHT_API_URL}/scrape/results`, payload, env.FLIGHT_API_KEY);
  logger.info({
    requestId:     result.requestId,
    routineId:     result.routineId,
    airline:       result.airline,
    origin:        result.origin,
    destination:   result.destination,
    results_count: result.flights.length,
    has_error:     !!result.error,
    status:        result.error ? 'error' : 'success',
  }, 'Result sent to flight.API');
}
