/**
 * Protocolo de tempo real (worker ↔ hub). Cópia sincronizada do contrato
 * canônico em flight-monitoring.IA/contracts/realtime-protocol.ts (§14).
 */
export const PROTOCOL_VERSION = 1 as const;

export type RunStatus = 'running' | 'success' | 'failed' | 'dead' | 'blocked' | 'cancelled';
export type JobPhase = 'queued' | 'running' | 'finishing';
export type ScrapeStep = 'navigate' | 'fill_form' | 'search' | 'parse' | 'calendar' | 'cooldown';
export type LogLevel = 'info' | 'warn' | 'error';
export type CancelResult = 'aborted' | 'queued_removed' | 'not_found';

export interface Envelope<T extends string, P> {
  v: typeof PROTOCOL_VERSION;
  type: T;
  id: string;
  ts: string;
  requestId?: string;
  seq?: number;
  payload: P;
}

// Worker → Hub
export type WorkerToHubType =
  | 'worker.hello' | 'worker.snapshot' | 'worker.heartbeat'
  | 'job.queued' | 'job.started' | 'job.progress' | 'job.log' | 'job.finished'
  | 'cancel.ack' | 'pong';

// Hub → Worker
export type HubToWorkerType = 'hello.ack' | 'cancel' | 'ping';

export interface JobStateSnapshot {
  requestId: string;
  phase: JobPhase;
  airline: string;
  origin: string;
  destination: string;
  flightDate: string;
  startedAt: string;
}

export interface AnyMessage {
  v: number;
  type: string;
  id: string;
  ts: string;
  requestId?: string;
  seq?: number;
  payload: Record<string, unknown>;
}

let counter = 0;
export function newId(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

export function envelope(type: string, payload: Record<string, unknown>, opts: { requestId?: string; seq?: number } = {}): AnyMessage {
  return { v: PROTOCOL_VERSION, type, id: newId(), ts: new Date().toISOString(), payload, ...opts };
}
