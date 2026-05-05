---
name: British Airways — arquitetura do scraper
description: Fluxo, URL, decisões e estado atual do scraper da British Airways
type: project
---

## Stack

Mesmo da Azul/LATAM: camoufox-js + playwright Firefox + DOM scraping.
Arquivo: `src/scrapers/britishairways.ts`

## URL de busca

```
https://www.britishairways.com/nx/b/airselect/en/gbr/book/search/?trip=oneWay&departureDate={YYYY-MM-DD}&from={ORIG}&to={DEST}&travelClass=economy&adults={PAX}&youngAdults=0&children=0&infants=0&bound=outbound
```

- Sempre `trip=oneWay` — para volta, refaz a busca com ORIG/DEST invertidos
- `from`/`to` aceitam tanto código de cidade (LON) quanto IATA de aeroporto (LHR)
- A página carrega os resultados diretamente da URL, sem interação de formulário
- Sem autenticação / login necessário
- Apenas cash (GBP) — sem pontos/milhas

## Airline key no runner

`airline: "britishairways"` no POST /scrape

## Fluxo de busca

```
searchFlights(params)
  ├── outbound: searchDateRange(origin→dest, outboundStart..outboundEnd, isReturn=false)
  └── se returnStart:
       └── return: searchDateRange(dest→origin, returnStart..returnEnd, isReturn=true)
```

Para cada data no range, navega para a URL e coleta todos os cards da página.

## Contexto do browser

- locale: 'en-GB' (diferente da Azul/LATAM que usam 'pt-BR')
- timezoneId: 'Europe/London'
- Accept-Language: 'en-GB,en;q=0.9'

## Coleta de dados

Estratégia: `page.evaluate` em uma única passagem. Os dados de número de voo estão no DOM
mesmo com o accordion colapsado (`aria-hidden="true"`, mas conteúdo presente no HTML).
Não é necessário clicar em nada (diferente da LATAM que precisa abrir modal).

## Múltiplos cards por voo (comportamento observado 2026-05-05)

BA exibe o mesmo voo de conexão como múltiplos cards com preços distintos (tarifas diferentes
dentro da mesma classe, ex: Economy Saver £670 e Economy Flex £871). Cada card = uma oferta.
Voos diretos aparecem uma única vez. Isso é comportamento correto do site, não bug.

## Resultados confirmados (teste local 2026-05-05)

- LON→GRU, 2026-12-27: 15 voos extraídos
- 1 voo direto (BA247, £642), 14 com conexão
- flightNumbers corretos (BA247, IB1864, IB726, BA458, BA3270, BA7065, IB724, BA249, BA7061)
- Airports: LHR, LGW, LCY (todos Europe/London, timezone OK)
- stops: 0 para diretos, 1 para conexões (texto "1 connection" no DOM)
- GBP amount correto, currency: 'GBP'

## Dev local

- flight.API (192.168.122.1:xxxx) não roda localmente → sendResult sempre falha
- Dados estão corretos em results.json; job marca "failed" apenas por ConnectTimeoutError no callback
