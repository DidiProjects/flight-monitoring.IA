---
name: Ryanair — arquitetura do scraper
description: Fluxo, URL, decisões e estado atual do scraper da Ryanair
type: project
---

## Stack

Mesmo da BA/LATAM: camoufox-js + playwright Firefox + DOM scraping.
Arquivo: `src/scrapers/ryanair.ts`

## URL de busca

```
https://www.ryanair.com/gb/en/trip/flights/select?adults={PAX}&teens=0&children=0&infants=0&dateOut={YYYY-MM-DD}&dateIn=&isConnectedFlight=false&discount=0&promoCode=&isReturn=false&originIata={ORIG}&destinationIata={DEST}&tpAdults={PAX}&tpTeens=0&tpChildren=0&tpInfants=0&tpStartDate={YYYY-MM-DD}&tpEndDate=&tpDiscount=0&tpPromoCode=&tpOriginIata={ORIG}&tpDestinationIata={DEST}
```

- Sempre `isReturn=false` — para volta, refaz a busca com ORIG/DEST invertidos
- Usa o site UK (`/gb/en/`) que retorna preços em EUR para rotas intra-europeias
- A página é uma Angular SPA que carrega cards via XHR após o load inicial

## Airline key no runner

`airline: "ryanair"` no POST /scrape

## Fluxo de busca

```
searchFlights(params)
  ├── outbound: searchDateRange(origin→dest, outboundStart..outboundEnd, isReturn=false)
  └── se returnStart:
       └── return: searchDateRange(dest→origin, returnStart..returnEnd, isReturn=true)
```

## Contexto do browser

- locale: 'en-GB', timezoneId: 'Europe/London', viewport: 1440×900
- Accept-Language: 'en-GB,en;q=0.9'
- headless: true (camoufox bypass funciona em headless para Ryanair)

## Coleta de dados

Estratégia: `page.evaluate` em única passagem após `waitForCards`.
Sem interação de clique necessária — todos os dados estão no DOM inicial.

## Particularidades

- **IATA extraído do data-ref**: `[data-ref^="origin-airport__NAP"]` → split `__` → "NAP"
- **Número do voo no data-ref**: `[data-ref="FR 1316"]` no `.card-flight-num__content`
- **Preço**: `[data-e2e="flight-card-price"]` → texto "€89.99"
- **Stops**: Ryanair opera apenas voos diretos (stops=0 fixo). Sem conexões no scraper atual.
- **Currency**: EUR para rotas intra-EU via `/gb/en/`, GBP para rotas UK (possível variação)
- **Sem cookie popup**: camoufox não precisa dismissar cookie banner da Ryanair

## Resultados confirmados (teste local 2026-05-05)

- NAP→LIS, 2026-06-25: 1 voo (FR1316, NAP 09:25 → LIS 11:45, 200min, €89.99)
- IATA corretos extraídos do data-ref
- Timestamps com timezone correto (NAP=Europe/Rome +02:00, LIS=Europe/Lisbon +01:00)
- flightNumber normalizado: "FR 1316" → "FR1316"

## Comportamento de carregamento

- Angular SPA: page.waitForLoadState('networkidle') + humanDelay 1.5-2.5s antes de waitForCards
- waitForCards timeout: 45s (suficiente, Ryanair carrega em ~3-8s)
- Ryanair pode ter 0 cards (data sem voos) ou N cards (diretos na rota)
