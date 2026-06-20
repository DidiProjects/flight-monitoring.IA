# scraping.API

Scraper de preços de voos (Playwright + Claude AI). Recebe pedidos de pesquisa via HTTP, executa o scraping no site da companhia e devolve as ofertas por webhook para a flight.API.

Companhias suportadas: `azul`, `latam`, `britishairways`, `ryanair`.

## Stack

- Node.js >= 22, TypeScript
- Fastify (HTTP)
- Playwright / camoufox-js (browser stealth)
- @anthropic-ai/sdk (Claude AI para extração)
- p-queue (fila de concorrência)
- pino (logs)

## Como rodar

```bash
npm install            # postinstall baixa o camoufox
npm run dev            # tsx --watch, mostra o browser (headless:false)
npm run build          # bundle esbuild -> dist/main.cjs
npm start              # node dist/main.cjs (produção)
```

Em produção roda no Windows como serviço via NSSM. Em modo serviço (Session 0) o `headless:false` é ignorado e o browser não aparece; para ver o browser use `npm run dev`.

## Variáveis de ambiente

| Var | Obrigatória | Default | Descrição |
|-----|-------------|---------|-----------|
| `PORT` | não | `3000` | Porta HTTP |
| `SCRAPER_API_KEY` | sim | — | Chave exigida no header `x-api-key` do `POST /scrape` |
| `FLIGHT_API_URL` | sim | — | Base URL da flight.API (webhook) |
| `FLIGHT_API_KEY` | sim | — | Chave enviada à flight.API no callback |
| `QUEUE_CONCURRENCY` | não | `2` | Scrapes em paralelo (ver nota) |
| `RESULTS_DIR` | não | `./scraping-result` | Pasta dos artefatos de cada run |
| `LOG_LEVEL` | não | `info` | Nível do pino |
| `LOG_PRETTY` | não | `false` | Formatação pretty dos logs |
| `NODE_ENV` | não | `development` | — |
| `LATAM_CPF` / `LATAM_PASSWORD` | não | — | Credenciais opcionais da LATAM |
| `REALTIME_ENABLED` | não | `true` | Liga o canal WS de telemetria/controle com a flight.API |
| `WORKER_ID` | não | `scraper-1` | Identificador do worker no hub |
| `FLIGHT_API_WS_URL` | não | derivado de `FLIGHT_API_URL` | Override da URL do WS do hub |

## API

### `POST /scrape`
Header `x-api-key: <SCRAPER_API_KEY>`. Responde **202** imediatamente e enfileira o job; o resultado volta depois por webhook.

Body:
```json
{
  "requestId": "uuid",
  "routineId": "uuid",
  "airline": "azul",
  "origin": "CNF",
  "destination": "GRU",
  "outboundStart": "2026-05-25",
  "outboundEnd": "2026-05-27",
  "returnStart": "2026-06-01",
  "returnEnd": "2026-06-03",
  "passengers": 1
}
```
`returnStart`/`returnEnd` são opcionais. Resposta: `{ "requestId", "position" }`.

### `POST /scrape/:requestId/cancel`
Header `x-api-key`. Interrompe **de verdade** um job (na fila ou em execução):
aborta via `AbortController`, fechando o browser Playwright. Responde
`{ requestId, result }` com `result` ∈ `aborted | queued_removed | not_found`.
Também acionável pelo hub via comando `cancel` no canal WS.

### `GET /health`
`{ "status": "ok", "queue": { "size", "pending" } }`.

## Tempo real (WS worker → hub)

Além do webhook HTTP de resultados, o worker mantém um **WebSocket** (cliente
nativo do Node) com a flight.API (`/realtime/worker`, dial-out, auth por query
param `key`=`FLIGHT_API_KEY`). Por ele sobe **telemetria** por job
(`queued|started|progress|finished`) e descem **comandos de cancelamento**.
Reconexão com backoff+jitter e reenvio de snapshot. É best-effort: se cair, os
resultados continuam íntegros (vão pelo webhook). Liga/desliga via
`REALTIME_ENABLED`. Contrato em `flight-monitoring.IA/contracts/realtime-protocol.ts`.

## Fila e concorrência

Os jobs rodam numa `p-queue` com concorrência `QUEUE_CONCURRENCY` — ou seja, quantos scrapes rodam ao mesmo tempo. Como hoje há praticamente uma única companhia ativa (Azul) saindo de um único IP, valores altos aumentam o risco de detecção de bot / bloqueio de IP. Há ainda um cooldown mínimo de ~3 min entre runs consecutivos da Azul (WAF Akamai).

## Integração com a flight.API

Ao terminar (sucesso ou erro), o job faz `POST ${FLIGHT_API_URL}/scrape/results` com a chave `FLIGHT_API_KEY`. Payload:

```json
{
  "requestId", "routineId", "airline", "origin", "destination",
  "flights": [ { "airline", "flightNumber", "date", "isReturn",
                 "origin", "departureTime", "destination", "arrivalTime",
                 "durationMin", "stops", "currency",
                 "fareCash", "farePts", "fareHybPts", "fareHybCash" } ],
  "scrapedAt", "error"
}
```

Em caso de falha do scraping, `flights` vai vazio e `error` traz a mensagem.
