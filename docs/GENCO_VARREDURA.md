# Validação do GENCO na varredura N-1 (IEEE 118)

Resultado e receita para reproduzir. Dados e números ficam em `interface/src/data/screening_case118_ieee.json` (usado pelo painel "Varredura N-1").

## O que foi medido
Para cada **saída de linha** do IEEE 118 (177 das 186; 9 isolam barras e o datakit evita ilhas) montamos o estado que o GENCO viu no treino:
despacho base do AC-OPF, uma linha fora e a **barra de referência absorvendo o desbalanço** (sem redespacho). Rodamos o **GENCO Tiny reduzido**
(`models/case118_genco_tiny/`: 3.200 amostras, até N-2) e comparamos o carregamento previsto (calculado de Vm/Va previstos) com o **AC do backend** e com o **DC**.

| Métrica (177 cenários, estado pós-falta sem redespacho) | GENCO | DC |
|---|---|---|
| Erro médio de carregamento | **2,08 pontos %** | 2,95 pontos % |
| Linhas ≥ 90% detectadas (por linha) | **95%** (precisão 97,5%) | 78% |
| Linhas ≥ 100% detectadas (por linha) | 25% | 13% |
| Cenários que exigem ação (≥ 100%) detectados, sem margem | 58% | 27% |
| Idem, com margem de 5 pontos | 100%, mas 177/177 vão ao AC | igual ou pior |
| Tempo por cenário (CPU deste computador) | 49,5 ms | 0,9 ms (AC: 15,4 ms) |

## Leitura honesta
- O GENCO é **melhor que o DC** em erro e em detecção de linhas carregadas (≥ 90%).
- **Perto do limite (100%) ainda é fraco**: o caso base já tem linhas exatamente no limite (restrição ativa do OPF), e o modelo reduzido erra alguns pontos %. Por isso o plano final é sempre **confirmado pelo AC**.
- **Velocidade:** em CPU o GENCO é mais lento que o AC próprio do backend; o colaborador mediu 2,3 ms/cenário em GPU. A rede de 118 barras é pequena demais para o ganho aparecer.
- Maior erro isolado (256,6%) é um *outlier* de uma linha; a média é dominada pelos casos normais.
- **Treino maior** (40.000 amostras, até N-10; `docs/TREINO_GENCO.md`) deve melhorar a precisão perto do limite. Não é feito neste computador.

## Como reproduzir
No ambiente do GENCO (`gridfm-graphkit` + `torch`), a partir da raiz do repositório:
```bash
# 1) monta os dados no formato do datakit (caso base + cada linha fora) em <pasta>
python backend/tools/genco_screening.py build --out <pasta>
# 2) roda o GENCO sobre <pasta> (tools/measure_genco_inference.py, com os pesos de models/case118_genco_tiny/ e o normalizer_stats.pt;
#    configuração com data.split_from_existing_files=<pasta>/splits e split_by_load_scenario_idx=false; anote os ms/cenário)
# 3) compara com o AC e o DC e grava o JSON usado pela interface
python backend/tools/genco_screening.py analyze --out <pasta> --pred <predictions.parquet> --genco-ms <ms por cenário>
```
O resultado é gravado em `interface/src/data/screening_case118_ieee.json`.

## Onde aparece na interface
Painel **Varredura N-1** (botão 📊 no painel "Resposta corretiva"): lista as 303 contingências simples ordenadas por severidade (AC, após o redespacho automático) e, para linhas, o carregamento máximo estimado pelo GENCO (sem redespacho); mostra o quadro acima. Clicar numa linha aplica a falha e abre a resposta corretiva.
