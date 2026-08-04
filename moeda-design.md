# Moeda: a do site é a única verdade, e o alvo é sempre em Real

> Proposta de arquitetura para acabar com a moeda inventada: a moeda passa a vir
> **só do scraping**, é obrigatória, é guardada e exibida **por trajeto**, e o
> alvo da rotina passa a ser **sempre em Real**, com conversão feita por nós.
>
> Data: 2026-08-04 · Escopo: `scraping.API`, `flight.DB`, `flight.API`, `flight.FRONT`
> Status: 🟡 proposta
>
> **Restrição do pedido:** sem tabela nova. Ver §7 — nenhum valor convertido é
> persistido; a cotação vive em cache de memória e a conversão acontece só no
> ciclo de avaliação.

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
   convertemos cada jornada e somamos para comparar.
5. **Nada convertido é persistido.** A conversão acontece no ciclo de avaliação
   e é registrada onde alguém vai perguntar por ela — o log do alerta e o corpo
   do e-mail. O histórico guarda só o que a companhia cobrou, na moeda em que
   cobrou.

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
| 6 | **O calendário de preços também segrega ida e volta**, como o histórico. Some a célula de "total do par". |
| 7 | **A entidade é o trajeto, não a perna.** Ida e volta são *jornadas*; cada jornada tem uma lista de *trajetos*. Hoje sempre 1; o dia em que a ida tiver conexão modelada, a estrutura já cabe. Ver §4. |
| 8 | **As APIs externas ficam numa camada de serviço própria**, consumível só por outro service ou controller, com o acesso à rede num ponto único. Segurança é requisito, não detalhe — ver §6. |
| 9 | **O watermark decide pelos valores fragmentados**, com margem de segurança como rede. Ver §5.6. |

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
- ⚠ **Rate-limit por conexão pendurada** (medido em 2026-08-04): as três
  primeiras chamadas seguidas voltam em ~120ms; da quarta em diante a conexão
  simplesmente não responde — sem 429, sem status, até estourar o timeout do
  cliente. Não é problema no regime normal (cache por moeda/dia = ~2 chamadas
  diárias), mas explica por que o fallback é requisito e não conforto: numa
  partida a frio com várias moedas de uma vez, a primária cai. Foi exatamente o
  que o teste de rede observou — GBP passou, EUR e USD deram timeout, e a
  `currency-api` cobriu sem perda.

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

## 4. Modelo: jornada e trajeto

Hoje o par vive em **8 campos achatados** no `CurrentPrice`
(`bestCashOutbound`, `bestCashInbound`, `bestPtsOutbound`, … ), e a moeda é uma
só para todos. Não cabe mais moeda por perna sem virar 12 campos.

A estrutura não para na perna. Quem é **vendido e precificado** é a ida (ou a
volta) inteira; quem tem **rota** é cada trecho voado. Hoje uma conexão vira uma
oferta só com `stops = 1`, e o caminho intermediário se perde. Modelar os dois
níveis agora custa quase nada e é o que faz a ida com duas pernas caber sem
refazer o contrato.

```ts
/**
 * O que a companhia VENDE e precifica: a ida, ou a volta.
 * O dinheiro mora aqui — não no trajeto — porque é assim que a tarifa é cotada.
 */
interface Journey {
  direction: 'outbound' | 'inbound'
  date: string              // 2026-09-21 — a data da partida da jornada
  currency: string          // sempre presente, sempre lida do site
  cash: number | null
  pts: number | null
  hybPts: number | null
  hybCash: number | null
  /** Os trechos voados, em ordem. Hoje sempre 1; conexão modelada dá N. */
  segments: Segment[]
}

/** Um TRAJETO: um trecho voado, de um aeroporto a outro, num voo. */
interface Segment {
  origin: string            // GRU
  destination: string       // LHR
  flightNumber: string      // BA246
  departureAt: string
  arrivalAt: string
}

interface CurrentPrice {
  journeys: Journey[]       // 1 em só-ida, 2 em ida-e-volta
  mixedCurrency: boolean    // as jornadas vieram em moedas diferentes
  // … campos de histórico que já existem
}
```

**Nomes:** o código do projeto é todo em inglês (`origin`, `isReturn`,
`flight_number`), então `Journey`/`Segment` mantêm a casa consistente —
"trajeto" é a palavra do domínio para `Segment`, e fica registrada aqui e nos
comentários. Se preferir `Trajeto` no identificador, é trocar e seguir.

