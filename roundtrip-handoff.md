# Round-Trip — Onde Paramos

> Estado em **2026-07-24**, fim da sessão. Continuação do `roundtrip-design.md`.
> Tudo descrito aqui está **commitado e pushado**.

---

## 1. Situação em uma frase

A Fase 1 (ida-e-volta como UMA rotina) está **completa e validada**. A coleta
passou de perna avulsa para **par de datas**, e a busca RT real na Azul funciona.
Falta ligar o **laço 1-para-N** das voltas e tratar a **volta indefinida**.

---

## 2. Commits desta sessão

| Repo | Branch | Commit | PR |
|------|--------|--------|-----|
| flight.DB | `feat/roundtrip-analysis` | `bad6a40` | [#3](https://github.com/DidiProjects/flight.DB/pull/3) → develop |
| flight.API | `feat/roundtrip-analysis` | `38d09ce` | [#22](https://github.com/DidiProjects/flight.API/pull/22) → develop |
| flight.FRONT | `feat/roundtrip-analysis` | `0aee530` | [#11](https://github.com/DidiProjects/flight.FRONT/pull/11) → develop |
| scraping.API | `feat/roundtrip-experiment` | `5c6af80` | PR aberto → develop |
| flight-monitoring.IA | `feat/roundtrip-analysis` | `91e5c59` | [#1](https://github.com/DidiProjects/flight-monitoring.IA/pull/1) → **main** (não tem develop) |

Migrations aplicadas **só no banco local**. Produção intocada.

---

## 3. O que está pronto

### Banco (migrations 001–009)
- `001`–`005`: convergência de schema (havia drift nos dois sentidos)
- `006`: `routines.trip_type` + `inbound_start`/`inbound_end`
- `007`: `scraping_jobs.return_date` + chave `UNIQUE NULLS NOT DISTINCT`;
  `flight_fares.return_date` + `bundle_*`; `analysis_runs.return_date`
- `008`: `airlines.has_roundtrip` (só Azul)
- `009`: `flight_fares.paired_outbound_flight` — a coluna do 1-para-N, **criada
  mas ainda não preenchida por ninguém**

### flight.API
- Jobs de RT derivados do produto cartesiano das janelas (`ib >= ob`, teto 3 meses)
- `getLatestByRoute` com filtro de par **obrigatório** (`null` = só avulsa)
- `getCurrentBest` / `getPriceByDate` também filtram (tinham o mesmo vazamento)
- `getLatestPairs` + avaliação com `min(bundle, soma)`
- `return_date` carimbado **a partir do job**, não do callback
- Total do par no `/fares/current`, no e-mail e no resumo agendado
- Deep link vira busca ida-e-volta
- 93 testes

### scraping.API
- `buildSearchUrl` monta `c[1]`; `searchFlights` faz UMA busca RT
- Perna decidida **por card** (IATA invertido), com a data de volta correta
- `src/scrapers/azulRoundTrip.ts` — módulo do fluxo 1-para-N, **pronto mas não
  ligado**
- 53 testes

### flight.FRONT
- Ida-e-volta vira UMA rotina (antes criava duas e queimava 2 das 10 vagas)
- Card mostra `GRU ✈ CNF ✈ GRU`, datas "Ida"/"Volta" e pede o total do par
- 42 testes

---

## 4. O que falta — em ordem

### 4.1 Ligar o laço 1-para-N (scraping.API)

**O modelo:** as voltas são precificadas **no contexto da ida escolhida**. Não
existe "a lista de voltas" — existe uma lista por ida. É por isso que o desconto
RT pode existir.

O módulo `azulRoundTrip.ts` já tem as quatro peças (`readSectionCards`,
`openReturnsForOutbound`, `ensureOnlyPoints`, `backToOutbound`).

**O que trava:** o parsing de preço, duração e número do voo vive **inline dentro
do `collectAllFares`** (`src/scrapers/azul.ts`). Precisa ser extraído para poder
ser reusado no laço.

Passos:
1. Extrair o parsing card→`FlightOffer` do `collectAllFares` para uma função própria
2. Escrever `collectRoundTripFares`: lê idas da 1ª section → para cada ida,
   `openReturnsForOutbound` → parseia voltas → `backToOutbound`
3. `FlightOffer` ganha `pairedOutboundFlight`; preencher nas voltas
4. Propagar pelo contrato até `toFareRows` no flight.API (a coluna já existe)
5. Avaliação passa a agrupar por **ida**, não por data:
   `total(O) = tarifa(O) + min(tarifa(R) : R.paired_outbound_flight = O)`

**Atenção:** a 2ª `section.card-list` traz 2 voltas de prévia que **não são
necessariamente as melhores**. Ignorar. Foi o erro da primeira implementação.

### 4.2 Volta indefinida (decisão pendente + implementação)

Em **pontos**, ao selecionar a tarifa a Azul abre modal de login do programa de
fidelidade e a volta fica inacessível.

**Conflito a resolver:** a decisão de 2026-07-24 (§5 do design) diz que par com
uma perna só é **descartado** e reportado ao Grafana (`IncompleteRoundTripError`,
já implementado). O pedido novo é **tolerar** e exibir "-".

Reconciliação proposta:

| Situação | Tratamento |
|---|---|
| Volta indisponível por limitação conhecida (pontos/login) | tolera, exibe "-", **não** reporta |
| Volta sumiu sem motivo (fallback one-way, DOM mudou) | descarta + Grafana, como hoje |

**Ponto crítico, ainda não decidido:** se a volta é desconhecida, o preço da ida
**não é o preço da viagem**. Comparar só a ida contra o `target_cash` dispararia
alerta num valor que não existe ("achamos por R$ 365" quando a viagem custa
R$ 931+).

Recomendação: par incompleto **exibe mas não alerta**. Se for para alertar, o
e-mail precisa dizer "volta não disponível — valor parcial".

### 4.3 O gargalo (só estudar)

- Rotina RT com janela 30×30 dias → **900 jobs** (contra 60 no modelo por perna)
- Cada job agora exige **N navegações** (uma por ida) com `goBack` entre elas
- Tudo isso com `batch=1` e IP único

Ideias não avaliadas: limitar a janela de RT, capar pares por rotina, priorizar
só as datas mais promissoras.

---

## 5. Decisões de produto já fechadas (2026-07-24)

- **Max-stay: 3 meses** entre ida e volta. Constante da aplicação
  (`MAX_ROUNDTRIP_SPAN_MONTHS` em `flight.API/src/utils/roundtrip.ts`), não é
  coluna nem configurável por rotina.
- **Mesma companhia** nas duas pernas — só assim o desconto é identificável.
  Rotina RT exige `airlines.has_roundtrip` (hoje só Azul).
- **Mesma moeda** nas duas pernas; par com moedas diferentes não é avaliado.
- **Furo 2** do `target-alert-ajustes.md`: manter o comportamento atual do
  `cleanupPastDates`. Fechado, sem código.

---

## 6. Armadilhas que já custaram caro

1. **`__name is not defined`** — nada de função nomeada dentro de `page.evaluate`.
   Atribuir arrow a `const` **também conta** como nomear. Usar inline puro.
   (Está no `CLAUDE.md` do scraping.API; ainda assim tropecei duas vezes.)
2. **IP bloqueado pela Azul** — "Ops! Só um momento. Identificamos um
   comportamento incomum vindo do seu IP." Validação real do scraper depende de
   rodar de onde o acesso está liberado. Não insistir em tentativas.
3. **PATCH parcial** devolvia 500 (bug pré-existente, corrigido): `undefined` =
   não tocar, `null` explícito = limpar.
4. **`NULL != NULL`** em UNIQUE: sem `NULLS NOT DISTINCT`, cada job one-way
   viraria linha nova a cada upsert.
5. **Migration/edição que "aplicou" sem aplicar** — um script abortou num assert
   antes de gravar e o ramo de par nunca chegou ao arquivo. Só apareceu na
   validação end-to-end. **Sempre conferir o resultado, não o log do script.**

---

## 7. Fase 0 e Fase 2

A Fase 0 (medir se o preço é decomponível) **nunca foi rodada** formalmente, mas
a sessão descobriu empiricamente o que ela buscava: URL, seletores e o fluxo
1-para-N. O que continua desconhecido é o **total consolidado do par (bundle)** —
`flight_fares.bundle_*` existe e está sempre nulo.

Enquanto isso a avaliação usa a **soma das duas pernas da mesma busca RT**, que é
o fallback correto do `min(bundle, soma)`. Não captura desconto, mas nunca mistura
com tarifa avulsa.

---

## 8. Como retomar

1. Ler este arquivo e `roundtrip-design.md`
2. Ler `scraping.API/memory/azul/dom-structure.md`, seção **"Busca ida-e-volta (RT)"**
   — todos os seletores confirmados estão lá
3. Subir a stack: `docker compose up -d` em flight.DB e flight.API;
   `npm run dev` em scraping.API e flight.FRONT
4. Começar por **4.1**, que destrava o resto
