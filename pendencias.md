# Pendências abertas — fechamento da sessão de 2026-08-04

> O que ficou em aberto depois da entrega do ida-e-volta (Ryanair + BA) e do
> plano da moeda (`moeda-design.md`, 9 passos implementados).
>
> Ordenado por risco, não por esforço.

---

## 1. 🔴 Links de compra sempre levam para UMA perna

**Sintoma:** o botão de compra do card e o link do e-mail abrem uma busca
**só-ida**, mesmo quando a rotina é de ida-e-volta. O usuário clica num alerta de
par e cai numa tela que não é a do preço que ele viu.

**Onde está, nos dois lados:**

| arquivo | estado |
|---|---|
| `flight.API` · `services/email/EmailService.ts` | Azul monta `c[1]` ✅; LATAM, BA e Ryanair cravam só-ida |
| `flight.FRONT` · `src/utils/bookingLink.ts` | mesmo problema, mesmas três |

O que está cravado hoje:

```ts
// LATAM   → trip=OW, inbound=undefined
// BA      → trip: 'oneWay', bound: 'outbound'
// Ryanair → isReturn: 'false', dateIn: ''
```

**O que facilita a correção:** as URLs de ida-e-volta das três já foram
descobertas e estão em produção nos scrapers desta sessão. É copiar de lá:

| companhia | URL de RT | de onde tirar |
|---|---|---|
| Ryanair | `isReturn=true&dateIn={volta}&tpEndDate={volta}` | `scraping.API` · `ryanair.ts` · `buildSearchUrl` |
| BA (mercado BRL) | `onds={A}-{B}_{ida},{B}-{A}_{volta}` + `ond=2` | `scraping.API` · `britishairways.ts` · `buildSearchUrlOld` |
| BA (mercado UK) | ❓ não mapeada — ver item 4 | — |
| LATAM | `trip=RT&inbound={volta}` — **não confirmada** | ver item 3 |

**Cuidado:** `buildAzulLink` já recebe `ret` e é o modelo a seguir; as outras três
sequer aceitam o parâmetro. A assinatura muda nas quatro.

---

## 2. 🔴 Dois jobs da BA travaram 26 min — causa desconhecida

**O que aconteceu:** dois jobs `GRU→LHR` rodaram juntos e ficaram 26 minutos sem
escrever **uma linha** — `console.log` com 0 bytes, `network/` e `steps/` vazios,
`trace.jsonl` parado nas duas primeiras entradas. Morreram pelo lease reclaim do
`flight.API` aos 25 min ("Excedeu o tempo máximo de execução").

**O que JÁ foi corrigido:** o deadline de 18 min do próprio scraper não
funcionava fora da Azul — sinal disparado não interrompe nada, quem cancela uma
operação Playwright é fechar o browser. Agora vale para as quatro
(`scraping.API` · `browser/abortable.ts`). Isso **bounda o dano**, não resolve a
causa.

**O que foi tentado e REFUTADO** (`scripts/probe-browser-concurrency.ts`):

```
2 camoufox simultâneos (só launch)        OK  10,3s / 7,0s
2 camoufox navegando na BA (mesmo site)   OK  15,7s / 11,7s
2 camoufox em sites diferentes            OK  19,2s / 23,6s
```

Nem "dois camoufox" nem "duas sessões no mesmo site" reproduzem. A serialização
por companhia que eu havia escrito foi **revertida** justamente por não ter
justificativa medida.

**Pistas que sobraram:**

- No MESMO lote, `LHR→GRU` (UI nova) terminou em **1min24**. Não é "a BA
  bloqueou" — é específico do caminho `GRU→LHR`, a **UI velha**.
- Todas as esperas daquele fluxo são limitadas (`goto` 90s, `networkidle` 45s,
  `waitForCards` 180s). 26 minutos não sai de nenhuma delas.
- Havia **18 processos camoufox vivos** na máquina no momento.

**Próximo passo sugerido:** reprodução fiel — dois `npm run scrape:once --airline
britishairways --from GRU --to LHR` em paralelo. É o único cenário que de fato
travou. Se não reproduzir, suspeitar do estado da máquina naquele momento.

---

## 3. 🟡 LATAM: ida-e-volta não implementada, e as rotinas de teste não rodaram

O site **não respondeu a nenhuma busca** durante a sessão inteira — 6 tentativas,
5 pares de rota/data, com e sem aquecimento pela home, headless e headful. Todas
caíram em `oferta-voos/erro/tempo-resultados-busca`.

