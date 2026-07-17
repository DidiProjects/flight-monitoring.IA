# Análise de Ida-e-Volta (Round-Trip) — Design da Feature

> Proposta de arquitetura para tratar viagens de ida-e-volta como uma **única
> intenção do usuário**, capturando descontos RT quando existirem, sem explodir
> a carga de scraping nem quebrar o reaproveitamento de tarifas entre usuários.
>
> Data: 2026-07-17 · Escopo: `flight.FRONT`, `flight.API`, `flight.DB`, `scraping.API`
> Status: 🟡 proposta — aguarda **Fase 0** (experimento de decomponibilidade)

---

## 1. Contexto e problema

Hoje a interface aceita análises de ida-e-volta, mas cada **perna** vira uma
**rotina separada**. Isso gera três problemas:

1. **Descontos de ida-e-volta são ignorados.** Algumas tarifas RT são mais baratas
   que a soma de duas pernas avulsas — e nunca as vemos, porque só raspamos pernas.
2. **Explosão combinatória.** Um grid de 5 datas de ida × 5 de volta gera 25
   combinações → o risco é virar 25 análises.
3. **Reaproveitamento difícil.** Passou a ser possível ter mais de uma análise
   para o "mesmo voo" com tarifas diferentes, dificultando reusar análises já
   rodadas entre usuários distintos.

### Estado atual do sistema (relevante para o design)

- `routines` **não tem mais** campos `return_*` — foi removido. A ida-e-volta hoje
  é modelada como duas rotinas *one-way*. (ver `agents/flight-db.md`)
- Scraping é **por perna**: `scraping_jobs` tem `UNIQUE(airline, origin,
  destination, flight_date)`. **Um job por perna-data, compartilhado entre todas
  as rotinas/usuários que querem aquele trecho.** → o reaproveitamento correto
  **já existe** na camada de coleta.
- `flight_fares` (bruto, TTL ~30d) → `flight_fares_daily` (agregado). Agnóstico a
  usuário.
- `EvaluationService` (a cada 5 min): foto fresca (≤48h) → melhor tarifa por data
  no alvo → watermark por data + `routineFloor` → gate de recorde → 1 alerta/rotina.
  (ver `target-alert-ajustes.md`)
- Scraper Azul: input já rotulado **"Datas (Ida e volta)"**, URL com params
  indexados `c[0]…` (logo `c[1]` = volta é suportado pelo site), e já navega
  calendário (`.booking-calendar__cards`) — colhe várias datas numa sessão.

---

## 2. O nó da questão: o desconto é *decomponível*?

A decisão que define 90% do plano é uma pergunta **empírica**:

> `preço(ida+volta) == preço(ida avulsa) + preço(volta avulsa)` ?

| Cenário | Realidade típica | Consequência de design |
|---------|------------------|------------------------|
| **Decomponível** | Doméstico *point-to-point* (Azul nacional em geral) | RT = **soma**. Modelo atual por perna é o **ótimo**. Problema é só de agrupamento/apresentação. |
| **Não-decomponível** | Fares RT promocionais, internacional | Preço é função do **par** (ida, volta). Precisa capturar o par. |

**Nenhuma linha de código antes de medir isto.** É o objetivo da **Fase 0**.

---

## 3. O princípio: separar 3 camadas

O erro que gera os 3 problemas é colar três conceitos que os grandes sistemas de
shopping aéreo (ITA/QPX → Google Flights, Skyscanner, Kiwi) mantêm **separados**:

| Camada | O que é | Chave correta |
|--------|---------|---------------|
| **1. Intenção do usuário** | "VCP↔GRU, ida D1–D5, volta R1–R5" | por usuário/rotina |
| **2. Unidade de coleta (scrape)** | o átomo que raspa e **cacheia** | **só parâmetros de mercado** (cia, origem, destino, data[s], pax, cabine) — **nunca** usuário |
| **3. Combinação precificável** | como monta o preço RT p/ comparar com o target | **derivado**, calculado em memória |

### Como isso mata cada problema

- **25 combinações → 25 análises?** Só se a *unidade de coleta* for o par. Se a
  unidade for a **perna**, são **5 + 5 = 10** coletas (já compartilhadas entre
  usuários) e as 25 combinações são **25 somas em memória** (custo zero).
- **Reaproveitamento?** A chave do cache carrega **só dimensões que mudam o preço**.
  Se o desconto RT é decomponível, "ida-e-volta" **não** é dimensão de preço → uma
  tarifa de perna serve todos → reuso perfeito por construção.
- **Duas rotinas por viagem?** É a camada 1 vazando. Uma viagem RT é **uma** rotina
  com flag + duas janelas de data.

---

## 4. Plano faseado

### Fase 0 — Validar decomponibilidade (BLOQUEANTE · ~1 dia · `scraping.API`)

Experimento: 1 sessão de busca RT na Azul; capturar total RT **e** as duas pernas
avulsas dos mesmos voos; comparar.

