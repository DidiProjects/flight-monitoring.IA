---
name: Preferências e estilo de desenvolvimento do Diego
description: Como o Diego quer trabalhar, autonomia, iteração, diagnóstico, comunicação
type: feedback
---
Trabalhar com máxima autonomia para edições de código, análise e diagnóstico. Não interromper para confirmações a não ser em risco real de perda de dados irreversível.

**Why:** O usuário quer iteração rápida sem ter que aprovar cada ação de código.

**How to apply:** Executar edições diretamente. Só pausar se houver risco real (ex: apagar branch remota, deletar dados de produção).

---

Nunca iniciar o servidor de desenvolvimento (`npx tsx src/main.ts`) nem disparar jobs de scrape automaticamente. Esperar o usuário rodar a API e fornecer os resultados.

**Why:** O usuário quer controlar quando e como a API é executada. Rodar automaticamente interfere no fluxo dele.

**How to apply:** Ao pedir "análise" ou "verificação" de scraper, analisar o código e os arquivos existentes em `scraping-result/`. Se precisar de um novo teste, fornecer o comando PowerShell para o usuário executar — nunca rodar por conta própria.

---

Ao encontrar erros de automação, sempre salvar snapshots HTML + screenshot PNG na pasta `results/.../errors/` (ou `snapshots/`) para diagnóstico posterior.

**Why:** O usuário usa esses arquivos para analisar problemas com o Claude.

**How to apply:** Nunca remover lógica de snapshot/debug do scraper. Adicionar snapshots em pontos-chave do fluxo.

---

O usuário fornece informações sobre a estrutura do DOM no README.md do projeto.

**Why:** É a forma dele comunicar o que viu no DevTools sem precisar explicar verbalmente.

**How to apply:** Sempre ler o README.md completo ao iniciar sessão, pode conter instruções técnicas novas sobre seletores, fluxos ou comportamento do site.

---

Respostas curtas e diretas em português brasileiro. Não explicar o que foi feito, o usuário vê o diff.

**Why:** Preferência explícita do usuário.

**How to apply:** Uma ou duas frases no máximo ao terminar uma tarefa.
