# Agente: scraping.API

Você é um agente especializado no projeto **scraping.API**, localizado em `C:\Users\diego\Documents\projects\scraping.API`.

## Stack

- **Runtime:** Node.js 22 + TypeScript 5.8.3
- **Framework:** Fastify 5.3.2
- **Validação:** Zod 3
- **Scraping:** Playwright 1.59.1 + Camoufox-js 0.10.2 (anti-detecção Firefox headless)
- **AI Agent:** @anthropic-ai/sdk 0.90.0 (Claude Sonnet 4.6 — auto-corrige o scraper)
- **Fila:** p-queue 8.1.0
- **Logging:** pino + pino-loki (Grafana Loki opcional)
- **Build:** esbuild → `dist/main.cjs`
- **Serviço Windows:** NSSM (roda como serviço do sistema)

## Estrutura de pastas

```
src/
├── main.ts                     # Entry point (bootstrap Fastify)
├── agent.ts                    # AI agent loop (Claude auto-corrige scraper)
├── server.ts                   # Setup do app Fastify
├── config/
│   ├── env.ts                  # Zod schema das env vars
│   └── browser.ts              # Contexto Playwright, BLOCKED_RESOURCES, padrões de APIs de voo
├── browser/
│   ├── cookies.ts              # acceptCookies (OneTrust, CookieBot, fallbacks)
│   └── human.ts                # humanDelay, humanType
├── routes/
│   ├── scrape.ts               # POST /scrape
│   └── health.ts               # GET /health
├── services/
│   ├── scraper/runner.ts       # runScrapeJob (orquestra airline scraper + callback)
│   └── result/sender.ts        # sendResult (POST para flight.API)
├── queue/index.ts              # P-queue configurada
├── middleware/auth.ts          # Validação X-API-Key
├── scrapers/
│   ├── azul.ts                 # Scraper principal (Azul — foco)
│   ├── latam.ts
│   ├── britishairways.ts
│   └── ryanair.ts
├── http/client.ts              # post() com retry
├── utils/
│   ├── logger.ts               # Pino com transport
│   ├── retry.ts                # withRetry wrapper
│   ├── runs.ts                 # createRun, saveResults, pruneOldRuns
│   └── dates.ts                # dateRange generator
└── types/
    ├── index.ts                # ScraperParams, FlightOffer, Fare
    └── scrape.ts               # ScrapeRequest, ScrapeResult

memory/
├── MEMORY.md                   # Índice de memórias do projeto
├── azul/
│   └── dom-structure.md        # Seletores confirmados + regras de parsing
└── feedback-dev-style.md       # Estilo de desenvolvimento
```

## Rodar localmente

```bash
npm install

# .env obrigatório:
PORT=3000
SCRAPER_API_KEY=sua-chave
FLIGHT_API_URL=http://192.168.122.1:3011
FLIGHT_API_KEY=chave-do-flight-api
QUEUE_CONCURRENCY=1
RESULTS_DIR=C:\Users\diego\...\scraping-result
LOG_LEVEL=debug
LOG_PRETTY=true

npm run dev      # tsx watch → http://localhost:3000
npm run build    # esbuild → dist/main.cjs
npm start        # node dist/main.cjs (produção)
```

## Gerenciar serviço NSSM (Windows)

```powershell
nssm status scraping-api
nssm start scraping-api
nssm stop scraping-api
nssm restart scraping-api

# Logs
Get-Content C:\Users\diego\logs\scraping-api\stdout.log -Tail 100
Get-Content C:\Users\diego\logs\scraping-api\stderr.log -Tail 100
```

## Endpoints

**POST /scrape** (header `X-API-Key: SCRAPER_API_KEY`)

```json
// Request
{
  "requestId": "uuid",
  "routineId": "uuid",
  "airline": "azul",
  "origin": "VCP",
  "destination": "GRU",
  "outboundStart": "2026-05-25",
  "outboundEnd": "2026-05-27",
  "returnStart": "2026-06-01",
  "returnEnd": "2026-06-03",
  "passengers": 1
}

// Response 202
{ "requestId": "uuid", "position": 0 }
```

**Callback assíncrono para flight.API:** `POST {FLIGHT_API_URL}/scrape/results`

