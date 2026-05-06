---
name: British Airways — seletores DOM confirmados
description: Seletores confirmados via snapshot real para scraping da BA (nova UI + velha UI)
type: project
---

## URL de busca

```
https://www.britishairways.com/nx/b/airselect/en/gbr/book/search/?trip=oneWay&departureDate={date}&from={ORIG}&to={DEST}&travelClass=economy&adults={PAX}&youngAdults=0&children=0&infants=0&bound=outbound
```

---

## Nova UI (origem UK — GBP)

### Container de resultados
```
[data-ds-cr-name="Card"]  → cada card de oferta
```

### Dentro de cada Card
```
[data-testid^="offerFlightHeader-"]
  [data-testid$="--departure-airport-code--text-custom"]  → "LHR"
  [data-testid$="--arrival-airport-code--text-custom"]    → "GRU"
  [data-testid$="--deperture-time--text-custom"]  → "21:15"  ← typo "deperture" é do site!
  [data-testid$="--arrival-time--text-custom"]    → "06:00"
  [data-testid$="--flight-duration--text-custom"] → "11 hours 45 minutes"
  [data-testid$="--flight-stops--text-custom"]    → "Direct" | "1 connection" | "2 connections"

[data-testid="travel-class-option-economy"]
  .ds-cr-text-xl  → "£642"

[data-testid="agreement-type"]  → "British Airways • BA 247 • AIRBUS A350-1000"
```

Parsers:
- `parseDurationMin("11 hours 45 minutes")` → 705
- `parseGBP("£642")` → `{ amount: 642, currency: 'GBP' }` em `fares.cash`
- `parseFlightNumber("• BA 247 •")` → "BA247"
- `parseStops("1 connection")` → 1  (BA usa "connection", não "stop")

### Aguardar resultados (nova UI)
```
[data-ds-cr-name="Card"]  → aguardar pelo menos 1 (timeout 60s)
```

---

## Velha UI (origem fora do UK — BRL, confirmado GRU→LON em 2026-05-06)

### Container de resultados
```
.flight-option  → cada itinerário (1 por voo, mesmo para conexões)
```

### Dentro de cada .flight-option
```
[data-cy="flight-origin-details"]       → " 16:25 GRU " (tempo + IATA separados por &nbsp;)
[data-cy="flight-destination-details"]  → " 06:45 LHR "

.stops-and-connections  → "Non-stop" | "1 connection"
.duration-summary       → textContent "11h  hours20m minutes"

Cabines (múltiplos .flight-list-button-wrapper):
  .cabin-name   → "Economy" | "Premium Economy" | "Business"
  .small-price  → " R$3,280 "

Flight details (modal sempre presente no DOM, mesmo colapsado):
  app-flight-details-modal p  (primeiro com "Aircraft:")
  → "Aircraft: BA0246 (Airbus A350 jet)"
  → "Aircraft: G31376 (Boeing 737 jet)"  ← GOL: IATA G3 é alfanumérico!
```

Parsers:
- Origin/dest: `text.trim().replace(/ /g, ' ').split(/\s+/)` → `["16:25", "GRU"]`
- `parseBRL("R$3,280")` → `{ amount: 3280, currency: 'BRL' }` em `fares.cash`
- `parseFlightNumberOld("BA0246 ...")` → "BA246"  (regex `\b([A-Z][A-Z0-9])0*(\d+)`)
- `parseDurationMinOld(durationText)` → regex `/(\d+)\s*h/` e `/(\d+)\s*m/`
- `parseStops("Non-stop")` → 0  (detecta por `/direct|non.?stop/i`)

### Aguardar resultados (velha UI)
```
.flight-option  → aguardar pelo menos 1
```

---

## Aeroportos observados

- LHR (London Heathrow) — Europe/London
- LGW (London Gatwick) — Europe/London
- LCY (London City) — Europe/London
- GRU (São Paulo Guarulhos) — America/Sao_Paulo
- CGH (São Paulo Congonhas) — pode aparecer como origem em conexões GOL
- GIG (Rio de Janeiro Internacional) — ponto de conexão em itinerários GOL+BA
