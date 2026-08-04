# Moeda: a do site é a única verdade, e o alvo é sempre em Real

> Proposta de arquitetura para acabar com a moeda inventada: a moeda passa a vir
> **só do scraping**, é obrigatória, é guardada e exibida **por trajeto**, e o
> alvo da rotina passa a ser **sempre em Real**, com conversão feita por nós.
>
> Data: 2026-08-04 · Escopo: `scraping.API`, `flight.DB`, `flight.API`, `flight.FRONT`
> Status: 🟡 proposta
>
> **Restrição do pedido:** sem tabela nova. Ver §6 — a conversão mora em colunas
> da própria `flight_fares`, e a cotação do dia vive em cache de memória.

---

## 1. O problema, com os números que o motivaram

A moeda da rotina hoje é **deduzida** de cadastro (`airlines.currency` →
`flight_fares` já coletadas → `airports.currency`), e o cadastro está errado:

| companhia | moedas cadastradas em `airports` | consequência |
|---|---|---|
| britishairways | **GBP nos 1192**, inclusive os 46 no Brasil | rotina GRU→LHR marcada GBP, tarifas chegam em BRL |
| latam | **BRL nos 1509**, inclusive LHR e DUB | espelho do mesmo erro |
| ryanair / azul / gol | por país | ok |

E há um segundo eixo, que **não é erro**: cada site precifica na moeda do
mercado de **onde a busca parte**, e numa busca ida-e-volta as duas pernas são
vendidas numa compra só, no mercado de quem parte. Por isso a mesma perna
aparece duas vezes, legitimamente:

| perna | moeda | de onde veio |
|---|---|---|
| BA LHR→GRU 25/09 | **£ 730** | rotina só-ida partindo de Londres (mercado UK) |
| BA LHR→GRU 25/09 | **R$ 7.627** | a volta da busca RT que parte de GRU (mercado BR) |
| Ryanair DUB→STN 25/09 | **€ 17,99** | rotina só-ida partindo de Dublin |
| Ryanair DUB→STN 25/09 | **£ 17,99** | a volta da busca RT que parte de Stansted |

Estado atual dos dados (dev, 2026-08-04): 279 linhas em `flight_fares`, 3 moedas
(BRL 237, GBP 33, EUR 9), **nenhuma nula**. A troca de regime é barata agora.

### Onde a moeda é inventada hoje

| lugar | o que faz | vira o quê |
|---|---|---|
| `scraping.API` · `ResultSender.toCallbackOffer` | `currency` sai de cash ?? points ?? hybrid, pode ser `undefined` | some silenciosamente |
| `flight.API` · `modules/scrape/schema.ts` | `currency` é `.optional()` | aceita oferta sem moeda |
| `flight.DB` · `best_fares.currency` | `NOT NULL DEFAULT 'BRL'` | carimba Real no que não é |
| `flight.API` · `NotificationsService:137,225` | `?? routine.currency ?? 'BRL'` | e-mail com moeda errada |
| `flight.API` · `RoutinesService.resolveCurrency` | deduz de cadastro | a origem do erro da tabela acima |
| `flight.FRONT` · `RoutineCard:56` | `c.currency ?? routine.currency`, **uma moeda para as duas pernas** | ida e volta formatadas na mesma moeda |
| `flight.FRONT` · `RoutineForm:280-285` | deriva a moeda do alvo de companhia/aeroporto | alvo numa moeda que a coleta não usa |

---

## 2. As decisões

1. **A moeda vem do scraping e de mais lugar nenhum.** Cadastro
   (`airports.currency`, `airlines.currency`) deixa de alimentar exibição e
   avaliação.
2. **Moeda é obrigatória.** Tarifa sem moeda legível é **descartada na
   `scraping.API`**, com contagem e log. Não sobe pelo webhook.
3. **A moeda é guardada e exibida por trajeto.** Ida na moeda dela, volta na
   moeda dela — nunca uma moeda só para o par.
