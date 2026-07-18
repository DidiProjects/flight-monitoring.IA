# Alerta de Target — Auditoria e Ajustes

> Auditoria de ponta a ponta do fluxo de alerta no modo **target** (flight.API).
> Objetivo de produto: **uma única notificação por rotina quando ela bate um novo
> melhor preço** — nada de vários e-mails por causa do grid de datas, nada de
> repetir notificação no mesmo preço.
>
> Data: 2026-06-30 · Escopo: `flight.API`

---

## 1. Fluxo completo (estado atual)

```
SchedulerService.scheduleEvaluation  (a cada 5 min, SEM sobreposição)
  └─ runCycle → para cada rotina → evaluateRoutine:
       1. foto fresca das tarifas (≤ 48h) de todas as companhias no grid de datas
       2. melhor tarifa DENTRO do alvo por data (colapsa companhias)
       3. watermarks por data + routineFloor = min(watermarks)
       4. candidates = datas com preço < watermark da própria data
       5. recordNotified → upsert atômico monotônico (RETURNING = advanced)
       6. GATE de recorde: só dispara se headline.amount < routineFloor
       7. dispatchAlert → 1 e-mail, 1 card (a headline / mais barata)
```

Arquivos-chave:

| Camada | Arquivo |
|--------|---------|
| Loop / agendamento | `src/services/scheduler/SchedulerService.ts` |
| Lógica de avaliação | `src/services/evaluation/EvaluationService.ts` |
| Watermark (anti-repetição) | `src/modules/target-alert-state/TargetAlertStateRepository.ts` |
| Montagem do e-mail | `src/services/notifications/NotificationsService.ts` |

### Por que o agendador não duplica

O loop re-arma o `setTimeout` **dentro do `finally`, depois** de `await runCycle()`
terminar (`SchedulerService.ts:319-329`). Não é `setInterval` — ciclos **nunca se
sobrepõem** num mesmo processo. Intervalo: `EVALUATION_INTERVAL_MS = 5 min`.

---

## 2. O invariante que garante os requisitos

A supressão usa `headline = a mais barata entre as datas que avançaram`. Logo
**toda** data gravada num ciclo satisfaz `amount ≥ headline ≥ routineFloor`.

> **Consequência: o `routineFloor` só diminui num ciclo que envia e-mail.**

Portanto:

- Cada preço que vira o novo piso da rotina é notificado **exatamente uma vez**.
- Preços **iguais ou piores nunca** notificam.
- Grid de datas → **1 e-mail, 1 card** por ciclo.

Isso atende, por construção, os três requisitos de produto.

### Histórico das mudanças que levaram aqui

1. `eef537f6` — *feat(notifications)*: e-mail passa a exibir **apenas a headline**
   (1 card por rotina). Resolveu "vários cards num e-mail", mas **não** mexia na
   quantidade de e-mails entre ciclos.
2. `8367df4` — *feat(evaluation)*: **gate de recorde por rotina** (`routineFloor`).
   Datas novas que entram no alvo no mesmo preço (ou pior) seguem sendo gravadas
   no watermark por data, mas **não disparam e-mail**.

---

## 3. Furos identificados

### 🔴 Furo 1 — Divergência de desempate (ACIONÁVEL)

**Onde:** `EvaluationService.evaluateRoutine` ↔ `NotificationsService.dispatchAlert`.

O `EvaluationService` calcula o `historyNote` (o "X% abaixo da média") para
`offers[0]` (desempate só por preço), mas passa **todas** as `offers`; o
`dispatchAlert` **re-escolhe** sua própria headline com desempate por `scraped_at`.

**Sintoma:** em empate exato de preço entre datas diferentes, o **card exibido**
pode ser de uma data e o **"% abaixo da média"** de outra. Cosmético, mas real —
e contraria o espírito "uma tarifa só por rotina".

**Correção aplicada (zero efeito colateral):** em vez de passar `[headline.fare]`
(que reduziria o log `dates` do `dispatchAlert` a uma única data — possível
regressão de observabilidade), alinhei a **ordenação das `offers`** ao mesmo
critério que o `dispatchAlert` usa: preço asc, empate → `scraped_at` mais recente.
Assim `offers[0]` é **provadamente** a mesma tarifa que o e-mail renderiza, e o
histórico é calculado para ela. Continua passando todas as `offers` → log intacto,
e-mail idêntico, watermark idêntico. Só a nota de histórico em empate (o bug) muda.

```ts
// EvaluationService.ts — passo 5
const offers = candidates
  .filter((c) => advanced.has(c.flightDate))
  .sort((a, b) =>
    a.amount - b.amount ||
    new Date(b.fare.scraped_at).getTime() - new Date(a.fare.scraped_at).getTime(),
  )
// dispatchAlert segue recebendo offers.map((o) => o.fare) — inalterado.
```

Teste novo: *"empate de preço entre datas — histórico e headline são da tarifa
coletada mais recentemente"* (`EvaluationService.test.ts`). Suíte: **17/17** · `tsc` limpo.

**Status:** ✅ implementado (sem efeito colateral).

---

### 🟡 Furo 2 — `cleanupPastDates` reseta o piso (DECISÃO DE PRODUTO)

**Onde:** `TargetAlertStateRepository.cleanupPastDates` (`DELETE … WHERE flight_date < CURRENT_DATE`).

Quando a data mais barata rastreada vira passado, sua linha é deletada e o
`routineFloor` sobe — ou volta a `Infinity` se todas as datas expiraram. Depois
disso, o **mesmo preço absoluto** pode alertar de novo para uma data futura.

**Leitura:** discutível. A oferta barata antiga expirou, então notificar uma nova
data barata é informação legítima. Mas tecnicamente é "mesmo preço de novo".

**Status:** ⬜ decisão pendente — manter como está (recomendado) ou guardar um
piso histórico independente de data.

---

### 🟡 Furo 3 — Múltiplas réplicas (SÓ SE ESCALAR)

**Onde:** gate de piso em memória (`getWatermarks` → decide → `recordNotified`).

Hoje, com **1 processo**, é à prova de duplicata: ciclos não se sobrepõem e o
`recordNotified` é atômico por data. Com **2+ réplicas**, o passo "ler piso →
decidir" não é atômico entre instâncias — há janela estreita para 2 e-mails no
mesmo novo-mínimo em **datas diferentes**. A dedup por data continua firme; só o
gate de piso ficaria sujeito à corrida.

**Mitigação (se um dia escalar):** mover o gate de recorde para dentro do SQL
atômico (ex.: comparar contra `MIN(notified_amount)` da rotina no próprio upsert)
ou serializar `runCycle` com um lock de aplicação (advisory lock).

**Status:** ⬜ não acionável hoje (deploy single-instance).

---

## 4. Checklist de garantia

- [x] Grid de datas → 1 e-mail por ciclo (`dispatchAlert` chamado 1×)
- [x] 1 card por e-mail (headline) — commit `eef537f6`
- [x] Mesmo preço não repete — watermark por data (monotônico)
- [x] Datas novas no mesmo preço não spammam — gate `routineFloor` (commit `8367df4`)
- [x] Sem sobreposição de ciclos (single-instance) — `arm()` no `finally`
- [x] Furo 1 — ordenação alinhada (preço asc, empate scraped_at) — sem efeito colateral
- [ ] Furo 2 — decisão sobre reset de piso no cleanup
- [ ] Furo 3 — atomicidade do gate se escalar para multi-réplica
