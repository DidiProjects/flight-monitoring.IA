# flight-monitoring.IA — Orquestrador

Este projeto é o ponto central de coordenação do ecossistema de monitoramento de voos. Ao iniciar qualquer sessão aqui, você age como orquestrador: identifica em qual projeto o problema reside, spawna subagentes especializados e sintetiza os resultados.

## Projetos do ecossistema

| Projeto | Caminho | Responsabilidade |
|---------|---------|-----------------|
| flight.API | `C:\Users\diego\Documents\projects\flight.API` | REST API (Fastify) — lógica de negócio, webhooks, alertas por email |
| flight.FRONT | `C:\Users\diego\Documents\projects\flight.FRONT` | Frontend React/MUI — interface do usuário |
| flight.DB | `C:\Users\diego\Documents\projects\flight.DB` | PostgreSQL — schema, migrações, infraestrutura Docker |
| scraping.API | `C:\Users\diego\Documents\projects\scraping.API` | Scraper Playwright + Claude AI — coleta preços no site da Azul |

## Fluxo do sistema

```
flight.FRONT → flight.API ←→ flight.DB
                    ↕
              scraping.API → [Site Azul]
```

O usuário cria rotinas no FRONT → API persiste no DB e agenda scraping → scraping.API executa e retorna ofertas via webhook → API avalia e envia alertas por email.

## Como identificar o projeto afetado

- **Problema de UI / formulário / exibição** → flight.FRONT
- **Alerta não enviado / lógica de comparação / rotina não executada** → flight.API
- **Dados incorretos / schema / query lenta** → flight.DB
- **Scraping falhando / Playwright travado / webhook não chegando** → scraping.API
- **Problema de integração entre serviços** → verificar ambos os lados

## Como spawnar subagentes especializados

Ao receber uma tarefa que envolve um projeto específico, spawne um agente com `working_directory` no projeto correto e forneça contexto suficiente no prompt para evitar re-exploração desnecessária.

### Arquivos de agente (prompts prontos)

Cada projeto tem um arquivo de contexto completo em `agents/`. Ao spawnar um subagente, **leia o arquivo correspondente** e use seu conteúdo como base do prompt:

| Projeto | Arquivo |
|---------|---------|
| flight.API | `agents/flight-api.md` |
| flight.FRONT | `agents/flight-front.md` |
| flight.DB | `agents/flight-db.md` |
| scraping.API | `agents/scraping-api.md` |

### Como montar o prompt do subagente

1. Leia o arquivo `agents/<projeto>.md`
2. Adicione ao final: contexto do problema + tarefa específica
3. Spawne o agente apontando o `working_directory` para o caminho do projeto

```
[conteúdo de agents/<projeto>.md]

---

## Problema relatado

[descrição do que o usuário reportou]

## Tarefa

[o que o agente deve investigar / implementar / corrigir]
```

## Princípios de orquestração eficiente

1. **Identifique antes de agir** — sempre mapeie qual projeto é afetado antes de spawnar agentes
2. **Forneça contexto rico** — inclua stack, estrutura e problema no prompt do subagente para evitar exploração redundante
3. **Paralelize quando possível** — se o problema afeta 2+ projetos independentes, spawne agentes em paralelo
4. **Sintetize os resultados** — após retorno dos subagentes, apresente ao usuário um resumo coeso com as mudanças feitas
5. **Atualize as memórias** — se descobrir algo novo sobre um projeto (nova dependência, decisão arquitetural), atualize os arquivos de memória em `C:\Users\diego\.claude\projects\C--Users-diego-Documents-projects-flight-monitoring-IA\memory\`
