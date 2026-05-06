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

## Duas UIs distintas (comportamento confirmado 2026-05-06)

BA serve UIs diferentes dependendo do aeroporto de ORIGEM:

| Origem       | UI        | Moeda | Seletor de card           |
|--------------|-----------|-------|---------------------------|
| UK (LON/LHR) | Nova (Angular DS) | GBP £ | `[data-ds-cr-name="Card"]` |
| BR (GRU/CGH) | Velha (Angular)   | BRL R$ | `.flight-option`           |

O scraper detecta automaticamente qual UI está ativa via `waitForCards` + `extractCards`.

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
mesmo com o accordion/modal colapsado, conteúdo presente no HTML.
Não é necessário clicar em nada (diferente da LATAM que precisa abrir modal).

## Múltiplos cards por voo (nova UI)

BA exibe o mesmo voo de conexão como múltiplos cards com preços distintos (tarifas diferentes
dentro da mesma classe, ex: Economy Saver £670 e Economy Flex £871). Cada card = uma oferta.
Voos diretos aparecem uma única vez. Isso é comportamento correto do site, não bug.

## Resultados confirmados (2026-05-06)

### LON→GRU (nova UI, GBP)
- 17 datas (04–20 dez/26): 255 voos extraídos (~15/data)
- flightNumbers: BA247, IB1864, IB726, BA458, etc.
- currency: 'GBP'

### GRU→LON (velha UI, BRL)
- 3 datas (19–21 fev/27): 60 voos extraídos (20/data)
- BA246 direto GRU→LHR, 11h20min, R$3,280
- IB268 conexão via MAD, 14h15m, R$3,127
- currency: 'BRL'
- Codeshares GOL (G3) também aparecem — IATA code `G3` é alfanumérico

## Dev local

- flight.API (192.168.122.1:xxxx) não roda localmente → sendResult sempre falha
- Dados estão corretos em results.json; job marca "failed" apenas por ConnectTimeoutError no callback
