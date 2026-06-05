import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.ts';
import { queue } from '../queue/index.ts';
import { runCoverageJob } from '../services/coverage/runner.ts';

const SUPPORTED_AIRLINES = new Set(['ryanair', 'britishairways']);

const CoverageRequestSchema = z.object({
  airline: z.string().min(1),
});

export async function coverageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/coverage', { preHandler: authMiddleware }, async (request, reply) => {
    const result = CoverageRequestSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request', details: result.error.flatten() });
    }

    const { airline } = result.data;

    if (!SUPPORTED_AIRLINES.has(airline)) {
      return reply.status(422).send({ error: 'Coverage automática não suportada para esta companhia' });
    }

    const position = queue.size + queue.pending;
    queue.add(() => runCoverageJob(airline));

    return reply.status(202).send({ airline, position });
  });
}