4. **O alvo é sempre em Real.** Máscara fixa em R$ no formulário. Nós
   convertemos cada perna e somamos para comparar.
5. **A conversão é registrada.** Guardamos o valor convertido, a taxa e a data
   da taxa junto da tarifa. Preço histórico não se reescreve quando o câmbio
   muda.

> **Fica fora, por decisão:** escolher companhia/moeda pelo usuário
> automaticamente. É o futuro que você descreveu; este plano só prepara o
> terreno (alvo já normalizado em BRL).

### Decisões fechadas em 2026-08-04

| # | decisão |
|---|---|
| 1 | **Frankfurter pública**, sem auto-hospedar. Reavaliar por demanda. |
| 2 | **`airlines.currency` é apagada.** `airports.currency` fica parada (sem consumo). |
| 3 | **Gráfico de histórico por moeda**, com **uma curva por perna** quando a rotina é ida-e-volta. Nada de série convertida. |
| 4 | **A conversão vive só no pipeline de decisão.** A camada de exibição nunca converte — ver §5.5. |
| 5 | **O par de moedas diferentes fica como está, sem total somado.** O card mostra as duas pernas, cada uma na sua moeda, e não inventa uma linha de total. O total em Real aparece só no e-mail de alvo, porque lá ele é o número que disparou o alerta. |

---

## 3. Conversão de moeda — qual API usar

Testei as três contra a rede, hoje, com o par que nos interessa.

### Recomendada: **Frankfurter** — primária

```
GET https://api.frankfurter.dev/v1/latest?base=GBP&symbols=BRL
→ {"amount":1.0,"base":"GBP","date":"2026-08-03","rates":{"BRL":6.8261}}
```

- **Open source e auto-hospedável com Docker** — o argumento decisivo: se o
  serviço público sair do ar ou mudar de política, sobe-se o nosso.
- **Sem chave, sem cadastro, sem cota** (só rate-limit anti-abuso).
- Dados de referência do **BCE**. 30 moedas na v1 — confirmei que **BRL, GBP e
  EUR estão lá**, que é exatamente o nosso conjunto.
- Histórico por data (`/v1/2026-08-03?base=GBP`) — importante para reprocessar
  uma coleta antiga com a taxa do dia dela.
- ⚠ Publica em **dias úteis**, uma vez ao dia (16h CET). Fim de semana e feriado
  repetem a última. Para alvo de passagem isso é irrelevante; para trading não
  serviria.

### Reserva: **@fawazahmed0/exchange-api** (jsDelivr)

```
GET https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/gbp.json
```

- Sem chave, 200+ moedas, servido por CDN com fallback entre origens.
- Ativo (releases em julho/2026).
- Entra como **fallback** quando a Frankfurter não responde — não como primária,
  porque depende de CDN de terceiro e não temos como subir uma cópia.

### Referência oficial para o Real: **PTAX / Banco Central**

```
GET https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/
    CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)?@moeda='GBP'&@dataCotacao='07-31-2026'&$format=json
→ cotacaoCompra 6.8032 · cotacaoVenda 6.8060 · "Abertura"
```

- É a taxa **oficial brasileira**. Só 10 moedas — mas são AUD, CAD, CHF, DKK,
  **EUR**, **GBP**, JPY, NOK, SEK, USD, ou seja, cobre tudo que raspamos.
- ⚠ Só dias úteis, e há **vários boletins por dia**: usar o de
  `tipoBoletim = 'Fechamento'`, não o de abertura que o exemplo acima devolveu.

**Recomendação:** Frankfurter como primária (com plano de auto-hospedar),
fawazahmed0 como fallback, PTAX guardado como a fonte a citar se algum dia for
preciso justificar um número para alguém de fora. Um `FxRateProvider` com os
três atrás da mesma interface, escolhido por env.

---

## 4. Modelo: a entidade trajeto

Hoje o par vive em **8 campos achatados** no `CurrentPrice`
(`bestCashOutbound`, `bestCashInbound`, `bestPtsOutbound`, … ), e a moeda é uma
só para todos. Não cabe mais moeda por perna sem virar 12 campos.

