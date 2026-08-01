# Round-Trip — Onde Paramos

> Estado em **2026-08-01**. Continuação do `roundtrip-design.md`.
> Tudo descrito aqui está **commitado**.

---

## 1. Situação em uma frase

O laço **1-para-N funcionou contra o site real** (5 idas × 5 voltas, zero
falhas) e o total já aparece segregado em ida e volta. Falta decidir o gargalo —
e a primeira coleta real levantou a suspeita de que o desconto RT pode não
existir na rota testada.

---

## 1.1 A corrida que fechou o ciclo — 2026-08-01

`GRU→CNF 21/09` com volta `25/09`, 5 idas, **25 voltas**, nenhum snapshot de
erro. Parse conferido contra o HTML do snapshot: bate.

| Perna | Melhor |
|---|---|
| Ida | AD2881 21:40 — R$ 416,65 |
| Volta | AD2724 / AD2880 / AD4212 — R$ 467,05 |
| **Par** | **R$ 883,70** |

⚠ **As 5 idas devolveram voltas com preços idênticos.** Não é releitura: são
voltas de verdade (CNF→GRU), são 5 e não 2, e os valores diferem da prévia. O
desconto 1-para-N simplesmente **não se manifestou nesta rota/data**.

Se isso se repetir, o laço paga N navegações para obter a mesma lista N vezes —
e aí dá para detectar que a lista não mudou e cortar na segunda ida. **Precisa
de 2 ou 3 rotas a mais antes de virar código.**

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

### Sessão 2026-08-01 (validação real + segregação + RT só em dinheiro)

| Repo | Commit |
|------|--------|
| scraping.API | `6206a85` |
| flight.API | `60644fb` |
| flight.FRONT | `2e8c4a7` |
| flight.DB | `9f43cbd` (migration 012) |

Migrations aplicadas **só no banco local** (010 e 011 conferidas no
`pg_indexes`/`information_schema`, não só no log; a 012 afetou 0 linhas porque a
única rotina RT já estava em `cash`). Produção intocada.

Testes: scraping.API 98 · flight.API 125 · flight.FRONT 46.

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

### 5.1 Validação contra o site real — ✅ FEITA (2026-08-01)

Rodou. O que o site respondeu, e que nenhum teste tinha como antecipar:

- **"Selecionar tarifa" já troca a tela para as voltas.** O rodapé "Continuar"
  só aparece quando não havia nada a selecionar. Exigi-lo sempre abortava o laço
  **já estando na lista de voltas**.
- **`button.btn-fare` tem `pointer-events: none`** no CSS base; o desktop devolve
  só o `display`. Clicar nele espera uma actionability que nunca chega.
- **`goBack` foi substituído** por "Trocar esse voo" no cabeçalho da perna.
- **A ida escolhida continua na tela das voltas**, com a mesma rota e um
  `btn-fare` ("Alterar tarifa") — daí "voltamos?" exigir a perna de ida **sem
  voo escolhido**.
- **Dois toggles de moeda na página.** Só o `div.currencySelector` da lista
  repreça os cards, e ele **não existe** na tela de voltas.
- `detectLoyaltyLoginWall` **não foi exercido**: com a ida em reais o modal não
  apareceu. Segue heurística não confirmada.

Tudo em `scraping.API/memory/azul/dom-structure.md`.

### 5.2 O gargalo (decisão pendente — agora com dado real)

- Rotina RT com janela 30×30 → **900 jobs**
- Cada job exige **N navegações** (uma por ida), com "Trocar esse voo" entre elas
- Tudo com `batch=1` e IP único

**Não pus teto no número de idas de propósito:** um cap jogaria fora o dado das
idas cortadas e criaria falsos "par incompleto". A decisão é de produto.

⚠ A corrida de 2026-08-01 dá um argumento novo: as 5 idas renderam **a mesma
lista de voltas**. Se isso for a regra, o custo de N navegações compra dado
repetido, e o corte natural é parar quando a lista de voltas não muda. Confirmar
em outras rotas antes.

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
- **RT só em dinheiro (2026-08-01, TEMPORÁRIA).** Com a ida escolhida em reais a
  Azul não oferece a troca de moeda na tela de voltas, então a volta nunca tem
  `fare_pts`. Rotina RT em pts/híbrido é recusada no front e no back; migration
  012 saneia as existentes. Cai quando a volta em pontos for obtível.
- **Total exibido segregado (2026-08-01):** ida e volta do par vencedor, nulas
  quando o total vem de bundle. As parcelas vêm sempre da MESMA combinação.
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
7. **Um passo do fluxo que "faltava" pode ser um passo que sobra.** O "Continuar"
   foi adicionado para destravar um caso e virou o próprio bloqueio no caso
   normal. Antes de exigir um controle, perguntar se o objetivo dele já não
   aconteceu — e tratar ausência como informação, não como falha.
8. **Elemento certo, lugar errado.** Havia dois toggles de moeda; o fallback
   global pegava o do formulário de busca, clicava, não repreçava nada e ainda
   pagava 15s por ida. Fallback que amplia o escopo do seletor acerta silêncio.

---

## 8. Como retomar

1. Ler este arquivo e `roundtrip-design.md`
2. Ler `scraping.API/memory/azul/dom-structure.md`, seção **"Busca ida-e-volta (RT)"**
3. Subir a stack: `docker compose up -d` em flight.DB e flight.API;
   `npm run dev` em scraping.API e flight.FRONT
4. Rodar **2 ou 3 rotas RT diferentes** e comparar as listas de voltas entre as
   idas. É isso que decide o §5.2: se a lista nunca muda, o laço N-navegações
   compra dado repetido e o corte é natural.
