---
name: British Airways — seletores DOM confirmados
description: Seletores confirmados via snapshot real para scraping da BA
type: project
---

## URL de busca

```
https://www.britishairways.com/nx/b/airselect/en/gbr/book/search/?trip=oneWay&departureDate={date}&from={ORIG}&to={DEST}&travelClass=economy&adults={PAX}&youngAdults=0&children=0&infants=0&bound=outbound
```

## Container de resultados

```
[aria-live="assertive"]  → seção raiz dos resultados
  <h2>1 direct flight</h2>       → separador de diretos
  <h2>14 connecting flights</h2> → separador de conexões
  [data-ds-cr-name="Card"]       → cada card de oferta (role="region")
```

## Dentro de cada Card

### Header (inclui info de voo E opções de cabine)
```
[data-testid^="offerFlightHeader-"]
  Direto:    offerFlightHeader-direct-{i}
  Conexão:   offerFlightHeader-indirect-{i}
```

### IATA de saída e chegada
```
[data-testid$="--departure-airport-code--text-custom"]  → ex: "LHR"
[data-testid$="--arrival-airport-code--text-custom"]    → ex: "GRU"
```
(prefixo "undefined--" confirmado como padrão real do site)

### Horários
```
[data-testid$="--deperture-time--text-custom"]  → ex: "21:15"  (typo "deperture" é do site)
[data-testid$="--arrival-time--text-custom"]    → ex: "06:00"
```

### Duração
```
[data-testid$="--flight-duration--text-custom"]  → ex: "11 hours 45 minutes"
```
Parser: `parseDurationMin("11 hours 45 minutes")` → 705

### Stops / conexões
```
[data-testid$="--flight-stops--text-custom"]
  "Direct"       → 0 stops
  "1 connection" → 1 stop   ← ATENÇÃO: BA usa "connection" não "stop"
  "2 connections" → 2 stops
```

### Preço Economy
```
[data-testid="travel-class-option-economy"]
  .ds-cr-text-xl  → ex: "£642"
```
Parses: `parseGBP("£642")` → `{ amount: 642, currency: 'GBP' }` em `fares.brl`

### Número do voo (accordion — content no DOM mesmo colapsado)
```
[data-testid="agreement-type"]  → ex: "British Airways • BA 247 • AIRBUS A350-1000"
```
Parser: `parseFlightNumber("British Airways • BA 247 • AIRBUS A350-1000")` → "BA247"

## Aguardar resultados (waitForCards)

```
[data-ds-cr-name="Card"]  → aguardar pelo menos 1 (timeout 60s)
```
Texto de "sem resultados": `/no flights|no results|unavailable|0 flights/i`

## Aeroportos observados

- LHR (London Heathrow) — Europe/London
- LGW (London Gatwick) — Europe/London  
- LCY (London City) — Europe/London
- LON (city code de Londres, usado na URL mas não aparece nos cards)
