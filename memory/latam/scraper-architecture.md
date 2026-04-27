---
name: LATAM — arquitetura do scraper
description: Fluxo, decisões e limitações do scraper da LATAM Airlines
type: project
---

## Stack

Mesmo da Azul: camoufox-js + playwright Firefox + DOM scraping.
Arquivo: `src/scrapers/latam.ts`

## Fluxo de busca

```
searchFlights(params, cpf?, password?)
  ├── BRL outbound: searchDateRange(..., redemption=false, isReturn=false)
  ├── BRL return:   searchDateRange(..., redemption=false, isReturn=true)  [se returnStart]
  └── se LATAM_CPF + LATAM_PASSWORD:
       ├── Pts outbound: searchDateRange(..., redemption=true, isReturn=false)
       │     ├── Login uma vez (CPF + senha)
       │     └── Para cada data: navega URL redemption=true, extrai milhas
       └── Pts return: idem com rota invertida
           └── mergePoints() → funde fares.points nos FlightOffer já existentes (match por IATA + hora)
```

## Modo BRL

- URL: `redemption=false`
- Preço extraído de: `[data-testid="flight-info-{i}-amount"] [aria-hidden="true"]`
- Formato texto: `"brl 538,54"` → parsed como BRL float

## Modo Pontos

- URL: `redemption=true`
- Requer login (CPF + senha via `LATAM_CPF` / `LATAM_PASSWORD` env vars)
- Login feito uma vez por contexto de browser
- Após login, re-navega para a URL de busca
- Preço: `[data-testid="loyalty-points-wrapper"] .displayAmount span`
- Formato texto: `"15.778 milhas"` → parsed como int
- Sem híbrido (o "BRL 33,64" que aparece é taxa fixa, descartado)
- Se login falhar: log warn + interrompe busca de pontos (retorna só BRL)

## Limitações conhecidas

- **Flight number sintético**: LATAM não expõe o número do voo no card. Usamos `LA{IATA}{HHMM}` como chave. O modal de detalhes do itinerário teria o número real mas não foi implementado (lento — N clicks por N cards).
- **Sem modo híbrido**: LATAM não tem tarifa híbrida estruturada como a Azul. O componente BRL na busca de pontos parece taxa fixa.
- **Login frágil**: CAPTCHA ou 2FA não são tratados. Se login falhar, o job continua apenas com BRL.

## Env vars

```
LATAM_CPF       (opcional) — CPF para login e busca de pontos
LATAM_PASSWORD  (opcional) — senha da conta LATAM
```

Se ausentes: busca apenas BRL.

## Arquivos per-date no runDir

```
{runDir}/{date}/
  latam-{ORIG}-{DEST}.json        ← BRL offers
  latam-{ORIG}-{DEST}-pts.json    ← points offers (só se logado)
```
