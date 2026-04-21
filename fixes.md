percebi que não estamos conseguindo obter nenhum valor exclusivamente em pontos, porém eles existem.

Quando pesquisamos as passagens, seja pelo link (https://www.voeazul.com.br/br/pt/home/selecao-voo?c[0].ds=LIS&c[0].std=05/26/2026&c[0].as=CNF&p[0].t=ADT&p[0].c=1&p[0].cp=false&f.dl=3&f.dr=3&cc=PTS) ou navegando na tala, podemos visualizar os ponto selecionando pesquisando class === fare-container e depois data-test-id === "fare-price-with-points", o valor entrontado será algo próximo de:

<h4 class="current css-2db79l" aria-hidden="true" data-test-id="fare-price fare-price-with-points">399.960<span class="points">pontos</span></h4>

quero que ajuste nosso fluxo para conseguir trazer o valor exclusivamente em pontos também.
Quero que diminua o tempo que gastamos esperando a página carregar inicialmente, estamos demorando muito.
Quero que diminua os intervalos de datas no nosso env, estamos testando muitas datas.