```json
{
  "requestId": "uuid",
  "routineId": "uuid",
  "origin": "VCP",
  "destination": "GRU",
  "flights": [
    {
      "flightNumber": "AD1234",
      "date": "2026-05-25",
      "isReturn": false,
      "origin": "VCP",
      "departureTime": "10:00",
      "destination": "GRU",
      "arrivalTime": "11:45",
      "durationMin": 105,
      "stops": 0,
      "currency": "BRL",
      "fareCash": 450.50,
      "farePts": 25000,
      "fareHybPts": 18711,
      "fareHybCash": 3065.31
    }
  ],
  "scrapedAt": "2026-05-16T15:30:45.123Z",
  "error": null
}
```

## Estratégia de scraping (Azul)

**Fluxo principal:**
1. **Direct URL** (até 3 tentativas) — deep-link com params na query string
2. **Fallback:** home page + preenchimento do formulário
3. **Calendar navigation:** `.booking-calendar__cards` para datas da mesma rota

**URL format (Azul):**
```
https://www.voeazul.com.br/br/pt/home/selecao-voo?c[0].ds=VCP&c[0].std=MM/DD/YYYY&c[0].as=GRU&p[0].t=ADT&p[0].c=1&f.dl=3&f.dr=3&cc=BRL
```
`cc=BRL` para cash, `cc=PTS` para pontos.

**Seletores críticos (Azul):**
```
Origem:       input[aria-label*="Origem" i]
Destino:      input[aria-label*="Destino" i]
Data:         input[aria-label="Datas (Ida e volta)"]
Buscar:       button:has-text("Buscar passagens")
Resultados:   p.results                              ("X voos encontrados")
Cards:        div.flight-card[id]
Preço:        h4[data-test-id="fare-price"]
Toggle moeda: .currencySelector button[value="score"]   (Pontos)
              .currencySelector button[value="currency"] (Reais)
Híbrido:      p.condition
```

**Parsing de preços:**
- **BRL:** `h4[data-test-id="fare-price"]` → regex `/R?\$?([\d.]+)[,.](\d{2})$/`
- **Pontos:** `h4` com "pontos" → `/(\d+\.\d+)\s*pontos/i`
- **Híbrido:** `p.condition` → `/([\d.]+)\s*pontos?\s*\+\s*R\$\s*([\d.,]+)/i`

## Detalhes críticos (não-óbvios)

1. **Inputs com `opacity:0`** — origem/destino/data são `opacity:0` (styled-components). Se locator não funciona, usar coordenadas via `getBoundingClientRect()`

2. **Dois toggles de moeda** — um no painel de busca, outro nos resultados. Sempre usar `.currencySelector button[value="score"]` (não `.first()`)

3. **Anti-detecção** — Camoufox aplica: user-agent spoofing, locale `pt-BR`, timezone `America/Sao_Paulo`, humanização de delays. Se site retornar "comportamento incomum" / "acesso foi limitado", lança erro imediatamente

4. **NUNCA usar `function f() {}` em `page.evaluate()`** — tsx 4.x com `keepNames:true` injeta `__name` e quebra o contexto do browser. Usar apenas arrow functions `() => {}` ou loops

5. **Snapshots obrigatórios** — cada etapa salva HTML em `results/{run}/snapshots/`. Em erro: `debug-{origin}-{dest}.png` + `dom-{origin}-{dest}.html` em `results/{run}/errors/`

6. **Fares híbridas** — `p.condition` pode estar vazio em rotas internacionais; tratar como nullable

7. **Pruning automático** — `pruneOldRuns()` deleta runs com mais de 10 dias. Diretório configurável via `RESULTS_DIR`

8. **Deploy sem git** — build local → tar → SCP para VM → node roda `dist/main.cjs` diretamente. Sem git no servidor

## AI Agent (src/agent.ts)

Claude Sonnet 4.6 em loop agentic que **auto-corrige o scraper quando detecta falha**:
- Lê o erro mais recente nos logs
- Pré-carrega: `src/scrapers/azul.ts` + `memory/azul/dom-structure.md`
- Tools disponíveis: `bash`, `read_file`, `write_file`, `list_dir`
- Até 10 iterações; para em `stop_reason === 'end_turn'`
- Quando tokens < 25k: força commit + push das correções
- Após corrigir, atualiza `memory/azul/dom-structure.md` com novos seletores
