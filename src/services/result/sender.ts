import { env } from '../../config/env.ts';
import { post } from '../../http/client.ts';
import { logger } from '../../utils/logger.ts';
import type { ScrapeResult } from '../../types/scrape.ts';

export async function sendResult(result: ScrapeResult): Promise<void> {
  await post(`${env.FLIGHT_API_URL}/scrape/results`, result, env.FLIGHT_API_KEY);
  logger.info({ requestId: result.requestId }, 'Result sent to flight.API');
}