**O que NÃO muda agora:** `flight_fares` continua uma linha por oferta, com
`stops`. Nada de tabela de trechos — a estrutura de trajetos existe primeiro no
**contrato da API e na tela**; a persistência só se desdobra quando houver
scraper que colete o caminho da conexão.

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

-- 4. O watermark passa a guardar a COMPOSIÇÃO original do preço, para que
--    câmbio não vire "queda de preço" (§5.6)
ALTER TABLE target_alert_state
  ADD COLUMN IF NOT EXISTS notified_breakdown JSONB;
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

**`PriceHistoryPanel` e `FareCalendar`: os dois passam a segregar ida e volta.**

Hoje o calendário faz o contrário: com janela de volta presente, **cada célula é
o TOTAL do par** daquela data de ida (é o que o próprio `FareCalendarProps`
documenta). Isso some — não há mais total somado, e o total escondia de qual
data de volta ele veio.

O desenho minimalista, que serve os dois componentes e as duas telas:

```
┌───────────────────────────────────────────────┐
│  Ida · GRU → LHR                    em R$     │
│  ┌────┬────┬────┬────┬────┬────┬────┐         │
│  │ 19 │ 20 │ 21 │ 22 │ 23 │ 24 │ 25 │         │
│  │3.7k│3.5k│4.9k│3.3k│3.4k│3.9k│4.1k│         │
│  └────┴────┴────┴────┴────┴────┴────┘         │
│                                               │
│  Volta · LHR → GRU                  em £      │
│  ┌────┬────┬────┬────┬────┬────┬────┐         │
│  │ 23 │ 24 │ 25 │ 26 │ 27 │ 28 │ 29 │         │
│  │ 780│ 745│ 730│ 812│ 799│ 731│ 755│         │
│  └────┴────┴────┴────┴────┴────┴────┘         │
└───────────────────────────────────────────────┘
```

Três escolhas que fazem isso ficar simples em vez de virar duas telas:

1. **A moeda vai no cabeçalho da faixa, não em cada célula.** É o que permite a
   célula ser pequena o suficiente para caber a janela inteira no mobile, e o
   que torna a moeda mista óbvia sem nenhum aviso extra.
2. **Cada faixa tem a sua própria régua de veredito** (a cor verde/amarelo/
   vermelho sai do histórico *daquele trecho, naquela moeda*). Hoje existe uma
   régua separada só para os totais de par (`bestPairTotals`), justamente porque
   comparar total contra média de uma perna pintava tudo de vermelho — com a
   segregação essa régua especial deixa de ser necessária.
3. **Uma faixa em rotina só-ida.** O componente é o mesmo; o que muda é a
   quantidade de jornadas que ele recebe. Nada de branch por tipo de rotina.

**Mobile:** cada faixa rola horizontalmente sozinha, com a data selecionada
ancorada. Duas faixas de ~64px cabem sem empurrar o resto do card para baixo da
dobra — mais curto que o layout de hoje, que ainda tinha a linha de total.

**`PriceHistoryPanel`:** mesma lógica, **uma curva por jornada**, cada uma no
eixo da sua moeda. Mesma moeda nas duas ⇒ eixo compartilhado e as curvas ficam
comparáveis; moedas diferentes ⇒ dois painéis empilhados, porque sobrepor
escalas diferentes no mesmo eixo é mentira visual.

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

### Solução: decidir pelos valores fragmentados, com margem como rede

O que decide se houve queda passa a ser **o que a companhia cobra**, não o
número convertido. O watermark guarda, além do valor em BRL, a **composição
original** do preço — as jornadas com sua moeda e seu valor:

```jsonc
// target_alert_state.notified_breakdown (JSONB)
[
  { "direction": "outbound", "currency": "GBP", "amount": 730.00 },
  { "direction": "inbound",  "currency": "EUR", "amount":  17.99 }
]
```

Regra de decisão, nesta ordem:

1. **Composição idêntica à guardada ⇒ o preço não mudou.** Não alerta, não
   importa o que o câmbio fez. Mata o caso da tabela acima na raiz.
2. **Composição diferente ⇒ compara em BRL**, como no resto do sistema.
3. **Margem de segurança** sobre o passo 2: só alerta se a melhora passar de
   `FX_NOISE_MARGIN` (sugestão: **1%**, configurável por env). Absorve
   arredondamento e microvariação de câmbio quando a composição mudou de
   verdade mas o preço, na prática, não.

