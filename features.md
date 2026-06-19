# Feature: Comunicação em Tempo Real (Observabilidade + Controle de Jobs)

> Documento de proposta arquitetural para o ecossistema flight-monitoring.
> Substituir a comunicação HTTP "fire-and-forget" entre serviços por canais de
> tempo real, permitindo: status/logs ao vivo de todos os jobs de scraping,
> **interrupção real** de um job específico, e uma visão Admin no front que
> atualiza sozinha (sem refresh) — mantendo e enriquecendo o histórico atual.

---

## 1. Objetivo

| # | Requisito | Hoje | Alvo |
|---|-----------|------|------|
| 1 | flight.API conhece o status de **todos** os jobs em tempo real | ❌ só sabe o que ele mesmo despachou; estado vem de polling no DB | ✅ telemetria push do scraping.API |
| 2 | Logs ao vivo por job | ❌ logs ficam só no scraping.API (pino/Loki) | ✅ stream de eventos por `requestId` |
| 3 | **Interromper** um job específico (interrupção real) | ❌ impossível — job roda até o fim na PQueue | ✅ comando de cancelamento que aborta o Playwright |
| 4 | Visão Admin em tempo real (status, tempo de execução, interromper) | ❌ admin precisa dar refresh | ✅ painel que atualiza via stream |
| 5 | Histórico mantido, com mais detalhe e em tempo real | ⚠️ `analysis_runs` (1 linha/dispatch), sem eventos | ✅ histórico + timeline de eventos, push ao vivo |

---

## 2. Estado atual (gaps que motivam a mudança)

**scraping.API** (`src/routes/scrape.ts`, `src/queue/index.ts`, `src/services/scraper/runner.ts`)
- `POST /scrape` → `queue.add(() => runScrapeJob(body))` e responde `202`. Depois disso é uma caixa-preta: não há rota de status, não há logs expostos, **não há como cancelar**. Uma vez na PQueue, o job roda até terminar.
- `runScrapeJob` executa o scraper Playwright e devolve o resultado por **HTTP callback** (`POST {FLIGHT_API_URL}/scrape/results`).
- Sem registro persistente de job no lado do scraper (usa "runs" em arquivo).

**flight.API** (`src/services/scheduler/`, `src/modules/scrape/`, `src/modules/analysis-runs/`)
- Scheduler despacha por HTTP, marca `scraping_jobs.running`, abre `analysis_runs`. Estado é descoberto por **polling no DB** (heartbeat recupera travados; `failStaleRunning` por timeout).
- Recebe resultado só no webhook final. Não há canal vivo nem comando de controle.

**flight.FRONT** (`src/services/ApiService`, páginas Admin)
- REST puro. Histórico (`analysis_runs`) é carregado sob demanda em `/admin/user-routines`. **Admin dá refresh** para ver mudanças.

**flight.DB**
- `scraping_jobs` (estado atual) + `analysis_runs` (1 linha/dispatch, status `running|success|failed|dead|blocked`). **Não existe status `cancelled`** nem tabela de eventos/timeline.

---

## 3. Decisão de transporte (fundamentada em pesquisa de mercado)

A pesquisa convergiu numa recomendação clara — **transporte híbrido**, escolhido por leg de comunicação, não um único protocolo para tudo:

### 3a. flight.API ↔ scraping.API → **WebSocket** (canal de controle/telemetria)
É a única leg **genuinamente bidirecional**: comandos descem (`cancel job X`), telemetria sobe (status, progresso, logs). WebSocket é o fit correto para comunicação serviço↔serviço persistente e de baixa latência com comandos nos dois sentidos.

- **Quem disca para quem:** o **scraping.API conecta-se ao flight.API** (worker → hub), não o contrário. Motivo: o scraper roda atrás de NAT/firewall (VM/casa) e o flight.API é o ponto central estável. Worker dialing-out evita expor porta de entrada no scraper e simplifica reconexão.
- Reconexão com **backoff exponencial + jitter**; ao reconectar, o scraper reenvia um **snapshot** do estado dos jobs em andamento (resync).
- **Heartbeat ping/pong** (~30s) nos dois lados para detectar conexão morta.

