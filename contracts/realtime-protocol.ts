/**
 * Contrato do protocolo de tempo real do ecossistema flight-monitoring.
 *
 * FONTE ÚNICA DA VERDADE — copiar/sincronizar nos três projetos:
 *   • scraping.API  (worker)  → produz telemetria, consome comandos
 *   • flight.API    (hub)     → consome telemetria, produz comandos, faz fan-out SSE
 *   • flight.FRONT  (admin)   → consome eventos SSE
 *
 * Spec correspondente: features.md §§13–19.
 * Transportes: WebSocket (worker ↔ hub) · SSE + REST (hub ↔ front).
 */

/** Versão do protocolo. Incrementar em mudança incompatível. */
export const PROTOCOL_VERSION = 1 as const;

// ───────────────────────────────────────────────────────────────────────────
// Enums de domínio
// ───────────────────────────────────────────────────────────────────────────

/** Estado terminal/atual de uma EXECUÇÃO (analysis_run). */
export type RunStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'dead'
  | 'blocked'
  | 'cancelled';

/** Fase de vida do job dentro do worker (granularidade de cancelamento). */
export type JobPhase = 'queued' | 'running' | 'finishing';

/** Etapas reportadas em job.progress (marcos do scraper). */
export type ScrapeStep =
  | 'navigate'
  | 'fill_form'
  | 'search'
  | 'parse'
  | 'calendar'
  | 'cooldown';

/** Categoria de erro (espelha categorizeError do runner do scraping.API). */
export type ErrorType =
  | 'bot_detection'
  | 'timeout'
  | 'navigation'
  | 'unsupported_airline'
  | 'unknown';

export type LogLevel = 'info' | 'warn' | 'error';

/** Resultado do ack de um comando cancel. */
export type CancelResult =
  | 'aborted'        // job em execução foi interrompido
  | 'queued_removed' // job estava só na fila e foi descartado antes de rodar
  | 'not_found';     // requestId desconhecido (já finalizou — corrida) → no-op

// ───────────────────────────────────────────────────────────────────────────
// Envelope comum (todas as mensagens, WS e SSE)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Envelope genérico. `T` é o literal de `type`, `P` o payload.
 * - `id`: id da mensagem (correlação de comando/ack).
 * - `requestId`: job alvo (ausente em mensagens de conexão como hello/ping).
 * - `seq`: sequência monotônica POR job (ordenação/dedup idempotente).
 */
export interface Envelope<T extends string, P> {
  v: typeof PROTOCOL_VERSION;
  type: T;
  id: string;
  ts: string; // ISO-8601
  requestId?: string;
  seq?: number;
  payload: P;
}

// ───────────────────────────────────────────────────────────────────────────
// Payloads
// ───────────────────────────────────────────────────────────────────────────

export interface WorkerHelloPayload {
  workerId: string;
  version: string;       // versão do scraping.API
  /** Preferir auth via header x-api-key no handshake; campo opcional p/ fallback. */
  apiKey?: string;
}

export interface HelloAckPayload {
  heartbeatMs: number;   // intervalo de ping que o hub usará
  serverTime: string;    // ISO — base p/ alinhar relógios
}

/** Estado mínimo de um job, usado na reconciliação por snapshot. */
export interface JobStateSnapshot {
  requestId: string;
  phase: JobPhase;
  startedAt: string; // ISO
}

export interface WorkerSnapshotPayload {
  jobs: JobStateSnapshot[];
}

export interface WorkerHeartbeatPayload {
  activeJobs: string[]; // requestIds
  queueDepth: number;
}

export interface JobQueuedPayload {
  position: number;
}

export interface JobStartedPayload {
  airline: string;
  origin: string;
  destination: string;
  flightDate: string; // YYYY-MM-DD
  startedAt: string;  // ISO
}

export interface JobProgressPayload {
  step: ScrapeStep;
  detail?: string;
  faresSoFar?: number;
}

export interface JobLogPayload {
  level: LogLevel;
  msg: string;
}

export interface JobFinishedPayload {
  status: Exclude<RunStatus, 'running'>;
  faresFound?: number;
  durationMs: number;
  error?: string;
  errorType?: ErrorType;
  phase?: JobPhase; // útil em cancelamento (ex.: 'queued')
}

export interface CancelPayload {
  /** Quem solicitou (auditoria → analysis_runs.cancelled_by). */
  requestedBy?: string;
}

export interface CancelAckPayload {
  correlationId: string; // = id do comando cancel
  result: CancelResult;
}

export type EmptyPayload = Record<string, never>;

