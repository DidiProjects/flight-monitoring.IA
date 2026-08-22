/**
 * Real-time protocol contract for the flight-monitoring ecosystem.
 *
 * SINGLE SOURCE OF TRUTH — copy/sync across the three projects:
 *   • scraping.API  (worker)  → produces telemetry, consumes commands
 *   • flight.API    (hub)     → consumes telemetry, produces commands, SSE fan-out
 *   • flight.FRONT  (admin)   → consumes SSE events
 *
 * Matching spec: features.md §§13–19.
 * Transports: WebSocket (worker ↔ hub) · SSE + REST (hub ↔ front).
 */

/** Protocol version. Bump on a breaking change. */
export const PROTOCOL_VERSION = 1 as const;

// ───────────────────────────────────────────────────────────────────────────
// Domain enums
// ───────────────────────────────────────────────────────────────────────────

/** Current or terminal state of a RUN (analysis_run). */
export type RunStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'dead'
  | 'blocked'
  | 'cancelled';

/** Job lifecycle phase inside the worker — the granularity cancellation acts on. */
export type JobPhase = 'queued' | 'running' | 'finishing';

/** Steps reported in job.progress. */
export type ScrapeStep =
  | 'navigate'
  | 'fill_form'
  | 'search'
  | 'parse'
  | 'calendar'
  | 'cooldown';

/** Error category. Mirrors categorizeError in the scraping.API runner. */
export type ErrorType =
  | 'bot_detection'
  | 'timeout'
  | 'navigation'
  | 'unsupported_airline'
  | 'unknown';

export type LogLevel = 'info' | 'warn' | 'error';

/** Outcome carried by the ack of a cancel command. */
export type CancelResult =
  | 'aborted'        // a running job was interrupted
  | 'queued_removed' // job was only queued and got discarded before running
  | 'not_found';     // unknown requestId (already finished — a race) → no-op

// ───────────────────────────────────────────────────────────────────────────
// Shared envelope (every message, WS and SSE)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Generic envelope. `T` is the `type` literal, `P` the payload.
 * - `id`: message id, correlating a command with its ack.
 * - `requestId`: target job. Absent on connection messages such as hello/ping.
 * - `seq`: monotonic sequence PER job, for ordering and idempotent dedup.
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
  version: string;       // scraping.API version
  /** Prefer x-api-key on the handshake; this field is the fallback. */
  apiKey?: string;
}

export interface HelloAckPayload {
  heartbeatMs: number;   // ping interval the hub will use
  serverTime: string;    // ISO — clock alignment baseline
}

/** Minimum job state, used by snapshot reconciliation. */
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
  phase?: JobPhase; // useful on cancellation (e.g. 'queued')
}

export interface CancelPayload {
  /** Who asked for it — audited into analysis_runs.cancelled_by. */
  requestedBy?: string;
}

export interface CancelAckPayload {
  correlationId: string; // = id do comando cancel
  result: CancelResult;
}

export type EmptyPayload = Record<string, never>;

// ───────────────────────────────────────────────────────────────────────────
// WebSocket: Worker → Hub (telemetry + acks)
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
// WebSocket: Hub → Worker (control)
// ───────────────────────────────────────────────────────────────────────────

export type HelloAck = Envelope<'hello.ack', HelloAckPayload>;
export type Cancel   = Envelope<'cancel', CancelPayload>;   // requestId is required in practice
export type Ping     = Envelope<'ping', EmptyPayload>;

export type HubToWorkerMessage = HelloAck | Cancel | Ping;

// ───────────────────────────────────────────────────────────────────────────
// SSE: Hub → Front (consolidated state for the Admin UI)
// ───────────────────────────────────────────────────────────────────────────

/** Consolidated view of a job for the Admin table. */
export interface JobView {
  requestId: string;
  jobId?: string;        // scraping_jobs.id (may be null after cleanup)
  airline: string;
  origin: string;
  destination: string;
  flightDate: string;    // YYYY-MM-DD
  status: RunStatus;
  phase?: JobPhase;
  runningSince?: string; // ISO — hub is authoritative; the front derives duration (§18.2)
  faresFound?: number;
  lastStep?: ScrapeStep;
  error?: string;
  workerId?: string;
}

/** Timeline row projected for the UI, derived from job.progress/log/finished. */
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
// REST: front actions (non-streaming)
// ───────────────────────────────────────────────────────────────────────────

/** POST /flight/scraping-jobs/:requestId/cancel — body is optional. */
export interface CancelJobRequest {
  reason?: string;
}

/** Cancel response. The real confirmation arrives later via SSE job.upsert. */
export interface CancelJobResponse {
  accepted: boolean;
  /** 'dispatched' = sent to the worker; 'queued' = worker offline, intent persisted. */
  delivery: 'dispatched' | 'queued';
}

// ───────────────────────────────────────────────────────────────────────────
// Type guards
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
