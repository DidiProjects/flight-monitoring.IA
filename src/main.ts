import { buildServer } from './server.ts';
import { env } from './config/env.ts';
import { logger } from './utils/logger.ts';
import { startHubClient, stopHubClient } from './realtime/hubClient.ts';

const app = buildServer();

(async () => {
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, 'scraping.API started');
    startHubClient();
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
})();

const shutdown = (sig: string) => {
  logger.info({ sig }, 'scraping.API encerrando');
  stopHubClient();
  app.close().finally(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
