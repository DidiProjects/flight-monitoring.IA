# flight-monitoring.IA

Orquestrador de IA para o ecossistema de monitoramento de preços de voos. A partir deste repositório, coordeno trabalho nos 4 projetos do sistema usando subagentes especializados com contexto pré-carregado.

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

## Estrutura deste repositório

```
flight-monitoring.IA/
├── agents/
│   ├── flight-api.md       # Contexto completo para subagente do flight.API
│   ├── flight-front.md     # Contexto completo para subagente do flight.FRONT
│   ├── flight-db.md        # Contexto completo para subagente do flight.DB
│   └── scraping-api.md     # Contexto completo para subagente do scraping.API
├── CLAUDE.md               # Instruções de orquestração para o Claude Code
└── README.md
```

## Como usar

Abra este repositório no Claude Code e descreva o problema. O agente identifica automaticamente qual projeto é afetado, carrega o contexto do arquivo `agents/<projeto>.md` e spawna um subagente especializado para investigar ou implementar — sem precisar re-explorar o código do zero a cada sessão.
