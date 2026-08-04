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

```sql
ALTER TABLE flight_fares
  ADD COLUMN IF NOT EXISTS fare_cash_brl NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fx_rate       NUMERIC(18,8),
  ADD COLUMN IF NOT EXISTS fx_source     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS fx_date       DATE;

-- BRL não converte: taxa 1, fonte 'native'
UPDATE flight_fares SET fare_cash_brl = fare_cash, fx_rate = 1, fx_source = 'native', fx_date = scraped_at::date
 WHERE currency = 'BRL' AND fare_cash IS NOT NULL AND fare_cash_brl IS NULL;

ALTER TABLE flight_fares ALTER COLUMN currency SET NOT NULL;   -- 0 nulas hoje
ALTER TABLE best_fares   ALTER COLUMN currency DROP DEFAULT;   -- fim do 'BRL' carimbado
```

As 42 linhas GBP/EUR ficam com `fare_cash_brl` nulo até o backfill (§7).

### 5.3 `flight.API`

| arquivo | mudança |
|---|---|
| `modules/scrape/schema.ts` | `currency` deixa de ser `.optional()` quando `fareCash` vem — defesa em profundidade contra regressão do scraper |
| `services/fx/FxRateService.ts` *(novo)* | `toBrl(amount, currency, date)`. Cache em memória por (moeda, dia). Provider primário + fallback. **Sem tabela nova** — a taxa usada é persistida na linha da tarifa |
| `modules/scrape/ScrapeService.ts` | ao gravar a tarifa, resolve `fare_cash_brl`/`fx_rate`/`fx_source`/`fx_date`. Câmbio indisponível ⇒ grava a tarifa com BRL nulo (**não descarta**: a tarifa é boa, só a projeção falhou) |
| `services/evaluation/EvaluationService.ts` | compara **só em BRL**. A guarda `outbound.currency !== inbound.currency` (linha 228) **sai** — ela existe porque não havia conversão; com BRL a soma passa a valer. Entra guarda nova: perna sem `fare_cash_brl` não entra no par |
| `services/notifications/NotificationsService.ts` | fim do `?? routine.currency ?? 'BRL'`. E-mail mostra cada perna na moeda dela + total em R$ com a data da cotação |
| `modules/routines/RoutinesService.ts` | `resolveCurrency` deixa de deduzir de cadastro; alvo é BRL por definição |
| `modules/flight-fares/FlightFaresRepository.ts` | as queries de par passam a somar `fare_cash_brl`; expõem `currency` por perna |

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

Com moedas diferentes, a conversão fica visível em vez de escondida:

```
│   Ida    STN→DUB   21/09    £ 17,99     │
│   Volta  DUB→STN   25/09    € 17,99     │
│   ─────────────────────────────────     │
│   Total                    R$ 235,10 ⓘ  │
│                            ⓘ convertido │
│                              em 04/08   │
```

**Mobile:** as pernas já empilham; o cuidado é o total não quebrar linha e o
ⓘ ser alvo de toque (≥44px), não hover. Vale revisar o card inteiro nessa
passada, como você sugeriu.

**`PriceHistoryPanel` / `FareCalendar`:** série em **R$ convertido** — é a única
forma de o gráfico de uma rota internacional não ter degrau quando a moeda da
coleta muda. Moeda original no tooltip.

---

## 6. Como a restrição "sem tabela nova" foi respeitada

A taxa **não vira tabela**: vive em cache de memória no `FxRateService`
(chave = moeda + dia, invalidada na virada do dia) e é **persistida na própria
linha da tarifa** (`fx_rate`, `fx_source`, `fx_date`). Isso dá de graça três
coisas que uma tabela de cotações daria: auditoria ("com que taxa este número
foi calculado?"), imutabilidade do histórico (a taxa de ontem não muda) e
reprocessamento por data (a Frankfurter serve histórico por dia).

Custo aceito: reprocessar em lote exige varrer `flight_fares` em vez de uma
tabela de taxas pequena. Com o volume atual (279 linhas) não é problema, e o
gargalo real seria a API externa, não o banco.

---

## 7. Ordem de execução

| # | entrega | projetos | por que nesta ordem |
|---|---|---|---|
| 1 | moeda obrigatória + descarte | scraping.API | fecha a torneira antes de limpar o chão |
| 2 | migration 013 (colunas + NOT NULL) | flight.DB | 0 nulas hoje: janela barata |
| 3 | `FxRateService` + conversão no ingest | flight.API | passa a nascer com BRL |
| 4 | backfill das 42 linhas GBP/EUR | flight.API (script) | usa a taxa da data da coleta |
| 5 | avaliação e notificação em BRL | flight.API | depende de 3 e 4 |
| 6 | entidade `legs` na resposta | flight.API | contrato novo para o front |
| 7 | alvo fixo em R$ | flight.FRONT | depende de 5 |
| 8 | card por trajeto + gráfico em R$ | flight.FRONT | depende de 6 |

Ponto de corte seguro para uma primeira entrega: **1 a 5**. O sistema já passa a
avaliar certo, com o front ainda no formato antigo.

---

## 8. Riscos

| risco | mitigação |
|---|---|
| API de câmbio fora do ar no ingest | tarifa entra com BRL nulo, job de retentativa preenche; fallback secundário; auto-hospedar a Frankfurter |
| Taxa do BCE é de dia útil | para alvo de passagem a diferença é ruído; a data da taxa é exibida |
| Descarte de tarifa sem moeda esconder quebra de scraper | contador e log por corrida; um scraper que passe a descartar tudo tem que aparecer |
| Histórico com degrau na virada do regime | o backfill (passo 4) usa a taxa da data da coleta, não a de hoje |
| Alvo em R$ confundir quem mira passagem em £ | texto de ajuda no formulário e conversão visível no card |

---

## 9. O que decidir antes de começar

1. **Frankfurter pública ou auto-hospedada desde já?** Recomendo começar na
   pública e subir a nossa quando o volume justificar.
2. **`airports.currency` e `airlines.currency`: apagar ou deixar parados?**
   Recomendo deixar (não custa nada) mas remover todo consumo, para não voltarem
   a alimentar exibição por descuido.
3. **Gráfico de histórico: BRL convertido ou série por moeda?** Recomendo BRL
   pela comparabilidade — mas é decisão de produto.