O passo 1 resolve o caso comum (mesma passagem, câmbio andou) com precisão
total. O passo 3 é a rede para o caso em que a composição muda por um centavo.

Custo: **uma coluna** em `target_alert_state` (`notified_breakdown JSONB`), sem
tabela nova. JSONB e não texto porque é dado estruturado que vamos querer ler em
diagnóstico — "com que composição este alerta foi disparado?".

> ✅ Decidido em 2026-08-04 (decisão 9).

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

## 6. A camada de câmbio: arquitetura e segurança

Regra de acesso: **só outro service ou um controller chama o `FxRateService`.**
Nenhuma rota HTTP expõe câmbio, e nenhum repositório ou componente de tela fala
com a rede. Isso não é convenção verbal — é o desenho: o service entra por
injeção no `container.ts`, e a única classe que abre socket é o
`ExchangeRateHttpClient`.

```
src/services/fx/
  interfaces/IFxRateService.ts        contrato consumido pelo resto do sistema
  FxRateService.ts                    cache, política de fallback, sanidade
  ExchangeRateHttpClient.ts           ÚNICO ponto que fala com a rede
  providers/
    IExchangeRateProvider.ts          contrato do provedor
    FrankfurterProvider.ts            primária   (api.frankfurter.dev)
    CurrencyApiProvider.ts            fallback   (@fawazahmed0 via jsDelivr)
```

O `FxRateService` expõe pouco de propósito:

```ts
interface IFxRateService {
  /** Converte para BRL. `null` quando não há taxa confiável — quem chama decide. */
  toBrl(amount: number, currency: string): Promise<ConvertedAmount | null>
}

interface ConvertedAmount {
  amount: number       // em BRL
  rate: number
  source: 'frankfurter' | 'currency-api' | 'native'
  rateDate: string     // a data da cotação, não a de hoje
  stale: boolean       // veio de cache antigo porque todos os provedores falharam
}
```

`null` em vez de exceção, e `stale` explícito: quem chama (a avaliação) precisa
poder **pular o par** em vez de decidir com número duvidoso.

### O que protege

| # | medida | o que evita |
|---|---|---|
| 1 | **Allowlist de host** no client, e **redirect não é seguido** | SSRF e sequestro de resposta por redirect. As URLs são constantes do código — nunca vêm de input |
| 2 | **HTTPS obrigatório**, sem downgrade | resposta adulterada em trânsito |
| 3 | **Timeout curto (3s) com `AbortController`** | o ciclo de avaliação travar preso num terceiro |
| 4 | **1 retry com backoff + jitter**, e só então o fallback | martelar um provedor instável |
| 5 | **Circuit breaker**: N falhas seguidas tiram o provedor por X min | insistir no que está fora do ar |
| 6 | **Validação da resposta com zod** | confiar no shape de JSON externo |
| 7 | **Faixa de sanidade da taxa** (finita, > 0, dentro de limites plausíveis por par) | cotação absurda/envenenada virar decisão de alerta. Uma taxa errada aqui manda e-mail errado para o usuário |
| 8 | **Cache por (moeda, dia)** com `stale-while-error` | uma indisponibilidade curta parar a avaliação |
| 9 | **Nada de PII na requisição** — só o par de moedas | vazamento por telemetria de terceiro |
| 10 | **Sem segredo hoje; se auto-hospedar, chave por env e nunca logada** | credencial em log |
| 11 | **Log estruturado com provedor, taxa e data** | alerta que não se consegue explicar depois |

Medida 7 merece o destaque: é a única que protege de um erro *silencioso*. As
outras dez falham barulhento; uma taxa errada passa despercebida e vira e-mail
de "preço caiu".

### Testes desta camada

- provedor devolvendo JSON fora do schema ⇒ `null`, sem exceção vazando
- taxa fora da faixa de sanidade ⇒ rejeitada, cai para o fallback
- primária fora do ar ⇒ fallback assume, `source` reflete
- os dois fora ⇒ cache velho com `stale: true`; sem cache, `null`
- host fora da allowlist ⇒ recusa antes de abrir conexão
- `BRL → BRL` ⇒ taxa 1, `source: 'native'`, **sem chamada de rede**

