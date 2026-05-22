Atualmente nosso json de configuração de logs está no grafana-flight-monitoring.json

Eu gostaria de melhorar os logs que mandamos para o grafana, gostaria de melhorias no envio dos logs e na experiência no grafana.

APIS que enviam logs: flight.API, scriping.API

Experiência desejada:

gostaria de uma view ou card por API;
Gostaria de uma tela mostrando logs;
Gostaria de poder filtrar meus logs, como filtros compostos:
1. empresa aéria;
2. erros/warnings/info
3. Falhas por bloqueio de ip
5. Falhas por time out

poderia filtrar todos os erros da azul por exemplo.

Gostaria de uma análise gráfica que pudesse me mostrar:

Para a flight.API:
1. Quantidade de erros e warnings
Tudo isso por empresa aéria.

scriping.API
1. Quantidade de erros e warnings
2. Quantidade de falhas na análise devido a bloqeuio de ip;
3. Quantidade de falhas na análise devido a time out;
Tudo isso por empresa aéria.

Vamos enxugar nossos logs de info, logando informações extratégicas sobre as análises, principalmente id's e parâmetros de pesquisa.