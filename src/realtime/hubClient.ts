import { env } from '../config/env.ts';
import { logger } from '../utils/logger.ts';
import { cancelJob, snapshot } from '../jobs/registry.ts';
import { telemetryBus } from './telemetry.ts';
import { envelope, type AnyMessage } from './protocol.ts';

/**
 * Cliente WS do worker → hub (flight.API). Dial-out: o worker disca para o hub
 * (NAT-friendly). Reconexão com backoff+jitter, heartbeat de aplicação, e
 * reconciliação por snapshot ao (re)conectar (features.md §13, §17).
 *
 * Auth: o WebSocket nativo do Node não envia headers customizados, então a
 * chave vai por query param e é validada no upgrade pelo hub.
 */

const HEARTBEAT_MS = 15_000;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

let ws: WebSocket | null = null;
let attempt = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

function wsUrl(): string {
  const base = env.FLIGHT_API_WS_URL ?? env.FLIGHT_API_URL.replace(/^http/, 'ws').replace(/\/+$/, '') + '/realtime/worker';
  const u = new URL(base);
  u.searchParams.set('key', env.FLIGHT_API_KEY);
  u.searchParams.set('workerId', env.WORKER_ID);
  return u.toString();
}

function send(msg: AnyMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); } catch { /* best-effort */ }
  }
}

// Listener único: encaminha telemetria quando há conexão aberta; senão descarta
// (best-effort — o snapshot na reconexão restabelece o estado).
telemetryBus.on('message', (msg: AnyMessage) => send(msg));

function backoffDelay(): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  const jitter = exp * 0.2 * (Math.random() * 2 - 1); // ±20%
  return Math.max(BASE_DELAY_MS, Math.round(exp + jitter));
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const delay = backoffDelay();
  attempt++;
  logger.warn({ delay, attempt }, 'Hub WS: agendando reconexão');
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send(envelope('worker.heartbeat', { activeJobs: snapshot().map((s) => s.requestId), queueDepth: snapshot().length }));
  }, HEARTBEAT_MS);
}
function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function handleMessage(raw: string): void {
  let msg: AnyMessage;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.type) {
    case 'cancel': {
      const requestId = msg.requestId ?? (msg.payload?.requestId as string | undefined);
      const result = requestId ? cancelJob(requestId) : 'not_found';
      send(envelope('cancel.ack', { correlationId: msg.id, result }, requestId ? { requestId } : {}));
      break;
    }
    case 'ping':
      send(envelope('pong', {}));
      break;
    case 'hello.ack':
      logger.info({ payload: msg.payload }, 'Hub WS: handshake confirmado');
      break;
    default:
      logger.debug({ type: msg.type }, 'Hub WS: mensagem ignorada');
  }
}

function connect(): void {
  if (stopped) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(wsUrl());
  } catch (err) {
    logger.error({ err }, 'Hub WS: falha ao criar socket');
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.addEventListener('open', () => {
    attempt = 0;
    logger.info('Hub WS: conectado');
    send(envelope('worker.hello', { workerId: env.WORKER_ID, version: process.env.npm_package_version ?? 'dev' }));
    send(envelope('worker.snapshot', { jobs: snapshot() }));
    startHeartbeat();
  });

  socket.addEventListener('message', (ev: MessageEvent) => {
    handleMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
  });

  socket.addEventListener('close', () => {
    stopHeartbeat();
    ws = null;
    logger.warn('Hub WS: conexão fechada');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // 'close' segue 'error'; o reconnect é agendado lá.
    logger.warn('Hub WS: erro de socket');
  });
}

export function startHubClient(): void {
  if (env.REALTIME_ENABLED === 'false') {
    logger.info('Hub WS: desabilitado (REALTIME_ENABLED=false)');
    return;
  }
  stopped = false;
  connect();
}

export function stopHubClient(): void {
  stopped = true;
  stopHeartbeat();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  ws?.close();
  ws = null;
}
