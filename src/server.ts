import Fastify from 'fastify';
import { healthRoutes } from './routes/health.ts';
import { scrapeRoutes } from './routes/scrape.ts';
import { coverageRoutes } from './routes/coverage.ts';
import { logger } from './utils/logger.ts';

export function buildServer() {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _request, reply) => {
    logger.error(err, 'Unhandled error');
    reply.status(500).send({ error: 'Internal server error' });
  });

  app.register(healthRoutes);
  app.register(scrapeRoutes);
  app.register(coverageRoutes);

  return app;
}
