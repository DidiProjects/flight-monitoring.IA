# flight-monitoring.IA

Orquestrador de IA do ecossistema de monitoramento de preços de voos. A partir
daqui o trabalho nos quatro projetos é coordenado com subagentes que já sobem
com o contexto do projeto carregado.

## Projetos

| Projeto | Responsabilidade |
|---------|-----------------|
| flight.API | REST Fastify — negócio, webhooks, alertas por e-mail |
| flight.FRONT | React/MUI — interface |
| flight.DB | PostgreSQL — schema, migrations, Docker |
| scraping.API | Playwright — coleta preços nos sites das companhias |

```
flight.FRONT → flight.API ←→ flight.DB
                    ↕
              scraping.API → [sites das companhias]
```

Rotina criada no FRONT → API persiste e agenda → scraping.API coleta e devolve
por webhook → API avalia e alerta.

## Estrutura

```
flight-monitoring.IA/
├── agents/        # contexto por projeto, consumido ao spawnar subagente
├── design/        # propostas de arquitetura ainda NÃO implementadas
├── CLAUDE.md      # instruções de orquestração
└── README.md
```

## Onde vivem as instruções de IA

| Camada | Onde | O quê |
|---|---|---|
| Global | `~/.claude/CLAUDE.md` e `~/.claude/rules/` | autonomia, commits, PRs, testes, comentários — carrega em todo repositório |
| Projeto | `<repo>/CLAUDE.md` | só as armadilhas daquele projeto |
| Orquestração | este repositório | mapa do ecossistema e como spawnar subagente |

**Cada regra tem um dono só.** Nada que vale para todos os projetos é repetido
num projeto; nada específico de um projeto sobe para o global. Mudar a regra de
commit é editar um arquivo, não cinco.

O global é pessoal e não versionado: vive na máquina, fora do git.

## Como usar

Abra este repositório no Claude Code e descreva o problema. O agente identifica
o projeto afetado, carrega `agents/<projeto>.md` e spawna um subagente
especializado — sem re-explorar o código do zero a cada sessão.
