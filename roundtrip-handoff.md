# Round-Trip — Onde Paramos

> Estado em **2026-07-25**. Continuação do `roundtrip-design.md`.
> Tudo descrito aqui está **commitado**.

---

## 1. Situação em uma frase

O laço **1-para-N** está ligado ponta a ponta (scraper → contrato → banco →
avaliação → card) e a **volta indefinida** está tratada. Falta a validação
end-to-end contra o site real e a decisão sobre o gargalo.

---

## 2. Commits

### Sessão 2026-07-24 (Fase 1)

| Repo | Branch | Commit |
|------|--------|--------|
| flight.DB | `feat/roundtrip-analysis` | `bad6a40` |
| flight.API | `feat/roundtrip-analysis` | `38d09ce` |
| flight.FRONT | `feat/roundtrip-analysis` | `0aee530` |
| scraping.API | `feat/roundtrip-experiment` | `5c6af80` |

### Sessão 2026-07-25 (4.1 laço 1-para-N + 4.2 volta indefinida)

| Repo | 4.1 | 4.2 |
|------|-----|-----|
| scraping.API | `f1396f9` | (ver git log) |
| flight.API | `ef4db33` | (ver git log) |
| flight.DB | `8ea11a5` (migration 010) | migration 011 |
| flight.FRONT | — | card mostra "—" |

Migrations aplicadas **só no banco local** (010 e 011 conferidas no
`pg_indexes`/`information_schema`, não só no log). Produção intocada.

---

## 3. O que está pronto

### O laço 1-para-N (4.1)

As voltas são precificadas **no contexto da ida escolhida**. Não existe "a lista
de voltas" — existe uma lista por ida.

- `azulParse.ts`: o parsing de card→`FlightOffer` saiu de dentro do
  `collectAllFares`. Módulo puro, sem playwright — testável de verdade, em vez da
  cópia da lógica que os testes mantinham.
- `parseCards` preserva o vínculo oferta↔card. O parser descarta cards (sem
  horário, sem duração, duplicados), então casar por índice de array depois do
  descarte abriria as voltas da ida errada.
- `azulRoundTrip.ts` virou só navegação; `openReturnsForOutbound` devolve **o
  motivo** da falha em vez de uma lista vazia ambígua.
- `collectRoundTripFares`: por ida, abre as voltas, parseia e volta com `goBack`.
  A tarifa de ida é selecionada em **reais** — em pontos a Azul exige login.
- Avaliação: `total(O) = tarifa(O) + min(tarifa(R) : R.paired_outbound_flight = O)`.
  Coleta anterior ao carimbo cai no comportamento antigo, senão o que já está no
  banco pararia de ser avaliado.

### Volta indefinida (4.2)

- `detectLoyaltyLoginWall` é conservador de propósito: só afirma "login" com
  campo de senha ou diálogo falando de TudoAzul. Confundir "volta sumiu" com
  "precisa de login" transformaria corrupção em par tolerado em silêncio.
- `flight_fares.inbound_unavailable` (migration 011), marcada só na **ida**.
- Avaliação tolera nos **dois níveis**: par sem nenhuma volta, e ida específica
  sem volta vinculada. Tolerado = log info, sem Grafana, **sem total, sem alerta**.
- `/fares/current` devolve `inbound_unavailable` e o card mostra **"—" + "volta
  não disponível"**, em vez do enganoso "sem preço coletado ainda".

### Testes

| Repo | Antes | Agora |
|------|-------|-------|
| scraping.API | 53 | 82 |
| flight.API | 93 | 119 (13 arquivos, integração incluída) |
| flight.FRONT | 42 | 46 |

Integração roda contra Postgres real:
`TEST_DATABASE_URL="postgres://admin:admin123@localhost:5433/dev-flightDB" npm test`

---

## 4. Bugs encontrados no caminho

### 4.1 O par nunca fechava (corrigido — era bloqueante)

O par era casado por `flight_date`, mas a perna de volta carrega **a data dela**,
não a da ida. As duas pernas caíam em grupos diferentes e **todo par real era
descartado como incompleto** — a avaliação RT jamais produziria um total.

A identidade do par é o **`request_id`**: as duas pernas saem da mesma busca.
`getLatestPairs` e `getCurrentBestPair` agora casam por request_id e expõem
`pair_outbound_date` (vindo da perna de ida).

**Por que os testes não pegaram:** o fixture `pair()` dava o mesmo `flight_date`
às duas pernas — codificava exatamente a suposição errada. Corrigido, e agora há
teste de integração contra Postgres real que reproduz o formato verdadeiro.

### 4.2 O dedup colapsaria o 1-para-N (corrigido, migration 010)

