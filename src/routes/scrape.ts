import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.ts';
import { queue } from '../queue/index.ts';
import { runScrapeJob } from '../services/scraper/runner.ts';

const ScrapeRequestSchema = z.object({
  requestId:     z.string().uuid(),
  routineId:     z.string().uuid(),
  origin:        z.string().length(3),
  destination:   z.string().length(3),
  outboundStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outboundEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnStart:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnEnd:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  passengers:    z.number().int().min(1).max(9),
});

export async function scrapeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/scrape', { preHandler: authMiddleware }, async (request, reply) => {
    const result = ScrapeRequestSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid request', details: result.error.flatten() });
    }

    const body = result.data;
    const position = queue.size + queue.pending;
    queue.add(() => runScrapeJob(body));

    return reply.status(202).send({ requestId: body.requestId, position });
  });
}