Proposta — o trajeto vira objeto, dentro da entidade que já existe:

```ts
interface Leg {
  direction: 'outbound' | 'inbound'
  origin: string            // GRU
  destination: string       // LHR
  date: string              // 2026-09-21
  currency: string          // BRL — sempre presente, sempre do site
  cash: number | null
  pts: number | null
  hybPts: number | null
  hybCash: number | null
  cashBrl: number | null    // projeção para comparação/soma
  fxRate: number | null     // 1 quando currency = BRL
  fxDate: string | null
}

interface CurrentPrice {
  legs: Leg[]               // 1 em só-ida, 2 em ida-e-volta
  totalCashBrl: number | null   // soma das pernas, já em Real
  mixedCurrency: boolean        // as pernas vieram em moedas diferentes
  // … campos de histórico que já existem
}
```

Os 8 campos achatados saem. `routines.currency` deixa de ser fonte de exibição.

---

## 5. Mudanças por projeto

### 5.1 `scraping.API` — a moeda nasce aqui

| arquivo | mudança |
|---|---|
| `src/services/result/ResultSender.ts` | `toCallbackOffer` passa a **descartar** oferta com `fareCash` e sem `currency`. Contar e logar (`descartadas_sem_moeda`) — descarte silencioso é o que não pode acontecer. |
| `src/types/index.ts` | comentar que `Fare.currency` é obrigatório de fato, não só de tipo |
| `src/scrapers/*.ts` | auditar cada um: a moeda tem que sair do **texto do preço**, não de constante. A Ryanair já faz (`parseCurrency` lê € / £ / $). A BA fixa `'GBP'`/`'BRL'` por UI — aceitável porque a UI **é** o mercado, mas precisa de comentário dizendo isso. |
| testes | um por scraper: preço sem símbolo reconhecível ⇒ oferta fora |

### 5.2 `flight.DB` — migration 013

Muito menor do que a primeira versão deste plano previa. Como a exibição não
converte mais nada (§5.5), **`flight_fares` não ganha coluna de valor
convertido** — ver §6.

```sql
-- 1. A moeda passa a ser obrigatória (0 nulas hoje: janela barata)
ALTER TABLE flight_fares ALTER COLUMN currency SET NOT NULL;

-- 2. Fim do Real carimbado no que não é Real
ALTER TABLE best_fares ALTER COLUMN currency DROP DEFAULT;

-- 3. A moeda de cadastro da companhia sai de cena
ALTER TABLE airlines DROP COLUMN IF EXISTS currency;

-- 4. O watermark passa a saber em que moeda o preço foi alertado, para que
--    câmbio não vire "queda de preço" (§5.6)
ALTER TABLE target_alert_state
  ADD COLUMN IF NOT EXISTS notified_currency        VARCHAR(3),
  ADD COLUMN IF NOT EXISTS notified_amount_original NUMERIC(12,2);
```

`airports.currency` **fica como está**, sem consumo (decisão 2).

### 5.3 `flight.API`

| arquivo | mudança |
|---|---|
| `modules/scrape/schema.ts` | `currency` deixa de ser `.optional()` quando `fareCash` vem — defesa em profundidade contra regressão do scraper |
| `services/fx/FxRateService.ts` *(novo)* | `toBrl(amount, currency)`. Cache em memória por (moeda, dia), Frankfurter primária + fallback. **Não toca no banco** |
| `modules/scrape/ScrapeService.ts` | **nada de conversão no ingest.** Só grava o que veio, com a moeda original |
| `services/evaluation/EvaluationService.ts` | converte **em memória**, no ciclo, nas 5 comparações da §5.5. A guarda `outbound.currency !== inbound.currency` (linha 228) **sai** — ela existe porque não havia conversão. Entra: par cuja conversão falhou fica de fora do ciclo, com log |
| `services/notifications/NotificationsService.ts` | fim do `?? routine.currency ?? 'BRL'`. E-mail mostra cada perna na moeda dela; o total em R$ aparece porque é o número que disparou o alerta, com a taxa e a data ao lado |
| `modules/target-alert-state/*` | grava e compara `notified_currency` + `notified_amount_original` (§5.6) |
| `modules/routines/RoutinesService.ts` | `resolveCurrency` **sai inteira** (é a origem do erro de cadastro); alvo é BRL por definição |
| `modules/airlines/AirlinesRepository.ts` | remove `currency` da lista de colunas; `AirlineRow` perde o campo |
| `modules/flight-fares/FlightFaresRepository.ts` | `getPriceHistory` ganha `GROUP BY currency` (§5.7); as queries de par expõem `currency` por perna |

