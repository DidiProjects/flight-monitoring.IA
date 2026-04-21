Vamos implementar o restante da funconalidade? ela vai requerier um pequeno ajuste:

primeiro é que meu FLIGHT_TARGET pode ser em dinheiro, pontos e híbrido.
dessa forma serão três parâmetros não obrigatórios.

Esses parâmetros servem para a tomada de decisão de se vamos enviar o email ou não.
 a regra do email será:

 De acordo com cada parâmetro (dinheiro, pontos ou híbrido) caso um deles seja definido e o valor da passágem esteja na margem ou inferior a ela, eu devo enviar o email.

 Eu devo enviar apenas um email por dia, vamos salvar essa informação com um datetime, em um json em result que não será apagado.

 vamos também armazenar um json com o melhor preço do dia, isso pois na 20 execução do dia, caso o email não seja enviado nenhuma vez vamos enviar o melhor preço encontrado até então de acordo com a referência informada (pontos, dinheiro, híbrido). Caso seja informado mais de uma referência, seguir essa lista ordem de preferência. 

 Quero um email bem suscinto e bunito, nada de emoticons. Quero que no email vocÊ coloque um link direcionando pra passagem, modelo da azul:

 rota em Real Brasileito https://www.voeazul.com.br/br/pt/home/selecao-voo?c[0].ds=LIS&c[0].std=05/26/2026&c[0].as=CNF&p[0].t=ADT&p[0].c=1&p[0].cp=false&f.dl=3&f.dr=3&cc=BRL
rota em Pontos: https://www.voeazul.com.br/br/pt/home/selecao-voo?c[0].ds=LIS&c[0].std=05/26/2026&c[0].as=CNF&p[0].t=ADT&p[0].c=1&p[0].cp=false&f.dl=3&f.dr=3&cc=PTS

caso a referência seja em dinheiro mandamos com BRL, caso em pontos mandamos o PTS.

para gerarmos um teste, coloque referência apenas em pontos com o valor 300000