### 3b. flight.FRONT ← flight.API → **SSE recomendado** (stream) + REST para ações
Para o painel Admin o fluxo é majoritariamente **servidor→cliente** (status, logs, histórico). A pesquisa é unânime: para dashboards/logs/métricas, **SSE é mais simples, mais escalável e mais robusto** que WebSocket — reconexão automática nativa (`EventSource`), roda sobre HTTP/1.1+2 sem upgrade de protocolo, e é mais barato para broadcast (sem masking XOR).

- As **ações** do admin (incluindo o botão "interromper job") são um `POST` REST comum — não precisam de canal persistente. Padrão recomendado pela pesquisa: *"ações via HTTP/REST, atualizações via SSE"*.
- ⚠️ **Ponto de decisão:** você pediu WebSocket também aqui. WebSocket funciona, mas adiciona complexidade sem ganho real neste leg. **Recomendo SSE para o front** e WebSocket apenas no serviço↔serviço. Confirme no fim do doc.

### Diagrama alvo

```
                       ┌──────────────────────────────────────┐
  flight.FRONT  ──SSE──┤  flight.API  (hub)                    │
   (Admin UI)   ──REST─┤   • WS server  (worker telemetry)     │
                       │   • SSE hub    (fan-out p/ admins)     │
                       │   • REST       (ações: cancel, etc.)   │
                       └───────────────▲──────────────────────┘
                                       │ WebSocket (control + telemetry)
                                       │ comandos ↓  /  status+logs ↑
                       ┌───────────────┴──────────┐
                       │  scraping.API (worker)    │
                       │   • WS client (dial-out)  │
                       │   • registry de jobs +    │
                       │     AbortController/ctx   │
                       └───────────────────────────┘
```

---

## 4. Modelo de interrupção de jobs (a parte crítica)

Hoje o job é uma promise solta na PQueue — não dá para abortar. A interrupção **real** exige cancelamento cooperativo via `AbortController` propagado até o Playwright (best practice confirmada na pesquisa: *um `AbortSignal` que flui por todo o stack; checar `!signal.aborted` em loops; fechar o contexto para abortar operação em voo*).

**Mecânica no scraping.API:**
1. **Registry de jobs ativos:** `Map<requestId, { controller: AbortController, context: BrowserContext, startedAt }>`.
2. **Enfileiramento com signal:** `queue.add(({ signal }) => runScrapeJob(body, signal), { signal })`.
   - Job **ainda na fila** → `controller.abort()` faz a PQueue rejeitar antes de rodar (cancelamento "grátis").
   - Job **em execução** → cancelamento cooperativo (abaixo).
3. **Propagação do signal no scraper** (`azulSearch(params, { signal })`):
   - Checar `signal.aborted` entre etapas (navegar → preencher → buscar → parsear → próxima data).
   - Para abortar uma operação Playwright **em voo**, chamar `context.close()` / `page.close()` no handler do `abort` → a operação pendente lança e desenrola o scraper limpo (sem vazar browser).
4. **Emissão de evento** `cancelled` pelo WS → flight.API → DB → front.

**Fluxo ponta-a-ponta do "interromper":**
```
Admin clica "interromper"  (flight.FRONT)
   └─ POST /flight/scraping-jobs/:requestId/cancel   (REST, admin JWT)
        └─ flight.API: valida → envia {type:"cancel", requestId} pelo WS ao worker
             └─ scraping.API: registry.get(requestId).controller.abort()
                  └─ context.close() aborta o Playwright
                  └─ emite {type:"status", status:"cancelled"} pelo WS
        └─ flight.API: marca analysis_runs=cancelled, libera scraping_job
        └─ fan-out SSE → painel Admin atualiza em tempo real
```

**Novo status `cancelled`** precisa entrar nos CHECKs de `scraping_jobs.status` e `analysis_runs.status` (migration — ver §7).

---

## 5. Logs e telemetria em tempo real

**Recomendação: eventos estruturados de progresso** (não streaming bruto de pino).
O scraper emite marcos por etapa, carregando o `requestId`, que o worker envia pelo WS:

