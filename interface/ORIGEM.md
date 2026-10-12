# Origem do código desta pasta

Base: simulador de sistemas de potência do autor (React + Vite), copiado em 2026-10-08 (commit de origem **e13d986**) e adaptado para
transmissão. Em 2026-10-12 foram removidos os módulos específicos de redes de distribuição (importadores, otimizadores, sequenciador,
solver de distribuição e os sistemas de exemplo): esta pasta mantém só o que a análise de transmissão usa (diagrama, importação de casos
MATPOWER, mapa, painéis de resposta corretiva, varredura e religação, e o solver DC local).
