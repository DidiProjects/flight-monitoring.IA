import { env } from '../../config/env.ts';
import { post } from '../../http/client.ts';
import { logger } from '../../utils/logger.ts';
import type { CoveragePayload } from '../../types/index.ts';

export async function sendCoverage(payload: CoveragePayload): Promise<void> {
  try {
    await post(`${env.FLIGHT_API_URL}/flight/scrape/coverage`, payload, env.FLIGHT_API_KEY);
    logger.info(
      { airline: payload.airline, airportCount: payload.airports.length },
      'Coverage sent to flight.API',
    );
  } catch (err) {
    logger.warn(
      { airline: payload.airline, err },
      'Failed to send coverage to flight.API (best-effort, ignored)',
    );
  }
}