// ───────────────────────────────────────────────────────────────────────────
// WebSocket: Worker → Hub (telemetria + acks)
// ───────────────────────────────────────────────────────────────────────────

export type WorkerHello     = Envelope<'worker.hello', WorkerHelloPayload>;
export type WorkerSnapshot  = Envelope<'worker.snapshot', WorkerSnapshotPayload>;
export type WorkerHeartbeat = Envelope<'worker.heartbeat', WorkerHeartbeatPayload>;
export type JobQueued       = Envelope<'job.queued', JobQueuedPayload>;
export type JobStarted      = Envelope<'job.started', JobStartedPayload>;
export type JobProgress     = Envelope<'job.progress', JobProgressPayload>;
export type JobLog          = Envelope<'job.log', JobLogPayload>;
export type JobFinished     = Envelope<'job.finished', JobFinishedPayload>;
export type CancelAck       = Envelope<'cancel.ack', CancelAckPayload>;
export type Pong            = Envelope<'pong', EmptyPayload>;

export type WorkerToHubMessage =
  | WorkerHello
  | WorkerSnapshot
  | WorkerHeartbeat
  | JobQueued
  | JobStarted
  | JobProgress
  | JobLog
  | JobFinished
  | CancelAck
  | Pong;

// ───────────────────────────────────────────────────────────────────────────
// WebSocket: Hub → Worker (controle)
// ───────────────────────────────────────────────────────────────────────────

export type HelloAck = Envelope<'hello.ack', HelloAckPayload>;
export type Cancel   = Envelope<'cancel', CancelPayload>;   // requestId obrigatório em uso
export type Ping     = Envelope<'ping', EmptyPayload>;

export type HubToWorkerMessage = HelloAck | Cancel | Ping;

// ───────────────────────────────────────────────────────────────────────────
// SSE: Hub → Front (estado consolidado p/ a UI Admin)
// ───────────────────────────────────────────────────────────────────────────

/** Visão consolidada de um job para a tabela do Admin. */
export interface JobView {
  requestId: string;
  jobId?: string;        // scraping_jobs.id (pode ser null após cleanup)
  airline: string;
  origin: string;
  destination: string;
  flightDate: string;    // YYYY-MM-DD
  status: RunStatus;
  phase?: JobPhase;
  runningSince?: string; // ISO — autoritativo do hub (calcular duração no front, §18.2)
  faresFound?: number;
  lastStep?: ScrapeStep;
  error?: string;
  workerId?: string;
}

/** Linha de timeline/log projetada para a UI (deriva de job.progress/log/finished). */
export interface JobEventLine {
  requestId: string;
  seq: number;
  ts: string;
  type: 'queued' | 'started' | 'progress' | 'log' | 'finished';
  level?: LogLevel;
  detail?: string;
}

export interface AirlinePausedPayload {
  airline: string;
  until: string;  // ISO
  reason: string;
}

export type SseJobSnapshot = Envelope<'job.snapshot', { jobs: JobView[] }>;
export type SseJobUpsert   = Envelope<'job.upsert', JobView>;
export type SseJobEvent    = Envelope<'job.event', JobEventLine>;
export type SseJobRemoved  = Envelope<'job.removed', { requestId: string }>;
export type SseAirlinePaused = Envelope<'airline.paused', AirlinePausedPayload>;

export type HubToFrontEvent =
  | SseJobSnapshot
  | SseJobUpsert
  | SseJobEvent
  | SseJobRemoved
  | SseAirlinePaused;

// ───────────────────────────────────────────────────────────────────────────
// REST: ações do front (não-streaming)
// ───────────────────────────────────────────────────────────────────────────

/** POST /flight/scraping-jobs/:requestId/cancel — corpo opcional. */
export interface CancelJobRequest {
  reason?: string;
}

/** Resposta do cancel (a confirmação real chega depois via SSE job.upsert). */
export interface CancelJobResponse {
  accepted: boolean;
  /** 'dispatched' = comando enviado ao worker; 'queued' = worker offline, intenção persistida. */
  delivery: 'dispatched' | 'queued';
}

// ───────────────────────────────────────────────────────────────────────────
// Type guards utilitários
// ───────────────────────────────────────────────────────────────────────────

export function isWorkerMessage(msg: { type: string }): msg is WorkerToHubMessage {
  return (
    msg.type === 'worker.hello' ||
    msg.type === 'worker.snapshot' ||
    msg.type === 'worker.heartbeat' ||
    msg.type.startsWith('job.') ||
    msg.type === 'cancel.ack' ||
    msg.type === 'pong'
  );
}

export function isCancelCommand(msg: HubToWorkerMessage): msg is Cancel {
  return msg.type === 'cancel';
}
