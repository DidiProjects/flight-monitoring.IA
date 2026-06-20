import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const schema = z.object({
  PORT:               z.coerce.number().default(3000),
  SCRAPER_API_KEY:    z.string().min(1),
  FLIGHT_API_URL:     z.string().url(),
  FLIGHT_API_KEY:     z.string().min(1),
  QUEUE_CONCURRENCY:  z.coerce.number().default(2),
  RESULTS_DIR:        z.string().default('./scraping-result'),
  LOG_LEVEL:          z.string().default('info'),
  LOG_PRETTY:         z.string().default('false'),
  NODE_ENV:           z.string().default('development'),
  LATAM_CPF:          z.string().optional(),
  LATAM_PASSWORD:     z.string().optional(),
  // Tempo real (WS worker → hub)
  REALTIME_ENABLED:   z.string().default('true'),
  WORKER_ID:          z.string().default('scraper-1'),
  FLIGHT_API_WS_URL:  z.string().url().optional(),
});

export const env = schema.parse(process.env);
