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

## Flight number (modal de itinerário)

Obtido clicando no anchor de paradas e lendo o modal:

```
Abrir:   [data-testid="itinerary-modal-{i}-details-anchor--link"]
Número:  [data-testid="incoming-outcoming-title"] [data-testid="airline-wrapper"]
           → text node após o <span> de imagem, ex: "LA3344"
Fechar:  [data-testid="itinerary-modal-{i}--dialog-close-button"]   (duplo hífen antes de "dialog")
```

Para voos com escalas o modal tem múltiplos `incoming-outcoming-title`. Usamos o primeiro (voo da origem).

### Estado do clique no anchor (2026-04-28)
Clique via `page.evaluate` + `.click()` nativo funcionando. Playwright locator dava TimeoutError (elemento estava dentro de footer colapsado). Solução definitiva: usar DOM nativo dentro de `page.evaluate`.

## Login 2FA (verificação de novo navegador)

Após inserir CPF + senha, pode aparecer um modal solicitando código de verificação por WhatsApp/Email/SMS.

### Detecção
```
[data-testid="radio-group-channels-radio-group"]  → modal de 2FA presente
[data-testid="wrapper-card-header-0"]             → passagens carregaram (login OK)
```
Aguardar 15s por qualquer um dos dois após clicar em login.

### Fluxo 2FA
```
1. Clicar radio Email:   [data-testid="radio-EMAIL-radio"]
2. Clicar Enviar código: [data-testid="form-button--primaryAction-button"]
3. Aguardar campo:       [data-testid="form-input--code-0-textfield-input"]
4. Ler código de:        {process.cwd()}/authorization-code.json  → { "code": 123456 }
   - 5 tentativas × 10s cada
   - Se não obtiver: abandona busca de pontos
5. Clicar no campo code-0 e digitar os 6 dígitos via keyboard.type
6. Clicar Enviar código: [data-testid="form-button--primaryAction-button"]
7. Aguardar 15s por [data-testid="wrapper-card-header-0"]
```

### Campos do código (6 dígitos separados)
```
[data-testid="form-input--code-0-textfield-input"]  ← clicar aqui e digitar sequencialmente
[data-testid="form-input--code-1-textfield-input"]
...
[data-testid="form-input--code-5-textfield-input"]
```
O foco avança automaticamente entre campos ao digitar — basta clicar no primeiro e usar `keyboard.type`.