---

## 7. Como a restrição "sem tabela nova" foi respeitada

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

## 8. Ordem de execução

| # | entrega | projetos | por que nesta ordem |
|---|---|---|---|
| 1 | moeda obrigatória + descarte de tarifa sem moeda | scraping.API | fecha a torneira antes de limpar o chão |
| 2 | migration 013 (NOT NULL, drop default, drop `airlines.currency`, `notified_breakdown`) | flight.DB | 0 nulas hoje: janela barata |
| 3 | camada `services/fx` completa (§6), com os testes de segurança | flight.API | isolada, testável sem o resto do sistema |
| 4 | avaliação converte nas 5 comparações; watermark decide pela composição | flight.API | depende de 3; é o coração da mudança |
| 5 | notificação sem `?? 'BRL'`, com taxa e data no e-mail | flight.API | depende de 4 |
| 6 | `getPriceHistory` com `GROUP BY currency`, por jornada | flight.API | corrige mistura que já existe hoje |
| 7 | contrato `journeys[]`/`segments[]`; saem `resolveCurrency` e `airlines.currency` | flight.API | contrato novo para o front |
| 8 | alvo fixo em R$ | flight.FRONT | depende de 5 |
| 9 | card, calendário e histórico segregados por jornada e moeda | flight.FRONT | depende de 6 e 7 |

Ponto de corte seguro para uma primeira entrega: **1 a 5**. O sistema já passa a
avaliar e notificar certo, com o front ainda no formato antigo.

Sem backfill: nenhuma linha precisa ser reprocessada, porque nada convertido é
persistido.

---

## 9. Riscos

| risco | mitigação |
|---|---|
| API de câmbio fora do ar no ciclo | o ciclo pula o par e loga; nada é gravado errado. Última taxa conhecida em cache cobre janelas curtas; fallback secundário cobre o resto |
| Rate-limit da primária numa partida a frio | medido: a Frankfurter para de responder após ~3 chamadas seguidas. O disjuntor (3 falhas) tira ela de circulação por 5 min e a `currency-api` assume — validado no teste de rede |
| Taxa do BCE é de dia útil | para alvo de passagem a diferença é ruído; a data da taxa vai no e-mail |
| Câmbio virar "queda de preço" no watermark | §5.6: composição idêntica não alerta; margem de 1% cobre o resto |
| Cotação errada de um provedor virar alerta falso | §6 medida 7 — faixa de sanidade por par. É a única falha *silenciosa* da camada externa |
| Descarte de tarifa sem moeda esconder quebra de scraper | contador e log por corrida; um scraper que passe a descartar tudo tem que aparecer no log |
| Alvo em R$ confundir quem mira passagem em £ | texto de ajuda no formulário; o e-mail mostra as duas pernas na moeda original **e** o total convertido com a taxa |
| Depender de serviço público de terceiro | a Frankfurter é auto-hospedável com Docker — a porta de saída existe e está documentada, só não vamos usá-la agora |

---

## 10. Decisões — todas fechadas

| # | pergunta | resposta |
|---|---|---|
| 1 | Frankfurter pública ou auto-hospedada | **pública**, sem auto-hospedar por ora |
| 2 | `airports.currency` / `airlines.currency` | **`airlines.currency` apagada**, `airports.currency` parada |
| 3 | Gráfico convertido ou por moeda | **por moeda**, uma curva por jornada |
| 4 | Total do par com moedas diferentes | **sem total somado** no card; total em R$ só no e-mail |
| 5 | Calendário de preços | **segregado em ida e volta**, como o histórico |
| 6 | Modelo do par | **jornada → trajetos**, pronto para conexão |
| 7 | APIs externas | **camada `services/fx` própria**, rede num ponto só, §6 |
| 8 | Ruído de câmbio no watermark | **composição original** decide; margem de 1% como rede |

Nada em aberto. Próximo passo: executar o item 1 da §8 — moeda obrigatória na
`scraping.API`.

### Aberto de propósito, para depois

- **Escolher companhia e moeda pelo usuário.** O futuro que você descreveu. O
  alvo já normalizado em Real é a peça que faltava para isso ser possível.
- **Persistir os trajetos de uma conexão.** A estrutura da §4 aceita; falta
  scraper que colete o caminho intermediário.
- **PTAX como fonte auditável.** Documentada na §3, sem uso hoje.
