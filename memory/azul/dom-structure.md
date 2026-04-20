---
name: Estrutura DOM real do site da Azul — seletores confirmados
description: HTML exato dos elementos interativos descobertos via DevTools/snapshots
type: project
---
Todos os seletores abaixo foram confirmados via HTML real do site.

## Formulário de busca

**Origem:**
```html
<input placeholder="Digite" role="combobox" aria-label="Origem" data-cy="autocomplete-desktop-input" class="sc-hIUJlX hXJaFA">
```
- Clicar → digitar código do aeroporto (ex: "VCP")
- Autocomplete aparece como `button[role="option"][data-cy^="autocomplete-options-item"]`
- Clicar no button que contém o código dentro de `<b>` (ex: `<b>VCP</b>`)

**Destino:**
```html
<input placeholder="Digite" role="combobox" aria-label="Destino" data-cy="autocomplete-desktop-input">
```
- Mesmo fluxo da origem

**Campo de datas:**
```html
<input placeholder="Selecione" aria-label="Datas (Ida e volta)" class="sc-hIUJlX hXJaFA" value="">
```
- Clicar nele → digitar data como DDMMYYYY (apenas números, sem separadores)
- Ex: 10/05/2026 → digitar "10052026"
- NÃO abre modal separado — digita diretamente no input
- Após digitar → clicar "Buscar passagens" diretamente (sem confirmar datas)

**Botão buscar:**
```html
<button type="button" class="sc-eqUAAy iNxtop sc-lnrzcU iouhCu sc-gEvEer iSglkT">Buscar passagens</button>
```
- Sempre visível no formulário principal
- Clicar após preencher origem, destino e data

## Página de resultados

**Indicador de carregamento completo:**
```html
<p class="results">10 voos encontrados</p>
```

**Estado vazio (nenhum voo disponível):**
```html
<p class="css-1wdbheb">Parece que não temos voos disponíveis para a data selecionada </p>
```
- Detectar com `p.css-1wdbheb` + regex `/não temos voos|voos dispon/i`
- Tratar como resultado vazio — NÃO lançar erro, apenas logar e pular a data

**Carrossel de datas (booking-calendar):**
```html
<div class="booking-calendar__cards css-77i9f">
  <button aria-label="sex  01/05 valor da menor tarifa do dia , selecionar" class="css-17h89v5">
    <span>sex  01/05</span>
    <span class="item-value"></span>
  </button>
  ...
</div>
```
- Navegar por data clicando no button cujo `aria-label` contém "DD/MM"
- Ex: para 27/05 → click button com aria-label contendo "27/05"

**Toggle de moeda:**
```html
<button aria-label="Pontos" value="score">Pontos</button>
<button aria-label="Reais" value="currency">Reais</button>
```

## Inputs com opacity:0 (styled-components)

Origem, Destino e Datas são inputs com CSS `opacity:0` — não são "visíveis" pelo Playwright.
Solução: usar `page.mouse.click(x, y)` com coords reais via `getBoundingClientRect()` do container.

## tsx/esbuild + page.evaluate — ATENÇÃO

tsx 4.x compila com `keepNames: true` → adiciona `__name(fn, "nome")` em funções nomeadas.
Quando `page.evaluate(() => { function walk() {} })` é serializado, o browser não encontra `__name` → erro.

**Regra:** NUNCA usar `function nomeFuncao()` dentro de callbacks de `page.evaluate` ou `page.waitForFunction`.
Usar abordagem iterativa com stack/array ou lambdas anônimas sem nome.

## rebrowser-playwright — race condition de contexto

rebrowser-playwright injeta código próprio (também compilado com `__name`) na inicialização do contexto de página.
Se a navegação destruir o contexto antes da inicialização terminar → `__name is not defined` nos primeiros `page.evaluate`.

**Solução:** `waitForEvalReady()` — retenta `page.evaluate(() => true)` em loop até o contexto estabilizar antes de qualquer evaluate.