A chave era `(request_id, flight_date, is_return, flight_number)`. A **mesma
volta** aparece na lista de várias idas com preço diferente em cada uma — o
mecanismo do desconto. O `ON CONFLICT DO NOTHING` guardaria só a primeira: o laço
rodaria e o dado não existiria. `paired_outbound_flight` entrou na chave.

### 4.3 Testes de integração quebrados desde a sessão anterior (corrigido)

O schema-espelho do `FlightFaresRepository.integration.test.ts` era de `3c70e79`
e não tinha `return_date` — os 4 testes falhavam desde `38d09ce`. Passam
despercebidos localmente porque são pulados sem `TEST_DATABASE_URL`; **no CI, que
define a var, estavam falhando**. Espelho atualizado + 5 testes de par novos.

### 4.4 `parseBrlAmount` 100x (NÃO corrigido — de propósito)

Sem separador decimal o valor sai 100x maior (`"R$2.84350"` → 284350). Na prática
o card traz a vírgula num `<span class="decimal">`, então o `innerText` sempre tem
separador. Fixado em teste e documentado. Não "consertei" às cegas: um palpite
errado aqui transformaria preços corretos em preços 100x errados, e não há como
validar contra o site (IP bloqueado).

---

## 5. O que falta

### 5.1 Validação contra o site real (o próximo passo)

Nada do laço 1-para-N foi exercido contra a Azul de verdade — o IP daqui está
bloqueado ("Ops! Só um momento. Identificamos um comportamento incomum vindo do
seu IP"). Precisa rodar de onde o acesso está liberado.

O que só o site pode responder:
- o `goBack` realmente recarrega a lista de idas N vezes seguidas, ou a sessão
  se perde depois de algumas?
- `detectLoyaltyLoginWall` acerta o modal real? (os seletores são heurística
  conservadora, não confirmação)
- quanto tempo custa uma busca RT com N idas?

### 5.2 O gargalo (decisão pendente)

- Rotina RT com janela 30×30 → **900 jobs**
- Cada job agora exige **N navegações** (uma por ida) com `goBack` entre elas
- Tudo com `batch=1` e IP único

**Não pus teto no número de idas de propósito:** um cap jogaria fora o dado das
idas cortadas e criaria falsos "par incompleto". A decisão é de produto.

Ideias não avaliadas: limitar a janela de RT, capar pares por rotina, priorizar
só as datas mais promissoras.

### 5.3 Bundle (Fase 2)

`flight_fares.bundle_*` existe e **está sempre nulo** — ninguém preenche. A
avaliação usa `min(bundle, soma)`, então hoje é sempre a soma das duas pernas da
mesma busca RT. Correto como fallback, mas não captura desconto explícito.

---

## 6. Decisões de produto fechadas

- **Max-stay: 3 meses** entre ida e volta (`MAX_ROUNDTRIP_SPAN_MONTHS`), constante
  da aplicação, não coluna.
- **Mesma companhia** nas duas pernas — só assim o desconto é identificável.
- **Mesma moeda** nas duas pernas; par com moedas diferentes não é avaliado.
- **Volta indefinida (2026-07-25): exibe "—", não alerta.** Se a volta é
  desconhecida, o preço da ida não é o preço da viagem.
- **Furo 2** do `target-alert-ajustes.md`: mantido o comportamento atual.

---

## 7. Armadilhas que já custaram caro

1. **`__name is not defined`** — nada de função nomeada dentro de `page.evaluate`.
   Atribuir arrow a `const` **também conta**. Usar inline puro.
2. **IP bloqueado pela Azul** — validação real depende de rodar de onde o acesso
   está liberado. Não insistir em tentativas.
3. **`NULL != NULL`** em UNIQUE: sem `NULLS NOT DISTINCT`, cada upsert de ida
   viraria linha nova.
4. **Migration/edição que "aplicou" sem aplicar** — sempre conferir o resultado
   (`pg_indexes`, `information_schema`), não o log do script.
5. **Fixture que codifica a suposição errada** — o par com `flight_date` igual nas
   duas pernas fez 30+ testes passarem sobre um bug que impedia a feature de
   funcionar. Quando o teste é o único juiz, ele precisa refletir o formato REAL
   do dado. Foi o teste de integração contra Postgres que revelou.
6. **`cd x && cmd` no Bash** dispara prompt de permissão; usar `git -C <path>`.

---

## 8. Como retomar

1. Ler este arquivo e `roundtrip-design.md`
2. Ler `scraping.API/memory/azul/dom-structure.md`, seção **"Busca ida-e-volta (RT)"**
3. Subir a stack: `docker compose up -d` em flight.DB e flight.API;
   `npm run dev` em scraping.API e flight.FRONT
4. Começar por **5.1** — sem o site real, o resto é teoria
