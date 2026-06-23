1. Aplicar um height max com scroll nas tabelas de Histórico de análises;
2. Não quero mais registro de currency por airlines, vamos remover do banco e de todos os locais que utilizam essa informação:
  2.1 Para os locais onde necessitamos do currency, vamos ter fontes para obter esse parâmetro:
    2.1.1 A primeira será pela rotina, caso a rotina já tenha rodado um job e ibtido um currency, esse deve ser a fonte de verdade primária;
    2.1.2 Caso o jobe ainda não tenha rodado, vamos considerar a origem do trajeto, analizando o airports das airlines podemos identificar a currency por airport.
  2.2 Na criação de rotina não vamos aplicar a mesma análise! verificar se algum job já rodou para aquele trajeto e alguma das empresas aérias, obtendo com sucesso exibimos o currncy, caso negativo vamos obter pelo trajeto.
  2.3 Casso o currency não esteja disponível ainda, exibimos nada em seu lugar.
  2.4 Atenha-se que temos uma regra que não permite criar rotinas com empresas aérias com current diferenets, essa regra não faz mais sentido;
3. Não quero mais permitir pela experiência e api a criação de rotinas com airlines em que um ponto do trajeto não esteja disponível em airports, na interface, para esses casos, a opção do select já fica com aparência disabled e vamos efetivar isso agora.
  3.2 Deselecionar deve ser possível.
4. Para Rotinas com pontos e dinheiro, deveria ser possível ver dois gráficos em histórico de preços (lado a lado) e duas listas no calendário de preços (uma abaixo da outra).
  4.1 Para rotinas apenas com pontos deveríamos ver só o de pontos.
5. Eu quero uma análise clara e simples de quando enviamos notificação por email de Preço alvo quando selecionado.