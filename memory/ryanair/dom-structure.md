---
name: Ryanair — seletores DOM confirmados
description: Seletores confirmados via snapshot real (NAP→LIS 2026-06-25) para scraping da Ryanair
type: project
---

## URL de busca

```
https://www.ryanair.com/gb/en/trip/flights/select?isReturn=false&originIata={ORIG}&destinationIata={DEST}&dateOut={YYYY-MM-DD}&adults={PAX}&...
```

## Card container

```
[data-ref="flight-card_all_information"]   → um elemento por voo
  também: data-e2e="flight-card--outbound"
  elemento: <flight-card-new> (Angular component)
```

## Dentro de cada card

### Horário de partida
```
[data-ref="flight-segment.departure"] .flight-info__hour  → "09:25"
```

### IATA de origem
```
[data-ref^="origin-airport__"]  → atributo data-ref = "origin-airport__NAP"
  iata = data-ref.split('__')[1]  → "NAP"
```

### Horário de chegada
```
[data-ref="flight-segment.arrival"] .flight-info__hour  → "11:45"
```

### IATA de destino
```
[data-ref^="destination-airport__"]  → atributo data-ref = "destination-airport__LIS"
  iata = data-ref.split('__')[1]  → "LIS"
```

### Duração
```
[data-ref="flight_duration"]  → "3h 20m"
```
Parser: "3h 20m" → 200min via regex `/(\d+)\s*h/` e `/(\d+)\s*m/`

### Número do voo
```
.card-flight-num__content[data-ref]
  atributo data-ref É o número do voo: "FR 1316"
  normalizado: "FR 1316".replace(/\s+/g, '') → "FR1316"
```

### Preço (preço atual de venda, pode ser com desconto)
```
[data-e2e="flight-card-price"]  → textContent → "€89.99"
```
- Preço antigo riscado fica em `.flight-card-summary__old-value` (NÃO tem data-e2e)
- Parser: extrair número do texto, `€` → currency 'EUR', `£` → 'GBP'

### Stops
Ryanair opera apenas voos diretos. Não há elemento de stops no DOM.
Valor fixo: stops=0

## Aguardar resultados

```
[data-ref="flight-card_all_information"]  → aguardar 1+ (timeout 45s)
[data-ref="no-flights-container"]         → sem voos disponíveis
```

## Aeroportos confirmados

- NAP (Naples) → Europe/Rome
- LIS (Lisbon) → Europe/Lisbon

## Observações

- Site Angular (SPA): dados carregados via XHR após DOM inicial
- Sem cookie banner a dismissar (camoufox lida automaticamente)
- HTML encoda preço em UTF-8: `\xe2\x82\xac` = `€` (Euro sign U+20AC)
