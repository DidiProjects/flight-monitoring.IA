API para acompanhar valor de passagens aérias;

Vamos utilizar python, quero criar um script para cada cada impresa aéria, por enquanto vamos considerar apenas azul;
Quero que esse script consuma apis da azul para encontrar passagens aérias pra mim.

Entradas:
  target: Valor inteiro;
  currency: pode reser especificação da moeda ou pontos (para milhas), campo obrigatório e por default será Real;
  margem: será a percentagem de tolerância, em que eu devo ser avisado sobre a passagem: default 0,1;
  ida: {
    dataInicio: YYYY-MM-DD: campo obrigatório, define o início do período de interece para acompanhar as passagens,
    dataFim: YYYY-MM-DD campo não obrigatório, define o fim do período de interece para acompanhar as passagens,
  }
  volta: {
    dataInicio: YYYY-MM-DD: campo obrigatório, define o início do período de interece para acompanhar as passagens,
    dataFim: YYYY-MM-DD campo não obrigatório, define o fim do período de interece para acompanhar as passagens,
  }
  o campo de volta será não obrigatório, dando a possibilidade de pesquisar apenas uma viagem;

Saídas, quero a relação de valores das passagens de acordo com a currency especificada e com o período especificado;

Quero que minhas consultas tenham retry para casos de erro.
Inicialmente quero ver meus resultados no terminal.
Quero seguir as melhores práticas do mercado, utilizar tecnologias de ponta gratuítas.
Quero todo o desenvolvimento em inglês.


Novas instruções:

procurar por um spam com texto: "Datas (Ida e volta)";
clicar nele;
procurar input com aria-label: "Data de ida"
digitar a data no formato Brasileiro, apenas númveros (exmplo pro dia 11/15/1993 seria 11151993 digitado!)
procurar input com aria-label: "Data de volta (opcional)" se necessário
digitar a data no formato Brasileiro, apenas númveros (exmplo pro dia 11/15/1993 seria 11151993 digitado!)
clique no botão que contém o texto: "Selecionar datas de ida e volta"

clique no botão que contém o texto: "Buscar passagens"

após vamos te rum estado de loading, que vai se encerrar quando encontrarmos um:
<p class="results">10 voos encontrados</p>
com os resultados, lembrando que o valor numérico pode mudar.

Nesse momento vamos visualizar as passagen mas primeiramente, vamos ter um 

<div class="booking-calendar__cards css-77i9f"><div height="96" class="styles__CarouselWrapper-sc-3qprdy-0 fcjoTQ"><div height="96" class="styles__Carousel-sc-3qprdy-1 ktAbfz"><div><button type="button" aria-hidden="true" aria-label="sex  01/05 valor da menor tarifa do dia , selecionar" class="css-17h89v5"><span aria-hidden="true">sex  01/05</span><span aria-hidden="true" class="item-value"></span></button></div><div><button type="button" aria-hidden="true" aria-label="sáb  02/05 valor da menor tarifa do dia , selecionar" class="css-17h89v5"><span aria-hidden="true">sáb  02/05</span><span aria-hidden="true" class="item-value"></span></button></div><div><button type="button" aria-hidden="true" aria-label="dom  03/05 valor da menor tarifa do dia , selecionar" class="css-17h89v5"><span aria-hidden="true">dom  03/05</span><span aria-hidden="true" class="item-value"></span></button></div><div><button type="button" aria-hidden="true" aria-label="seg  04/05 valor da menor tarifa do dia , selecionar" class="css-bxfdb3"><span aria-hidden="true">seg  04/05</span><span aria-hidden="true" class="item-value"></span></button></div><div><button type="button" aria-hidden="true" aria-label="ter  05/05 valor da menor tarifa do dia , selecionar" class="css-17h89v5"><span aria-hidden="true">ter  05/05</span><span aria-hidden="true" class="item-value"></span></button></div><div><button type="button" aria-hidden="true" aria-label="qua  06/05 valor da menor tarifa do dia , selecionar" class="css-17h89v5"><span aria-hidden="true">qua  06/05</span><span aria-hidden="true" class="item-value"></span></button></div><div><button type="button" aria-hidden="true" aria-label="qui  07/05 valor da menor tarifa do dia , selecionar" class="css-17h89v5"><span aria-hidden="true">qui  07/05</span><span aria-hidden="true" class="item-value"></span></button></div></div></div></div>

onde cada button será para mudarmos a data de consulta, será últil para consultarmos diferentes dias no período de pesquisa definido

mais a baixo temos: 

<button type="button" aria-label="Pontos" value="score" class="css-6fpksg">Pontos</button>
<button type="button" aria-label="Reais" value="currency" class="css-6fpksg">Reais</button>

para alterar na view entre Pontos e Real, sendo possível obter ambas as informações.

Eu quero que você obtenha os valores pertinentes de cada passagem, como valor em R$, em pontos pontos (apenas em pontos e o híbrido pontos e reais)
Eu quero a duração
hora de embarque e desembarque
número de escalas.

Armazene todas as informações das passágens visíveis em arquivos js e armazene nos nossos resultados. depois vamos tomar a decisão do que fazer com eles.

continue versionando meus resultados, quero que leia os snapshots em hmtl para chegarmos em nossos resultados;

mudanças de todas:

  vamos realizar pesquisa de preço para ida e volta separadamente, primeira a de ída como passagem sem volta, depois a de volta como passagem sem volta. dessa forma não vamos utilizar o campo Data de volta (opcional) por enquanto,

  target: Valor inteiro;
  currency: pode reser especificação da moeda ou pontos (para milhas), campo obrigatório e por default será Real;

  vamos manter esses parâmetros mas não mais precisaremos especificar pontos, apenas moeda, isso pois para todas as pesquisas vamos devolver valor em real (no caso da azul) em pontos e híbrido pontos e real.

  Como pela azul temos opções de navegar entre diferentes datas, vamos explorar após a pesquisa inicial (selecionando no datapicker o começo do período de interesse para a ída e o fim do período de interesse para a volta) as demais datas de interesse, uma por uma e armazenando os resultados, através do booking-calendar.

  após coletar todos os dados da passagem de ída, devemos prosseguir para data de volta, para tanto vamos refazer a pesquisa, considerando a passágem de volta como ida.

