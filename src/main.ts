import { buildServer } from './server.ts';
import { env } from './config/env.ts';
import { logger } from './utils/logger.ts';

const app = buildServer();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'scraping.API started');
} catch (err) {
  logger.error(err, 'Failed to start server');
  process.exit(1);
}
