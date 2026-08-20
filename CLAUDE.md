# flight-monitoring.IA — Orquestrador

Ponto central de coordenação do ecossistema. Aqui você identifica em qual
projeto o problema mora, spawna subagentes especializados e sintetiza o
resultado.

Regras gerais (autonomia, commits, testes, comentários) vivem em `~/.claude/` e
carregam sozinhas em qualquer repositório. Cada projeto tem o seu `CLAUDE.md`
com as armadilhas dele. Este arquivo trata só de **orquestração**.

## Projetos

| Projeto | Caminho | Responsabilidade |
|---------|---------|-----------------|
| flight.API | `../flight.API` | REST Fastify — negócio, webhooks, alertas por e-mail |
| flight.FRONT | `../flight.FRONT` | React/MUI — interface |
| flight.DB | `../flight.DB` | PostgreSQL — schema, migrations, Docker |
| scraping.API | `../scraping.API` | Playwright — coleta preços nos sites das companhias |

```
flight.FRONT → flight.API ←→ flight.DB
                    ↕
              scraping.API → [sites das companhias]
```

Rotina criada no FRONT → API persiste e agenda → scraping.API coleta e devolve
por webhook → API avalia e alerta.

## Onde o problema mora

| Sintoma | Projeto |
|---|---|
| Formulário, exibição, valor errado na tela | flight.FRONT |
| Alerta não enviado, comparação, rotina não executada | flight.API |
| Dado incorreto, schema, query lenta | flight.DB |
| Scraping falhando, Playwright travado, webhook não chega | scraping.API |

Antes de escolher, vale checar se o sintoma não é de leitura: **valor errado na
tela pode ser dado certo com rótulo errado**, e aí o projeto é outro.

## Spawnar subagente

1. Ler `agents/<projeto>.md` — é o contexto pronto daquele projeto
2. Acrescentar o problema relatado e a tarefa
3. Spawnar com `working_directory` no caminho do projeto

Paralelizar quando o problema toca dois projetos independentes. Ao final,
sintetizar num resumo só — não despejar o relatório de cada agente.

## Documentos

- `README.md` — visão geral do ecossistema
- `agents/*.md` — contexto por projeto, para subagente
- `design/` — propostas de arquitetura ainda **não** implementadas

Proposta implementada sai daqui: quem descreve o sistema é o código, o
`design.md` do flight.DB e os `CLAUDE.md`. Documento de design que sobrevive à
entrega vira contradição — foi o que aconteceu com o desenho da moeda, que
afirmava "nada convertido é persistido" depois da migration 017 fazer o
contrário.