```
job.queued    → { requestId, position }
job.started   → { requestId, startedAt }
job.progress  → { requestId, step: "navigate|fill_form|search|parse|calendar",
                  detail, faresSoFar }
job.log       → { requestId, level, msg, ts }        # linhas relevantes do pino
job.finished  → { requestId, status, faresFound, durationMs, error? }
```

- **Throttling/batching** dos `job.log`/`job.progress` para evitar backpressure (pesquisa: subscriber lento gera memory spike). Ex.: agrupar logs em janelas de ~250ms.
- Para "logs ao vivo" sem reescrever o pino: adicionar um **transport/hook pino** que, quando a linha tem `requestId` de um job ativo, espelha pelo WS — mantendo Loki/stdout como hoje.
- flight.API recebe esses eventos, **persiste** os relevantes (timeline — §6) e **faz fan-out** por SSE só para os admins inscritos.

---

## 6. Histórico aprimorado (mantido + timeline em tempo real)

Mantém `analysis_runs` (não quebra o histórico atual) e adiciona uma **timeline de eventos** por execução, alimentada pela telemetria:

- Nova tabela `analysis_run_events` (append-only): `(id, request_id, ts, type, level, payload JSONB)`.
  - Permite "replay" de uma execução passada e detalhe fino que hoje não existe.
  - Retenção própria (ex.: 10–15 dias), alinhada ao pruning já existente.
- O front carrega o histórico inicial via REST e, para execuções **em andamento**, recebe os novos eventos por SSE → a tela de histórico também atualiza sozinha.

---

## 7. Mudanças por projeto

### flight.DB (migration nova — `008_realtime_jobs.sql` + espelhar em `init-scripts/01-schema.sql`)
- `scraping_jobs.status`: adicionar `cancelled` ao CHECK.
- `analysis_runs.status`: adicionar `cancelled` ao CHECK.
- Criar tabela `analysis_run_events` (timeline) + índice por `(request_id, ts)`.
- (Opcional) `scraping_jobs.cancel_requested_at TIMESTAMPTZ` para auditoria de cancelamentos.

### scraping.API
- **WS client** (dial-out para flight.API) com reconexão/backoff/heartbeat + resync de snapshot.
- **Registry** `Map<requestId, {controller, context}>`; enfileirar com `{ signal }`.
- Propagar `AbortSignal` em `runScrapeJob` → scrapers (`azul.ts` etc.): checks `!signal.aborted` + `context.close()` no abort.
- Emissão de eventos de telemetria (`§5`).
- `POST /scrape` continua existindo (compat) **ou** vira mensagem `dispatch` pelo WS — ver decisão no §11. Auth do canal por shared secret/`x-api-key` no handshake.

### flight.API
- **WS server** para o worker (autentica handshake por `x-api-key`; aceita 1..N workers, cada um com `worker_id`).
- **SSE hub** `GET /flight/admin/stream` (admin JWT) com fan-out por `EventEmitter` em memória.
- **REST** `POST /flight/scraping-jobs/:requestId/cancel` (admin) → roteia comando ao worker dono do job.
- Persistir telemetria em `analysis_runs` + `analysis_run_events`; atualizar `scraping_jobs` ao vivo (substitui parte do polling do heartbeat).
- Endpoint REST `GET /flight/admin/jobs` (snapshot inicial: todos os jobs + tempo de execução).

### flight.FRONT
- Novo `RealtimeService` baseado em `EventSource` (SSE) com reconexão; converte `snake_case→camelCase` como o `ApiService`.
- Página Admin nova (ou aba em `/admin`): tabela de **todos os jobs** com status, **tempo de execução ao vivo**, badge de progresso, e botão **Interromper** (`ConfirmDialog` → POST cancel).
- Painel de **logs/timeline ao vivo** por job selecionado.
- Histórico (`/admin/user-routines`) passa a aplicar eventos SSE sobre o estado carregado (sem refresh).

---

## 8. Contratos de mensagem (resumo)

