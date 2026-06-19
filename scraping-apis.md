# APIs de dados de voo — probe antes do scraping

Estudo das opções para **consultar uma API antes de raspar o site da Azul** (padrão probe → fallback). Objetivo: reduzir scraping (menos bloqueio de IP, alivia o teto de vazão) usando uma API como pré-filtro, mantendo o scraping como fonte autoritativa do preço.

## Verdade dura

- **A Azul não oferece API pública e gratuita de tarifas.** Nenhuma companhia oferece. O conteúdo oficial da Azul é distribuído via **NDC B2B** (ex.: APG) ou agregadores pagos, sempre com credenciamento de agência/seller.
- **Evitar:** APIs grátis de **horário/status** de voo (AviationStack, Aerodatabox, FlightAPI) — entregam schedule/status, **não preço**. Inúteis para monitoramento de tarifa.

## Opções

| Serviço | Grátis? | Cobre Azul? | Tempo real? | Observação |
|---|---|---|---|---|
| **Amadeus Self-Service** (Flight Offers Search) | ✅ 2.000 req/mês | ❌ **exclui LCCs** | — | Documentação exclui explicitamente low-cost. Azul fora. Descartado. |
| **Kiwi.com Tequila** | ✅ free tier (registro + key) | ⚠️ provável (750+ cias, virtual interlining) | ✅ busca real | **Melhor candidato grátis.** Preço é o do Kiwi (markup/interlining), **não bate exatamente** com o site da Azul. |
| **Travelpayouts / Aviasales Data API** | ✅ com token afiliado | ⚠️ parcial | ❌ **cache** (buscas das últimas 48h, guardado 7 dias) | Bom para tendência de preço, ruim para "esse voo está barato agora". |
| **Duffel** | ❌ ($99/mês+ / por pedido; test mode = preços falsos) | ✅ (NDC) | ✅ | Cobre Azul de verdade, mas pago e exige ser seller. |
| **APG NDC** | ❌ B2B | ✅ conteúdo completo | ✅ | Credenciamento de agência. |

## Recomendação

Para um **probe gratuito**, o único viável é o **Kiwi Tequila**, com ressalva: a tarifa do Kiwi **não é a fonte de verdade**. Desenho do fluxo:

1. **Probe (Kiwi)** — pergunta barata: "existe alguma tarifa plausivelmente boa nessa rota/data?"
2. **Filtro leniente** — só **pula** o scraping quando o probe indica preço claramente alto. Na dúvida, **scrapeia** (evita falso-negativo que perderia uma promo real do site).
3. **Scraping da Azul** — continua a fonte autoritativa do preço que vai para o alerta.

Bônus: menos scraping → menos risco de bloqueio + alivia o teto de vazão (`SCRAPE_DISPATCH_BATCH=1`).

## Antes de investir na integração

O valor do probe depende de o Kiwi ter cobertura decente da Azul nas rotas reais (ex.: CNF→VCP). **Validar empiricamente** primeiro: pegar uma key de teste do Tequila, rodar 5–10 rotas comparando `preço Kiwi × preço voeazul.com.br`. Se a correlação for boa, vale integrar; se o Kiwi quase não tiver Azul doméstico, o probe não ajuda — melhor focar em stealth/escala (rotação de IP, concorrência por companhia no scraper).

## Fontes

- Amadeus Flight Offers Search (exclui LCCs) — https://developers.amadeus.com/self-service/category/flights/api-doc/flight-offers-search
- Amadeus Self-Service (catálogo/quotas) — https://developers.amadeus.com/self-service
- Kiwi.com Tequila API — https://tequila.kiwi.com/
- Kiwi Tequila (guia/cobertura) — https://phptravels.com/blog/comprehensive-guide-to-flights-api-integration
- Aviasales/Travelpayouts Data API (cache) — https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API
- Duffel (cobre Azul) — https://duffel.com/flights/airlines/azul
- Duffel (pricing/test mode) — https://www.saasworthy.com/product/duffel/pricing
- APG (NDC da Azul) — https://apg-ga.com/azul-full-content-now-available-on-apg-platform/
