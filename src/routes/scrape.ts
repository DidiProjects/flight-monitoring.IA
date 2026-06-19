import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.ts';
import { queue } from '../queue/index.ts';
import { runScrapeJob } from '../services/scraper/runner.ts';
import { registerJob, unregisterJob, cancelJob } from '../jobs/registry.ts';
import { isAbortError } from '../utils/abortable.ts';
import { logger } from '../utils/logger.ts';

const ScrapeRequestSchema = z.object({
  requestId:     z.string().uuid(),
  routineId:     z.string().uuid(),
  airline:       z.string().min(1),
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

    // Registra o job e enfileira com o signal: se cancelado enquanto na fila,
    // a PQueue rejeita antes de rodar (cancelamento "de graça"); se já rodando,
    // o signal fecha o browser via params.signal (§15).
    const handle = registerJob({
      requestId:   body.requestId,
      routineId:   body.routineId,
      airline:     body.airline,
      origin:      body.origin,
      destination: body.destination,
      flightDate:  body.outboundStart,
    });

    queue
      .add(({ signal }) => runScrapeJob(body, signal), { signal: handle.controller.signal })
      .catch((err) => {
        // Abort enquanto na fila: runScrapeJob nunca rodou → só limpa o registry.
        if (isAbortError(err)) {
          logger.info({ requestId: body.requestId }, 'Queued job cancelled before start');
        } else {
          logger.error({ err, requestId: body.requestId }, 'Queue task rejected');
        }
        unregisterJob(body.requestId);
      });

    return reply.status(202).send({ requestId: body.requestId, position });
  });

  // Cancelamento de um job específico. Reusado pelo canal WS (Stage 3); aqui
  // exposto via HTTP (x-api-key) para teste e como fallback de controle.
  app.post('/scrape/:requestId/cancel', { preHandler: authMiddleware }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string };
    const result = cancelJob(requestId);
    const status = result === 'not_found' ? 404 : 200;
    return reply.status(status).send({ requestId, result });
  });
}