### 5.4 `flight.FRONT`

**`RoutineForm`** — o alvo vira R$ fixo. Sai a dedução de moeda das linhas
280-285. Entra uma linha de ajuda explicando o porquê, que é a parte que evita
o suporte: *"O alvo é sempre em Real. Passagens em outra moeda são convertidas
pela cotação do dia da coleta."*

**`RoutineCard`** — hoje formata as duas pernas com uma moeda só (linha 56).
Passa a ler `legs[]`:

```
┌─────────────────────────────────────────┐
│ GRU → LHR · 21/09        [ida-e-volta]  │
│                                         │
│   Ida    GRU→LHR   21/09    R$ 4.925    │
│   Volta  LHR→GRU   25/09    R$ 8.724    │
│   ─────────────────────────────────     │
│   Total                    R$ 13.649    │
│   Alvo                     R$ 12.000    │
└─────────────────────────────────────────┘
```

Com moedas diferentes, **não há linha de total** (decisão 5) — somar £ com €
exigiria uma conversão que o card não faz:

```
│   Ida    STN→DUB   21/09    £ 17,99     │
│   Volta  DUB→STN   25/09    € 17,99     │
│   ─────────────────────────────────     │
│   Alvo                     R$ 200,00    │
```

O usuário vê o que cada perna custa, na moeda em que ela é vendida, e o alvo em
Real. Quando o alvo for atingido, é o **e-mail** que mostra a conta fechada em
R$, com a cotação usada.

**Mobile:** as pernas já empilham; sem a linha de total, o card fica mais curto
que hoje. Vale revisar o card inteiro nessa passada, como você sugeriu.

**`PriceHistoryPanel` / `FareCalendar`:** série **por moeda**, sem conversão
nenhuma. Em rotina ida-e-volta, **duas curvas** — uma da ida, outra da volta —
cada uma no eixo da sua moeda. Quando as duas pernas estão na mesma moeda,
compartilham o eixo; quando não, cada curva ganha seu eixo (ou dois painéis
empilhados, que no mobile é o que vai caber de qualquer jeito).

Depende da correção do `GROUP BY currency` descrita em §5.7 — hoje o painel já
mistura moedas em silêncio.

**`AirlinesService` / `types/airlines.ts`:** o campo `currency` sai do tipo,
junto com a coluna.

### 5.5 Onde a conversão é — e não é — necessária

A intuição de confinar a conversão à decisão do alerta está certa, e vira a
linha arquitetural do projeto: **quem exibe nunca converte; quem decide sempre
converte.** Só que "decidir" é mais do que comparar com o alvo. São **cinco**
comparações numéricas no `EvaluationService`, e todas quebram com moeda mista:

| # | onde | o que compara | por que precisa de moeda única |
|---|---|---|---|
| 1 | `bestInTargetByDate` | melhor preço da data **entre as companhias da rotina** | uma rotina aceita várias companhias, e elas podem precificar em moedas diferentes |
| 2 | `bestPairsByOutboundDate` → `p.total` | **soma** das duas pernas | £17,99 + €17,99 não é número |
| 3 | `amount < prev` | valor de hoje × **watermark** de `target_alert_state` | o watermark persiste entre ciclos |
| 4 | `routineFloor = Math.min(...watermarks)` | piso da rotina entre **todas as datas** | mistura datas colhidas em mercados diferentes |
| 5 | `offers.sort()` + `headline` | ordenação e manchete do e-mail | "a mais barata" exige unidade comum |

