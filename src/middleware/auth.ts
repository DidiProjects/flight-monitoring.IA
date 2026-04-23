import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.ts';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = request.headers['x-api-key'];
  if (key !== env.SCRAPER_API_KEY) {
    await reply.status(401).send({ error: 'Unauthorized' });
  }
}
