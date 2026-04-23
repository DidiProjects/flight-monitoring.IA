import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const schema = z.object({
  PORT:               z.coerce.number().default(3000),
  SCRAPER_API_KEY:    z.string().min(1),
  FLIGHT_API_URL:     z.string().url(),
  FLIGHT_API_KEY:     z.string().min(1),
  QUEUE_CONCURRENCY:  z.coerce.number().default(2),
  LOGS_DIR:           z.string().default('./logs'),
  LOG_LEVEL:          z.string().default('info'),
  LOG_PRETTY:         z.string().default('false'),
  NODE_ENV:           z.string().default('development'),
});

export const env = schema.parse(process.env);
