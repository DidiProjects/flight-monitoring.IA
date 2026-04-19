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