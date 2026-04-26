import type { FastifyInstance } from 'fastify';
import { queue } from '../queue/index.ts';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    queue: {
      size: queue.size,
      pending: queue.pending,
    },
  }));
}
