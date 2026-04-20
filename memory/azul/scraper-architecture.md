---
name: Arquitetura e fluxo do scraper Azul
description: Stack, ordem exata do fluxo de automação, arquitetura de buscas, coleta de dados, estado atual do código
type: project
---
## Stack
rebrowser-playwright (anti-bot Chromium, headless:false), TypeScript/tsx, pino logger, dotenv.

## Fluxo de automação (ordem exata)

1. Navegar para `https://www.voeazul.com.br/br/pt/home`
2. Aceitar cookies (`#onetrust-accept-btn-handler`) + force-hide overlay OneTrust
3. Clicar em `input[aria-label="Origem"]` → digitar código do aeroporto → clicar option `button[role="option"]` que contém o código em `<b>`
4. Clicar em `input[aria-label="Destino"]` → digitar código → clicar option
5. Clicar em `input[aria-label="Datas (Ida e volta)"]` → digitar DDMMYYYY (data início do período de ida)
6. Clicar `button:text("Buscar passagens")`
7. Aguardar `p.results` com "voos encontrados" OU `p.css-1wdbheb` (estado vazio) OU `.booking-calendar__cards`
8. Se estado vazio → pular data sem erro
9. Coletar voos em BRL (botão "Reais") e em Pontos (botão "Pontos")
10. Navegar datas no `.booking-calendar__cards` clicando botões com `aria-label` contendo "DD/MM"
11. Após coletar todo range de ida → repetir do passo 1 com origem/destino invertidos para o range de volta

## Arquitetura de buscas

- **Ida e volta são buscas separadas** — cada uma como one-way
- **Uma página por rota** — não abrir nova página por data; navegar pelo booking-calendar
- **Range de datas**: digitar a data INÍCIO do range no datepicker; navegar até a data FIM pelo carrossel
  - Ex: range 2026-05-25 → 2026-05-27: digitar 25052026, navegar carrossel até "qui 27/05"

## Coleta de dados por passagem

Para cada voo visível coletar:
- Valor em R$ (view "Reais")
- Valor em pontos (view "Pontos")
- Valor híbrido pontos+reais (se disponível)
- Duração
- Hora embarque / desembarque
- Número de escalas

Salvar como JSON em `results/RUN_DIR/YYYY-MM-DD/ORIGEM-DESTINO-brl.json` e `-pts.json`

## Estrutura de resultados

```
results/
  2026-05-10T07-00-00/
    snapshots/           ← HTML para diagnóstico (home + results por data)
    errors/              ← debug-*.png + dom-*.html em falhas
    2026-05-25/
      VCP-CGH-brl.json
      VCP-CGH-pts.json
```

## Estado atual do código (azul.ts) — 2026-04-20

Implementação correta com:
- `searchRoute` (uma página por rota, navega calendario)
- `fillSearchForm` com seletores corretos
- `waitForResults` retorna `boolean` (false = estado vazio `p.css-1wdbheb`)
- `collectFlights` usa abordagem iterativa (sem `function` nomeada dentro do evaluate)
- `waitForEvalReady()` — retenta evaluate até rebrowser context estabilizar
- Snapshots em `snapshots/` a cada passo