- Confirmar também se **uma única busca RT** já entrega os dois grids + total numa
  sessão só (o input "Datas (Ida e volta)" e a navegação de calendário sugerem que
  sim). Se sim, mesmo o caso não-decomponível custa **~1 sessão**, não 25.

**Saída:** decide se a Fase 2 existe. Documentar o resultado neste arquivo.

### Fase 1 — Unificar intenção + avaliação decomposta (cobre o caso doméstico)

Mata o 25× e a dupla-rotina. **Coleta permanece por perna → zero mudança em
`scraping_jobs`/`flight_fares`, reuso intacto.**

- **flight.DB**
  - `routines += trip_type TEXT NOT NULL DEFAULT 'one_way'` (`CHECK IN
    ('one_way','round_trip')`).
  - `routines += inbound_start DATE, inbound_end DATE` (NULL p/ one-way; NOT NULL
    logicamente quando `trip_type='round_trip'`).
  - Atualizar **init-scripts/01-schema.sql** *e* criar **migration numerada** (o DB
    não tem framework de migração — ver `agents/flight-db.md`).
- **flight.API**
  - Derivação de jobs: rotina RT deriva jobs das **duas** janelas (ida + volta),
    reusando os mesmos jobs de mercado.
  - `EvaluationService`: preço RT = `min(ida na janela) + min(volta na janela)`
    (ou por combinação, se houver acoplamento — ver §5). A "headline"/gate de
    recorde passa a operar sobre o **par**; reusa watermark + `routineFloor` do
    `target-alert-ajustes.md`.
  - `NotificationsService`: card mostra o par (ida D + volta R + total).
  - Zod schemas + `RoutinesRepository` para os campos novos.
- **flight.FRONT**
  - `RoutineForm`: toggle *só-ida / ida-e-volta*; quando RT, dois
    `DateRangePickerField` (janela de ida e de volta).
  - `RoutineCard`: exibe o par + total.
  - Tipos `routines.ts` + `fromApi()` (snake→camel).

### Fase 2 — Capturar a "bundle fare" (SÓ se a Fase 0 provar desconto RT real)

- Guardar a tarifa RT do par `(cia, origem, destino, data_ida, data_volta)` como
  **override**, colhida na **mesma sessão de matriz** (não 25 sessões).
- Nova tabela `roundtrip_fares` (ou coluna de bundle) chaveada **só por mercado**.
- Avaliação: `min(soma_das_pernas, bundle)` → nunca mente; o caminho decomposto
  segue servindo quem não tem desconto.
- Scraper: uma sessão RT harvest → matriz de pares.

> **Restrição operacional #1 respeitada:** stealth / carga de scraping (batch=1,
> IP único). Nenhuma fase multiplica sessões de browser.

---

## 5. Edge cases e decisões em aberto

- **Acoplamento de datas (min/max-stay):** se o produto exigir "mínimo N noites",
  a avaliação não pode fazer `min(ida)+min(volta)` livre — precisa iterar as 25
  combinações válidas (barato em memória). Decidir se essa restrição existe.
- **Cias diferentes por perna:** ida numa cia, volta em outra (RT "self-transfer").
  Permitir? Se sim, RT decomposto lida naturalmente; bundle não.
- **Moeda:** `airports` define moeda por origem. Ida e volta podem ter origens em
  moedas diferentes (internacional) — total RT precisa normalizar moeda.
- **Prioridade cash/pts/hyb:** o par precisa ser comparado na mesma dimensão de
  preço da rotina (`priority`). Somar/comparar cash com cash, pts com pts.
- **`cleanupPastDates` no RT:** quando a data de **ida** vira passado mas a de volta
  ainda é futura (ou vice-versa), o par inteiro expira. Alinhar com o Furo 2 do
  `target-alert-ajustes.md`.
- **One-way não regride:** `trip_type='one_way'` deve seguir idêntico ao fluxo
  atual — a Fase 1 é aditiva.

---

## 6. Impacto por projeto (resumo)

| Projeto | Fase 1 | Fase 2 |
|---------|--------|--------|
| **flight.DB** | `trip_type` + janela de volta (schema + migration) | tabela/coluna de bundle RT |
| **flight.API** | derivação 2 janelas + avaliação decomposta + notif. do par | `min(soma, bundle)` |
| **flight.FRONT** | toggle RT + 2 date pickers + card do par | — |
| **scraping.API** | — (coleta por perna inalterada) | sessão RT harvest → matriz de pares |

---

## 7. Próximos passos

1. ⬜ **Fase 0** — rodar o experimento de decomponibilidade na Azul e registrar o
   número aqui (§2).
2. ⬜ Se decomponível → implementar **Fase 1** e encerrar. Se não → Fase 1 + Fase 2.
3. ⬜ Fechar as decisões em aberto de §5 (min-stay, cias mistas, moeda) antes do DDL.
