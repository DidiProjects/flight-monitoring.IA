---
name: LATAM — seletores DOM confirmados
description: Seletores data-testid confirmados via DevTools para scraping da LATAM, BRL e pontos
type: project
---

## URL de busca

```
BRL:    https://www.latamairlines.com/br/pt/oferta-voos?origin={ORIG}&outbound={DATE}T00%3A00%3A00.000Z&destination={DEST}&inbound=null&adt={PAX}&chd=0&inf=0&trip=OW&cabin=Economy&redemption=false&sort=RECOMMENDED
Pontos: idem com redemption=true
```

## Cookies

```html
<button data-testid="cookies-politics-button--button">Aceite todos os cookies</button>
```

## Modal de sugestão de país (só fora do Brasil)

Aparece ao acessar o site com IP estrangeiro. Clicar em "Continuar na LATAM Brasil":
```html
<button data-testid="country-suggestion-reject-change--button">Continuar na LATAM Brasil</button>
```
Dispensado automaticamente pelo scraper após cada navegação (no-op se não aparecer).

## Cards de voo (índice i = 0, 1, 2, ...)

### Header do card
```
[data-testid="wrapper-card-header-{i}"]   role="button"
```

### Origem
```
[data-testid="flight-info-{i}-origin"]
  :scope > span[0]   → horário de partida "11:25"
  :scope > span[1]   → IATA origem "GRU"
```

### Duração
```
[data-testid="flight-info-{i}-duration"]
  span[0]  → label "Duração"
  span[1]  → "1 h 10 min."
```

### Destino
```
[data-testid="flight-info-{i}-destination"]
  :scope > span[0]  → horário chegada "12:35" (1º text node — ignorar span interno "+1 dia")
  :scope > span[1]  → IATA destino "CNF"
```

### Footer do card
```
[data-testid="footer-card-{i}"]
```

### Paradas (dentro do footer)
```
[data-testid="itinerary-modal-{i}-details-anchor--link"] > span
  "Direto"   → 0 paradas
  "1 parada" → 1 parada
```

### Preço BRL (dentro do flight-info-{i}-amount)
```
[data-testid="flight-info-{i}-amount"] [aria-hidden="true"]
  texto: "brl 538,54" ou "brl 3.833,64"
```

### Preço pontos (dentro do footer, modo redemption=true)
```
[data-testid="footer-card-{i}"] [data-testid="loyalty-points-wrapper"]
  .displayAmount span → "15.778 milhas"
  NOTE: o "+ BRL 33,64" é descartado (taxa fixa, não modelamos híbrido na LATAM)
```

## Login (pontos)

```html
<!-- CPF -->
<input data-testid="form-input--alias-textfield-input" placeholder="Email, CPF ou Número de cliente">

<!-- Botão Continuar -->
<button data-testid="primary-button-button">Continuar</button>

<!-- Senha -->
<input data-testid="form-input--password-textfield-input" placeholder="Senha">

<!-- Botão Fazer login -->
<button data-testid="primary-button-button">Fazer login</button>
```

## Flight number

**Não disponível no card visível.** O número real (ex: "LA3455") estaria no modal de detalhes do itinerário (`itinerary-dialog-wrapper`), mas não foi observado.

**Implementação atual:** número sintético `LA{IATA_ORIGEM}{HHMM}` — ex: "LAGRU1125".
Serve como chave de deduplicação dentro de uma run. **Não é o número real do voo.**