Não é a URL de RT nem o fluxo novo: **o one-way que já existia falha igual**
(`zero cards and no empty-state marker`). E não é o camoufox — a BA usa o mesmo e
funcionou na mesma janela.

**Estado atual:**

```
airlines.latam.has_roundtrip = false
scraping_jobs latam           = 2 pending, com erro "zero cards"
flight_fares latam            = 0 linhas
```

As três rotinas de teste da LATAM continuam sem nenhuma coleta.

**Quando o site voltar:** rodar `npx tsx scripts/inspect-rt-latam.ts GRU CNF
<ida> <volta>` e conferir se `1-rt-idas.json` traz `cardCount > 0`. As quatro
perguntas em aberto estão em `scraping.API` ·
`memory/latam/scraper-architecture.md`.

---

## 4. 🟡 BA na UI nova (mercado fora do Brasil) segue em duas buscas só-ida

`britishairways.ts` só faz ida-e-volta real quando `isBrazilianCountry(originCountry)`.
Fora disso cai para duas buscas independentes, com log dizendo por quê.

O motivo é honesto: o fluxo da UI nova não foi medido. Montar `trip=return` sem
conferir trocaria uma limitação conhecida por dado errado.

Fica pendente também para o item 1 (o link de compra da UI nova).

---

## 5. 🟡 Calendário de preços ainda não foi segregado em ida e volta

Decisão 5/6 do `moeda-design.md`: o `FareCalendar` deveria virar duas faixas
(ida e volta), cada uma na sua janela de datas e com a moeda no cabeçalho, e a
célula de "total do par" deveria sumir.

**Entregue:** card por jornada e alvo fixo em R$.
**Não entregue:** o redesenho do calendário e as duas curvas no
`PriceHistoryPanel`.

Hoje o calendário ainda mostra o TOTAL do par por célula — que, além de somar,
esconde de qual data de volta aquele total veio.

O desenho proposto (faixas, moeda no cabeçalho, régua por faixa, cuidado com
mobile) está em `moeda-design.md` §5.4.

---

## 6. 🟢 Restos de arquitetura, sem urgência

**Os 8 campos achatados continuam no payload.** `best_cash_outbound`,
`best_pts_inbound` e companhia seguem sendo enviados junto com `journeys[]`, como
ponte enquanto o front migra. Saem quando o front usar só as jornadas.

**`airports.currency` ficou de pé, sem consumo** (decisão de 2026-08-04). É uma
armadilha: os dados estão errados (BA com GBP nos 1192 aeroportos, inclusive os
46 no Brasil) e alguém pode religar a coluna sem saber disso.

**`RoutineCard` ainda tem `c.currency ?? routine.currency`.** Desde o passo 7,
`routine.currency` é a unidade do ALVO (sempre BRL), não a moeda da coleta — usar
como fallback de exibição é semanticamente errado. Hoje é inalcançável (só
renderiza quando há tarifa, e aí `c.currency` veio preenchido), mas é o mesmo
padrão que estava rotulando errado no e-mail antes do passo 5.

**`getPriceHistory` escolhe UMA moeda** (a mais recente / mais frequente) em vez
de devolver uma série por moeda. Resolve a mistura, mas o gráfico por moeda com
curva por perna — decisão 3 — depende do front pedir por jornada.

---

## 7. ⚪ Operacional

**Nada foi pushado.** Todos os commits desta sessão estão locais:

| projeto | branch | commits à frente |
|---|---|---|
| scraping.API | `feat/autonomous-scrapers` | 8 |
| flight.API | `feat/roundtrip-analysis` | 8 |
| flight.DB | `feat/roundtrip-analysis` | 4 |
| flight.FRONT | `feat/roundtrip-analysis` | 1 |
| flight-monitoring.IA | `feat/roundtrip-analysis` | 7 |

`.claude/settings.local.json` tem alterações não commitadas (permissões
acumuladas na sessão) — `.claude` está no `.gitignore`, então ficou como está.
`gol-coverage.json` também segue sem rastreamento: já estava assim quando a
sessão começou.

**As 6 rotinas de teste (Ryanair e BA) estão inativas e sem `target_cash`.** Elas
coletam quando despachadas à mão, mas **não disparam alerta** — o ciclo de
avaliação só roda sobre rotina ativa. Para exercitar conversão, watermark por
composição e o e-mail com moeda por perna, é preciso ativar uma e definir um alvo
em reais.

**As migrations 013–016 foram aplicadas no dev**, e o `01-schema.sql` reflete as
que são DDL.
