import { logger } from '../utils/logger.ts';

/**
 * Registry de jobs ativos — base do cancelamento real (features.md §15).
 *
 * Cada job em voo (na fila ou executando) tem um AbortController. Cancelar =
 * abortar o controller: na fila, a PQueue rejeita antes de rodar; em execução,
 * o scraper fecha o browser (via params.signal) e desenrola limpo.
 */

export type JobPhase = 'queued' | 'running' | 'finishing';

export type CancelResult = 'aborted' | 'queued_removed' | 'not_found';

export interface JobHandle {
  requestId: string;
  routineId: string;
  airline: string;
  origin: string;
  destination: string;
  flightDate: string;
  controller: AbortController;
  phase: JobPhase;
  enqueuedAt: number;   // epoch ms
  startedAt?: number;   // epoch ms (início da execução)
}

export interface JobStateSnapshot {
  requestId: string;
  phase: JobPhase;
  airline: string;
  origin: string;
  destination: string;
  flightDate: string;
  startedAt: string;    // ISO (enqueuedAt ou startedAt)
}

const jobs = new Map<string, JobHandle>();

export interface RegisterInput {
  requestId: string;
  routineId: string;
  airline: string;
  origin: string;
  destination: string;
  flightDate: string;
}

export function registerJob(input: RegisterInput): JobHandle {
  const handle: JobHandle = {
    ...input,
    controller: new AbortController(),
    phase: 'queued',
    enqueuedAt: Date.now(),
  };
  jobs.set(input.requestId, handle);
  return handle;
}

export function markRunning(requestId: string): void {
  const h = jobs.get(requestId);
  if (h) {
    h.phase = 'running';
    h.startedAt = Date.now();
  }
}

export function markFinishing(requestId: string): void {
  const h = jobs.get(requestId);
  if (h) h.phase = 'finishing';
}

export function unregisterJob(requestId: string): void {
  jobs.delete(requestId);
}

export function getJob(requestId: string): JobHandle | undefined {
  return jobs.get(requestId);
}

/**
 * Cancela um job. Idempotente: abortar duas vezes é no-op.
 * Retorna o que aconteceu para o ack ao hub (Stage 3).
 */
export function cancelJob(requestId: string): CancelResult {
  const h = jobs.get(requestId);
  if (!h) return 'not_found';

  const wasQueued = h.phase === 'queued';
  if (!h.controller.signal.aborted) {
    h.controller.abort();
    logger.info({ requestId, phase: h.phase }, 'Job cancellation requested');
  }
  return wasQueued ? 'queued_removed' : 'aborted';
}

/** Snapshot dos jobs ativos — usado na reconciliação do WS (Stage 3). */
export function snapshot(): JobStateSnapshot[] {
  return [...jobs.values()].map((h) => ({
    requestId: h.requestId,
    phase: h.phase,
    airline: h.airline,
    origin: h.origin,
    destination: h.destination,
    flightDate: h.flightDate,
    startedAt: new Date(h.startedAt ?? h.enqueuedAt).toISOString(),
  }));
}

export function activeCount(): number {
  return jobs.size;
}