Fora dessas cinco, **nada converte**: card, gráfico, tabela e o corpo do e-mail
mostram cada perna na moeda em que ela foi vendida.

Sobra **uma fronteira** a decidir (§9.3): o **total do par com moedas
diferentes**, no card e no e-mail. Ou se mostra só as duas pernas sem total, ou
se mostra o total em R$ com a taxa à vista.

### 5.6 O watermark não tem moeda — e isso é um problema novo

**O que é o watermark.** O ciclo confere preço a cada 5 minutos. Sem memória,
toda rodada abaixo do alvo mandaria um e-mail — dezenas por dia da mesma
passagem. Então guardamos, por célula **(rotina, data do voo, tipo de tarifa)**,
o **melhor preço já avisado**. Só há novo e-mail quando o preço fica **abaixo
dessa marca**, e aí a marca desce. É a marca que o rio deixa na parede, só que
marcando até onde o preço desceu.

`target_alert_state` guarda isso em `notified_amount NUMERIC(12,2)` e **nenhuma
coluna de moeda**. Ele sobrevive entre ciclos.

Com alvo em Real, o valor gravado passa a ser BRL convertido. Isso cria um
efeito que hoje não existe: **o câmbio andar vira queda de preço**.

| dia | preço na BA | cotação | vira | o que acontece |
|---|---|---|---|---|
| 04/08 | £ 730 | 6,83 | R$ 4.986 | marca = R$ 4.986, e-mail enviado |
| 05/08 | £ 730 | 6,60 | R$ 4.818 | R$ 168 "mais barato" → **e-mail de recorde** |

A companhia não mexeu em nada. E o efeito colateral é pior que o e-mail falso: a
marca desce junto, escondendo uma queda real que venha depois.

Três saídas, em ordem de esforço:

1. **Gravar a moeda e o valor original no watermark** (`notified_currency`,
   `notified_amount_original`) e comparar **na moeda original quando ela não
   mudou** — £730 contra £730 não é queda, e nenhum e-mail sai. Cai para BRL só
   quando a moeda de fato mudou entre as coletas.
2. **Piso de variação**: só alerta se a melhora passar de X%. Uma linha, mas
   engole queda real pequena.
3. **Aceitar o ruído** e dizer no e-mail qual taxa foi usada. Barato, mas
   transfere o susto para o usuário.

**Recomendo a 1.** São duas colunas em `target_alert_state` (não é tabela nova)
e é a única que faz "o preço caiu" voltar a significar preço, e não câmbio. As
outras duas administram o sintoma.

> 🟡 **Pendente de decisão** — é o único ponto aberto do plano.

### 5.7 O que o gráfico por moeda obriga a corrigir

`FlightFaresRepository.getPriceHistory` agrega 30 dias por
`(airline, origin, destination, flight_date)` e resolve a moeda com
**`MAX(currency)`**. Quando a mesma rota foi colhida em duas moedas — que é
exatamente o caso BA LHR→GRU (R$ 7.627 na busca RT, £ 730 na só-ida) — o
`AVG`/`MIN`/`PERCENTILE` **misturam os dois números** e o resultado sai rotulado
com a moeda que o `MAX` alfabético escolher. Hoje isso já está errado na tela.

A correção que a sua decisão pede: **`GROUP BY currency`**, devolvendo uma série
por moeda. A separação por perna sai de graça — a volta tem a rota invertida,
então ida e volta já são consultas distintas de `origin`/`destination`; o que
falta é o front pedir as duas e plotar as duas curvas.

---

## 6. Como a restrição "sem tabela nova" foi respeitada

A taxa **não vira tabela e nem coluna de tarifa**: vive em cache de memória no
`FxRateService` (chave = moeda + dia, invalidada na virada do dia).