**WS worker→hub (telemetria):** `worker.hello`, `worker.snapshot`, `job.queued`, `job.started`, `job.progress`, `job.log`, `job.finished`, `pong`.
**WS hub→worker (controle):** `dispatch?`, `cancel`, `ping`.
**SSE hub→front:** `job.upsert` (estado consolidado do job), `job.event` (linha de timeline/log), `job.removed`.

Todas as mensagens: envelope `{ type, requestId?, ts, payload }`. Versionar com `v` para evolução.

---

## 9. Segurança
- **WS serviço↔serviço:** shared secret no handshake (header `x-api-key`), reuso do segredo já existente do webhook. TLS em produção (wss://).
- **SSE/REST front:** admin JWT (mesma `AdminRoute`/middleware atual). O stream só emite o que o role pode ver.
- Comando `cancel` exige role admin + rate-limit (já há 120/min/IP).

## 10. Escalabilidade (agora vs. futuro)
- **Agora (1 worker, QUEUE_CONCURRENCY=1, poucos admins):** fan-out em memória no flight.API é suficiente e robusto. **Não introduzir Redis** ainda — a pesquisa confirma que pub/sub só compensa em multi-instância / ~100K conexões.
- **Quando escalar** (flight.API horizontal ou vários workers/IPs): adicionar **Redis pub/sub** como backplane para fan-out entre instâncias + `least_conn` no balanceador + estado de salas no Redis para reconstruir sessão na reconexão. Migração para Redis Streams/NATS só se precisar de durabilidade/replay de mensagens. Roteamento de `cancel` ao worker correto via `worker_id` já deixa o caminho pronto.
- **Backpressure:** batching de logs/progress (§5); descartar `job.log` para clientes lentos preservando `job.upsert`.

---

## 11. Decisões (fechadas)
1. ✅ **Transporte do front:** **SSE + REST**. Stream servidor→cliente via `EventSource`; ações (incl. cancel) via POST REST.
2. ✅ **Dispatch do scraper:** **manter `POST /scrape` HTTP**. WebSocket usado só para controle (`cancel`) + telemetria — dispatch atual permanece.
3. ✅ **Profundidade dos logs:** **eventos de progresso estruturados** (marcos por etapa + linhas relevantes, com batching) — não espelhar o pino bruto.
4. ✅ **Redis:** **depois** — fan-out em memória basta na escala atual; introduzir backplane só ao escalar horizontalmente.

---

## 12. Plano de implementação faseado
1. **DB:** migration `008` (status `cancelled` + `analysis_run_events`) + espelhar no init-script.
2. **scraping.API:** registry + `AbortSignal` ponta-a-ponta + cancelamento real (testável isolado).
3. **Canal WS worker↔hub:** handshake, heartbeat, reconexão, snapshot, eventos de telemetria.
4. **flight.API:** persistência de telemetria + endpoint `cancel` + `GET /admin/jobs`.
5. **SSE hub + RealtimeService no front:** painel Admin ao vivo + botão interromper.
6. **Histórico ao vivo:** aplicar eventos SSE sobre `analysis_runs`/timeline.
7. **Hardening:** backpressure/batching, testes, observabilidade do próprio canal (conexões/erros).

---

# Parte II — Especificação detalhada

## 13. Keep-alive da conexão WebSocket (worker ↔ hub)

O canal é **Node↔Node** (`ws` lib dos dois lados), então temos acesso a frames de
controle nativos — diferente do browser. A técnica combina **3 camadas**:

### 13.1 Ping/pong de protocolo + flag `isAlive` (detecção de morte)
Padrão clássico do `ws`. O **hub** (server) pinga cada worker periodicamente e
derruba quem não responde:

```ts
// flight.API (server)
const HEARTBEAT_MS = 30_000;
const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }   // não respondeu o ping anterior
    ws.isAlive = false;
    ws.ping();                                                 // frame de controle nativo
  }
}, HEARTBEAT_MS);
ws.on('pong', () => { ws.isAlive = true; });                   // ws responde pong automaticamente
wss.on('close', () => clearInterval(interval));
```

O **worker** também vigia o lado dele: se não receber ping/dado por `> 45s`,
assume hub morto, fecha e reconecta (não espera o TCP estourar, que pode levar minutos).

### 13.2 Heartbeat de aplicação (liveness + leveza de estado)
Além do ping de protocolo, o worker envia a cada ~15s um `worker.heartbeat` leve
com `{ activeJobs: [requestId...], queueDepth }`. Serve para: (a) atravessar proxies
que só renovam timeout em frames de dados, (b) o hub reconciliar rápido se perdeu um
evento, sem esperar o próximo snapshot completo.

### 13.3 TCP keepalive + timeouts de socket (backstop)
`socket.setKeepAlive(true, 30_000)` como rede de segurança no nível de SO.

### 13.4 Reconexão (lado worker, dial-out)
**Backoff exponencial com jitter**, com teto, para evitar *thundering herd* quando o
hub reinicia (todos os workers + admins reconectam juntos):

```
delay = min(maxDelay, base * 2^tentativa) ± jitter
base=1s, maxDelay=30s, jitter=±20%
```
Ao reconectar: `handshake (auth) → worker.snapshot → reconciliação` (§17.1).

---

## 14. Padrão de comunicação (envelope, correlação, entrega)

### 14.1 Envelope único (todas as mensagens, WS e SSE)
```jsonc
{
  "v": 1,                 // versão do protocolo (evolução sem quebrar)
  "type": "job.progress", // tipo (catálogo abaixo)
  "id": "msg-uuid",       // id da mensagem (p/ ack/correlação)
  "requestId": "uuid",    // job alvo (quando aplicável)
  "seq": 7,               // sequência monotônica POR job (ordenação/dedup)
  "ts": "2026-06-19T...", // ISO timestamp da origem
  "payload": { }          // específico do tipo
}
```

### 14.2 Catálogo de mensagens
**Worker → Hub (telemetria):**
`worker.hello` (handshake), `worker.snapshot`, `worker.heartbeat`,
`job.queued`, `job.started`, `job.progress`, `job.log`, `job.finished`, `cancel.ack`, `pong`.

**Hub → Worker (controle):**
`hello.ack`, `cancel`, `ping`. *(dispatch continua via `POST /scrape` HTTP — decisão §11.2)*

**Hub → Front (SSE):**
`job.snapshot` (1º evento da conexão), `job.upsert` (estado consolidado),
`job.event` (linha de timeline/log), `job.removed`, `airline.paused`.

### 14.3 Semântica de entrega
- **Telemetria (job.*)**: *fire-and-forget*, mas **idempotente** via `(requestId, seq)`.
  O hub descarta duplicados/fora de ordem. Perdas em queda de conexão são toleráveis
  porque o **snapshot na reconexão restabelece a verdade** do estado.
- **Comandos (`cancel`)**: exigem **ack** (`cancel.ack` com `correlationId = id` do comando)
  e são **idempotentes** (cancelar duas vezes = mesmo efeito). Se o worker está offline,
  o comando **não** se perde — vira intenção persistida (`cancel_requested_at`, §16) e é
  aplicado na reconexão.
- **Fonte da verdade dos resultados continua sendo o HTTP webhook** (`POST /scrape/results`).
  O WS nunca carrega as tarifas — só telemetria/controle. Assim, se o WS cair, **nenhum
  dado de tarifa é perdido**; perde-se no máximo a animação ao vivo. Esse é o ponto de
  robustez central do desenho.

### 14.4 SSE: reconexão sem buracos
Cada evento SSE leva `id:` = contador global monotônico. Na reconexão o browser manda
`Last-Event-ID` automaticamente; o hub **reenvia do ring-buffer em memória** (últimos N
eventos) o que o admin perdeu. Se o `Last-Event-ID` já foi evacuado do buffer → o hub
manda um `job.snapshot` completo e segue. Primeiro evento de toda conexão nova =
`job.snapshot` (evita a corrida "carreguei a tabela e perdi um update no meio").

---

## 15. Interrupção de análises (mecânica completa)

Hoje `runScrapeJob` é uma promise solta na PQueue — impossível abortar. A interrupção
**real** usa cancelamento cooperativo via `AbortController` propagado até o Playwright.

### 15.1 Registry de jobs ativos (scraping.API)
```ts
type JobHandle = {
  requestId: string;
  controller: AbortController;
  setContext: (c: BrowserContext) => void;   // scraper registra o context ao criá-lo
  phase: 'queued' | 'running' | 'finishing';
  startedAt: number;
};
const registry = new Map<string, JobHandle>();
```

### 15.2 Enfileiramento com signal (cancela job na fila "de graça")
```ts
const controller = new AbortController();
const handle: JobHandle = { /* ... */ controller, phase: 'queued' };
registry.set(requestId, handle);
// PQueue rejeita ANTES de rodar se abortar enquanto na fila:
queue.add(({ signal }) => runScrapeJob(body, signal, handle), { signal: controller.signal })
  .catch(err => { if (err.name === 'AbortError') emitFinished(requestId, 'cancelled', { phase: 'queued' }); });
```

### 15.3 Cancelamento cooperativo de job EM EXECUÇÃO
Checar `signal.aborted` entre etapas **não basta** — um `page.goto`/`waitForSelector`
pode bloquear 30s. Para abortar a operação Playwright **em voo**, fechamos o contexto:

```ts
signal.addEventListener('abort', () => {
  context?.close().catch(() => {});   // operação pendente lança "Target closed" → desenrola o scraper
}, { once: true });
```
Os scrapers (`azul.ts` etc.) passam a:
1. Receber `signal` nos params e **registrar o context** no handle assim que criá-lo.
2. Checar `if (signal.aborted) throw new AbortError()` no início de cada etapa e dentro
   do loop de datas (`dateRange`).

### 15.4 Cooldown da Azul precisa ser abortável ⚠️
O `await new Promise(r => setTimeout(r, wait))` do `AZUL_MIN_GAP_MS` (180s) é um job
"running" dormindo. Sem tratar, o cancel só agiria após o sleep. Tornar abortável:
```ts
await new Promise((resolve, reject) => {
  const t = setTimeout(resolve, wait);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new AbortError()); }, { once: true });
});
```

### 15.5 Classificação do desfecho (cancelled ≠ failed) ⚠️
No `catch` de `runScrapeJob`, **distinguir** abort de erro real — senão o scheduler
trataria como falha e faria retry:
```ts
if (signal.aborted) { emitFinished(requestId, 'cancelled', ...); /* sem retry */ }
else                { /* fluxo de erro atual: saveError + status 'failed' */ }
```
Cancelado **descarta resultado parcial** (não envia tarifas pela metade).

### 15.6 Fluxo ponta-a-ponta
```
Admin → POST /flight/scraping-jobs/:requestId/cancel  (REST, admin JWT)
  → hub valida + envia WS {type:'cancel', id, requestId}
      → worker: registry.get(requestId)?.controller.abort()
          → context.close() aborta Playwright / clearTimeout no cooldown
          → worker → hub: {type:'cancel.ack', correlationId, result:'aborted'|'queued_removed'|'not_found'}
          → worker → hub: {type:'job.finished', status:'cancelled'}
  → hub: analysis_runs=cancelled; scraping_job → pending c/ next_run_at=now()+cooldown (sem ++retry)
  → SSE fan-out → painel atualiza
```

---

## 16. Ajustes no banco (flight.DB — migration `008` + espelhar em `init-scripts/01-schema.sql`)

```sql
-- 1) novo estado terminal de execução cancelada
ALTER TABLE scraping_jobs  DROP CONSTRAINT scraping_jobs_status_check;
ALTER TABLE scraping_jobs  ADD  CONSTRAINT scraping_jobs_status_check
  CHECK (status IN ('pending','running','success','failed','dead','cancelled'));

ALTER TABLE analysis_runs  DROP CONSTRAINT analysis_runs_status_check;
ALTER TABLE analysis_runs  ADD  CONSTRAINT analysis_runs_status_check
  CHECK (status IN ('running','success','failed','dead','blocked','cancelled'));

-- 2) intenção de cancelamento (p/ worker offline) + auditoria
ALTER TABLE scraping_jobs ADD COLUMN cancel_requested_at TIMESTAMPTZ;
ALTER TABLE analysis_runs ADD COLUMN cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE analysis_runs ADD COLUMN worker_id    VARCHAR(40);   -- rastreabilidade multi-worker (futuro)

-- 3) timeline append-only por execução (histórico detalhado + replay)
CREATE TABLE analysis_run_events (
  id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id  UUID        NOT NULL,
  seq         INT         NOT NULL,        -- = seq do envelope (ordenação determinística)
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  type        VARCHAR(30) NOT NULL,        -- queued|started|progress|log|finished
  level       VARCHAR(10),                 -- info|warn|error (p/ job.log)
  payload     JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_run_events_request ON analysis_run_events(request_id, seq);
-- retenção alinhada ao pruning existente (ex.: 10–15 dias)
```
> Convenção flight.DB: alterar **init-scripts e migration** juntos. `cancelled` é terminal
> para a *execução*, mas o *job* volta a `pending` com cooldown (não é falha, não conta retry).

---

## 17. Gerência da comunicação scraping ↔ api (ciclo de vida)

### 17.1 Handshake + reconciliação por snapshot
```
worker boot → dial wss://hub → {type:'worker.hello', payload:{workerId, version, apiKey}}
hub: valida x-api-key → {type:'hello.ack'} ; senão fecha (1008 policy violation)
worker → {type:'worker.snapshot', payload:{jobs:[{requestId, phase, startedAt}]}}
hub reconcilia:
  • job no snapshot que o DB tinha como running → mantém (re-vincula)
  • job no DB running que NÃO está no snapshot → o worker reiniciou e perdeu o job →
    deixa o heartbeat/failStaleRunning tratar (já existe) OU marca failed na hora
  • cancel_requested_at preenchido p/ algum job vivo → hub reenvia 'cancel'
```

### 17.2 Estados da conexão e efeito nos jobs
- **online** → telemetria flui, comandos entregues na hora.
- **offline** (pong perdido) → hub marca worker offline; jobs `running` daquele worker
  entram em *grace period*; o **heartbeat existente** (recupera travados / `failStaleRunning`)
  continua sendo a rede de segurança — nada fica preso para sempre.
- **resultado por HTTP independe do WS**: o webhook pode chegar mesmo com WS caído.

### 17.3 Multi-worker (já deixar o caminho pronto)
Comando `cancel` roteado ao **worker dono** do `requestId` (mapa `requestId → workerId`
no hub). Hoje há 1 worker; o roteamento já evita refazer isso depois.

---

## 18. Gerência da comunicação api ↔ front (ciclo de vida)

### 18.1 Abertura do painel (sem corrida)
1. Front abre `EventSource('/flight/admin/stream')` (admin JWT via cookie/credentials).
2. **1º evento = `job.snapshot`** com todos os jobs + `running_since` → pinta a tabela.
3. Depois só deltas (`job.upsert`/`job.event`). `GET /admin/jobs` REST continua existindo
   para usos não-streaming.

### 18.2 "Tempo de execução" sem clock skew ⚠️
A duração ("há quanto tempo roda") é calculada **no front a partir do `running_since`
autoritativo do hub** (DB), não do relógio do worker. Evita divergência de relógios.

### 18.3 UI otimista no cancelamento
Clicar "Interromper" → estado vira `cancelling` na hora (feedback imediato) → confirma
quando chega `job.upsert status=cancelled`. Se em ~10s não confirmar → toast de erro e
volta o estado (o `cancel.ack` com `not_found` também resolve isso).

### 18.4 Backpressure por cliente lento
Se `reply.raw.write()` retorna `false` (buffer cheio), o hub **descarta `job.event`
(logs) preservando `job.upsert` (estado)** para aquele cliente. Estado nunca se perde;
no máximo o admin perde linhas de log de um job durante um pico.

---

## 19. Edge cases (contextualizados ao domínio)

| # | Cenário | Tratamento |
|---|---------|-----------|
| 1 | **Cancel chega com job já finalizado** (corrida) | registry não tem o `requestId` → `cancel.ack: not_found`; `job.finished` já em trânsito reconcilia. No-op idempotente. |
| 2 | **Cancel durante cooldown da Azul** (sleep 180s) | timer abortável (§15.4) — `clearTimeout` + reject imediato. |
| 3 | **Cancel de job só enfileirado** | PQueue rejeita antes de abrir browser → `cancelled phase:queued`, sem Playwright. |
| 4 | **IP bloqueado durante job** ("comportamento incomum") | `job.finished status=blocked` + `airline.paused` no painel; `pauseAirlineForBlock` (existente) atua; cancel de job blocked = no-op. |
| 5 | **`context.close()` trava/lança** | `try/catch` + timeout; fallback `browser.close()`/kill para não vazar browser. |
| 6 | **Worker offline quando admin cancela** | `cancel_requested_at` persistido → reenviado no `worker.snapshot`/reconexão. Não se perde. |
| 7 | **Webhook de resultado chega mas WS estava caído** | OK por design — resultado é HTTP; telemetria é best-effort. Estado reconciliado no reconnect. |
| 8 | **Hub reinicia e recebe evento de requestId desconhecido** | reconcilia a partir de `analysis_runs` (por `request_id`) em vez de descartar. |
| 9 | **nginx bufferiza a resposta SSE** (quebra o stream) | header `X-Accel-Buffering: no` + `proxy_buffering off`. |
| 10 | **Admin com várias abas** (limite ~6 conexões HTTP/1.1) | servir sob **HTTP/2**; opcional `SharedWorker`/`BroadcastChannel` para 1 stream compartilhado. |
| 11 | **Reconnect storm** (hub reinicia, todos voltam juntos) | backoff **com jitter** worker e front (§13.4). |
| 12 | **Dispatch duplicado da mesma rota** | cancel mira `requestId` (não o job) → não afeta um novo dispatch da mesma rota. |
| 13 | **Cancel duplo / clique duplo** | idempotente (controller já abortado = no-op). |
| 14 | **Leak de listeners SSE** quando admin fecha aba | `req.raw.on('close')` remove do hub + limpa intervals. Obrigatório. |
| 15 | **Cancelar não pode matar o job para sempre** | `cancelled` é terminal da *execução*; o *job* volta a `pending` com `next_run_at=now()+cooldown`, sem `++retry_count`. |
| 16 | **Snapshots parciais em disco** após `context.close()` | aceitável; `pruneOldRuns()` existente limpa. |

---

## Fontes (pesquisa de mercado)
- [Choose Between SSE and WebSockets — Railway](https://docs.railway.com/guides/sse-vs-websockets)
- [Why Server-Sent Events Beat WebSockets for 95% of Real-Time Cloud Apps — Medium](https://medium.com/codetodeploy/why-server-sent-events-beat-websockets-for-95-of-real-time-cloud-applications-830eff5a1d7c)
- [SSE vs WebSockets vs Long Polling: What's Best in 2025 — DEV](https://dev.to/haraf/server-sent-events-sse-vs-websockets-vs-long-polling-whats-best-in-2025-5ep8)
- [AbortController Patterns for Playwright Test Cancellation — Hashnode](https://vitalicset.hashnode.dev/abortcontroller-patterns-for-playwright-test-cancellation)
- [Stop Leaking Resources: AbortSignal in Playwright — DEV](https://dev.to/vitalicset/stop-leaking-resources-how-to-use-abortsignal-in-playwright-tests-jb2)
- [Understanding AbortController in Node.js — Better Stack](https://betterstack.com/community/guides/scaling-nodejs/understanding-abortcontroller/)
- [Scaling WebSocket Connections: Single Server to Distributed (2026) — DEV](https://dev.to/young_gao/scaling-websocket-connections-from-single-server-to-distributed-architecture-1men)
- [Scaling Pub/Sub with WebSockets and Redis — Ably](https://ably.com/blog/scaling-pub-sub-with-websockets-and-redis)
