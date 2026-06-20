import { EventEmitter } from 'node:events';
import type { AnyMessage, JobPhase, RunStatus, ScrapeStep, LogLevel } from './protocol.ts';
import { envelope } from './protocol.ts';

/**
 * Barramento de telemetria do worker. O runner/registry emitem eventos por job;
 * o hubClient assina e encaminha pelo WS. Desacopla a lógica de scraping do
 * transporte — se o WS estiver caído, os eventos só não têm para onde ir (a
 * verdade dos resultados continua sendo o webhook HTTP, §14.3).
 */
export const telemetryBus = new EventEmitter();

// seq monotônico por requestId (ordenação/dedup no hub).
const seqByRequest = new Map<string, number>();
function nextSeq(requestId: string): number {
  const n = (seqByRequest.get(requestId) ?? -1) + 1;
  seqByRequest.set(requestId, n);
  return n;
}

function emit(type: string, requestId: string, payload: Record<string, unknown>): void {
  const msg = envelope(type, payload, { requestId, seq: nextSeq(requestId) });
  telemetryBus.emit('message', msg);
}

export function jobQueued(requestId: string, position: number): void {
  emit('job.queued', requestId, { position });
}

export function jobStarted(requestId: string, meta: { airline: string; origin: string; destination: string; flightDate: string }): void {
  emit('job.started', requestId, { ...meta, startedAt: new Date().toISOString() });
}

export function jobProgress(requestId: string, step: ScrapeStep, detail?: string, faresSoFar?: number): void {
  emit('job.progress', requestId, { step, detail, faresSoFar });
}

export function jobLog(requestId: string, level: LogLevel, msg: string): void {
  emit('job.log', requestId, { level, msg });
}

export function jobFinished(requestId: string, status: Exclude<RunStatus, 'running'>, extra: { faresFound?: number; durationMs: number; error?: string; phase?: JobPhase } = { durationMs: 0 }): void {
  emit('job.finished', requestId, { status, ...extra });
  seqByRequest.delete(requestId);
}

/** Mensagem pronta para o WS (já com envelope). */
export type TelemetryMessage = AnyMessage;
