---
name: LATAM — arquitetura do scraper
description: Fluxo, decisões, bugs conhecidos e estado atual do scraper da LATAM Airlines
type: project
---

## Stack

Mesmo da Azul: camoufox-js + playwright Firefox + DOM scraping.
Arquivo: `src/scrapers/latam.ts`

## Fluxo de busca

```
searchFlights(params, cpf?, password?)
  ├── BRL outbound: searchDateRange(..., redemption=false, isReturn=false)
  ├── BRL return:   searchDateRange(..., redemption=false, isReturn=true)  [se returnStart]
  └── se LATAM_CPF + LATAM_PASSWORD:
       ├── Pts outbound: searchDateRange(..., redemption=true, isReturn=false)
       │     ├── Login uma vez (CPF + senha)
       │     └── Para cada data: navega URL redemption=true, extrai milhas
       └── Pts return: idem com rota invertida
           └── mergePoints() → funde fares.points nos FlightOffer já existentes (match por IATA + hora)
```

## Modo BRL

- URL: `redemption=false`
- Preço extraído de: `[data-testid="flight-info-{i}-amount"] [aria-hidden="true"]`
- Formato texto: `"brl 538,54"` → parsed como BRL float

## Modo Pontos

- URL: `redemption=true`
- Requer login (CPF + senha via `LATAM_CPF` / `LATAM_PASSWORD` env vars)
- Login feito uma vez por contexto de browser
- Após login, re-navega para a URL de busca
- Preço: `[data-testid="loyalty-points-wrapper"] .displayAmount span`
- Formato texto: `"15.778 milhas"` → parsed como int
- Sem híbrido (o "BRL 33,64" que aparece é taxa fixa, descartado)
- Se login falhar: log warn + interrompe busca de pontos (retorna só BRL)

## Extração do número do voo (itinerary modal)

O número do voo NÃO está no card — é preciso clicar no link de detalhes do itinerário.

Fluxo em `extractCards`:
1. Clicar: `[data-testid="itinerary-modal-{i}-details-anchor--link"]`
2. Aguardar: `page.waitForSelector('[data-testid="incoming-outcoming-title"]', { state: 'visible', timeout: 8_000 })`
3. Ler text node em: `[data-testid="incoming-outcoming-title"] [data-testid="airline-wrapper"]`
   - Primeiro text node que não está em sub-span → ex: `"LA3344"`
   - Para voos com escala: múltiplos `incoming-outcoming-title`, usar o primeiro (voo da origem)
4. Fechar: `[data-testid="itinerary-modal-{i}--dialog-close-button"]` (duplo hífen antes de "dialog")

### Bug #1 — corrigido (2026-04-27)
`extractCards` não recebia `params` como argumento. `params.runDir` lançava ReferenceError silenciosamente
(swallowed pelo try/catch do loop), impedindo o close button de ser clicado.
**Fix:** `extractCards` agora recebe `runDir?: string` como último parâmetro. Call site passa `params.runDir`.

### Bug #2 — em investigação (2026-04-28)
`anchor.click()` dá `TimeoutError: Timeout 5000ms exceeded` em todos os cards.
O anchor existe no DOM (`count() > 0`), resolve para `<a href="" ...>`, mas Playwright não consegue clicar.
**Hipótese:** o footer do card está oculto via CSS (card colapsado). `page.evaluate` lê `textContent` de
elementos ocultos sem problema, mas `click()` do Playwright exige visibilidade.
**Fix pendente (não testado):** `anchor.click({ force: true })` + `scrollIntoViewIfNeeded` já está no código.
Próximo passo: confirmar se `force: true` resolve, ou se é preciso clicar no header do card antes.

## Resultados confirmados (testes locais 2026-04-27/28)

- GRU→CNF, 2026-05-30, BRL: 29–39 voos extraídos (varia por tentativa — LATAM às vezes retorna menos)
- IATA corretos, timestamps com timezone -03:00, durationMin, stops, fares.brl — tudo OK
- flightNumber: sempre vazio (Bug #2 bloqueando o modal click)

## Comportamento do `waitForCards`

- Timeout atual: **90s** (era 30s — aumentado porque LATAM às vezes mostra "A busca está demorando
  mais que o normal" por até ~60s antes de carregar os cards)
- Múltiplos requests ao mesmo destino em sequência podem disparar rate limiting/throttling da LATAM

## Limitações conhecidas

- **Login frágil**: CAPTCHA ou 2FA não são tratados. Se login falhar, job continua apenas com BRL.
- **Sem modo híbrido**: LATAM não tem tarifa híbrida estruturada. BRL na busca de pontos parece taxa fixa.
- **Rate limiting**: Muitos requests seguidos ao mesmo destino fazem LATAM retornar a página "busca demorando".

## Env vars

```
LATAM_CPF       (opcional) — CPF para login e busca de pontos
LATAM_PASSWORD  (opcional) — senha da conta LATAM
```

Se ausentes: busca apenas BRL.

## Arquivos per-date no runDir

```
{runDir}/{date}/
  latam-{ORIG}-{DEST}.json        ← BRL offers
  latam-{ORIG}-{DEST}-pts.json    ← points offers (só se logado)
{runDir}/snapshots/
  latam-{ORIG}-{DEST}-{date}-brl.html   ← snapshot da página após cards aparecerem
  modal-card-0.html                      ← snapshot do modal de itinerário (debug, card 0)
```

## Dev local

- flight.API (192.168.122.1:3011) não roda localmente → sendResult sempre falha com ConnectTimeoutError
- O scraper completa normalmente: results.json e response.json são salvos em RESULTS_DIR
- O job marca "failed" por causa do sendResult, mas os dados estão corretos

## Comportamento do tsx --watch

- tsx watch reinicia o processo ao salvar qualquer arquivo .ts
- Se o processo morreu (undici/p-queue unhandled rejection), tsx não reinicia automaticamente
- O servidor pode crashar quando sendResult lança depois de todos os retries (UnhandledRejection)
- Matar o processo Windows com PowerShell: `Get-NetTCPConnection -LocalPort 3000 | Stop-Process -Force`
  (pkill/kill do bash não funciona para processos Windows Node.js)