A primeira versão deste plano guardava `fare_cash_brl`/`fx_rate` em cada linha
de `flight_fares`. Isso **caiu** quando você decidiu que o gráfico é por moeda:
sem exibição convertida, o valor em Real só é consumido nas 5 comparações do
ciclo de avaliação (§5.5), que roda de 5 em 5 minutos sobre algumas dezenas de
tarifas. Converter na memória, ali, é mais barato que carregar quatro colunas em
toda linha do histórico — e não cria um número derivado que pode envelhecer
calado no banco.

A auditoria que aquelas colunas dariam continua existindo, mas no lugar certo:
a taxa usada é registrada **no alerta** (log estruturado + corpo do e-mail), que
é onde alguém vai perguntar "por que isso disparou?". E o watermark guarda a
moeda e o valor **original** (§5.6), que é o que torna a comparação entre ciclos
honesta.

---

## 7. Ordem de execução

| # | entrega | projetos | por que nesta ordem |
|---|---|---|---|
| 1 | moeda obrigatória + descarte de tarifa sem moeda | scraping.API | fecha a torneira antes de limpar o chão |
| 2 | migration 013 (NOT NULL, drop default, drop `airlines.currency`, colunas do watermark) | flight.DB | 0 nulas hoje: janela barata |
| 3 | `FxRateService` (Frankfurter + fallback, cache em memória) | flight.API | isolado, testável sozinho |
| 4 | avaliação converte nas 5 comparações; watermark com moeda | flight.API | depende de 3; é o coração da mudança |
| 5 | notificação sem `?? 'BRL'`, com taxa e data no e-mail | flight.API | depende de 4 |
| 6 | `getPriceHistory` com `GROUP BY currency` | flight.API | corrige mistura que já existe hoje |
| 7 | entidade `legs` na resposta; sai `resolveCurrency` e `airlines.currency` | flight.API | contrato novo para o front |
| 8 | alvo fixo em R$ | flight.FRONT | depende de 5 |
| 9 | card por trajeto + gráfico com curva por perna/moeda | flight.FRONT | depende de 6 e 7 |

Ponto de corte seguro para uma primeira entrega: **1 a 5**. O sistema já passa a
avaliar e notificar certo, com o front ainda no formato antigo.

Sem backfill: nenhuma linha precisa ser reprocessada, porque nada convertido é
persistido.

---

## 8. Riscos

| risco | mitigação |
|---|---|
| API de câmbio fora do ar no ciclo | o ciclo pula o par e loga; nada é gravado errado. Última taxa conhecida em cache cobre janelas curtas; fallback secundário cobre o resto |
| Taxa do BCE é de dia útil | para alvo de passagem a diferença é ruído; a data da taxa vai no e-mail |
| Câmbio virar "queda de preço" no watermark | §5.6, saída 1: comparar na moeda original quando ela não mudou |
| Descarte de tarifa sem moeda esconder quebra de scraper | contador e log por corrida; um scraper que passe a descartar tudo tem que aparecer no log |
| Alvo em R$ confundir quem mira passagem em £ | texto de ajuda no formulário; o e-mail mostra as duas pernas na moeda original **e** o total convertido com a taxa |
| Depender de serviço público de terceiro | a Frankfurter é auto-hospedável com Docker — a porta de saída existe e está documentada, só não vamos usá-la agora |

---

## 9. O que ainda falta decidir

1. ~~Frankfurter pública ou auto-hospedada~~ → **pública** (decisão 1).
2. ~~`airports.currency` / `airlines.currency`~~ → **`airlines.currency` apagada,
   `airports.currency` parada** (decisão 2).
3. ~~Gráfico convertido ou por moeda~~ → **por moeda, curva por perna**
   (decisão 3).
4. ~~Total do par com moedas diferentes~~ → **fica sem total somado**, cada perna
   na sua moeda (decisão 5).
5. **Ruído de câmbio no watermark** (§5.6): confirmar a saída 1 — duas colunas em
   `target_alert_state` — ou aceitar uma das alternativas mais baratas.
   **← único ponto aberto.**
