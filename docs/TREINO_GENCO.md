# Roteiro do treino final do GENCO (IEEE 118)

> Para quem vai fazer o treino mais pesado. Escrito em 2026-10-08, a partir do que já foi medido neste repositório.
> Leia antes o `docs/ARQUITETURA.md`.

## 1. Por que este treino
A interface de restauração vai avaliar **muitas topologias** (a rede com várias linhas/barras fora e manobras de religamento) e precisa de um avaliador rápido e preciso perto dos limites de carregamento. O modelo atual foi um treino reduzido, bom para validar o fluxo de trabalho, mas pouco treinado para isso.

## 2. Ponto de partida (já medido, IEEE 118, GENCO Tiny)
Os pesos desse treino reduzido já estão publicados em `models/case118_genco_tiny/` (veja o README da pasta). **A integração do GENCO na interface pode começar com eles** e trocar pelos pesos finais depois, sem mudar o contrato.

| Item | Valor atual |
|---|---|
| Dados | 3.200 amostras (800 cenários de carga × 4 variantes), contingências até **N-2** (`configs/data_case118.yaml`) |
| Treino | 100 épocas, lote 32, GPU RTX 5060: **34 min** (~22 s/época; CPU ~54 s/época) |
| Perda de validação | 0,030 → **0,0038** |
| Erro médio de carregamento de linha (320 cenários de teste) | **GENCO 1,94 pontos %** × DC 2,88 |
| Detecção de sobrecarga (limiar 90%) | **GENCO 86%** × DC 67% (a 100%: 54% × 46%) |
| Inferência | GPU 2,34 ms/cenário, CPU 7,43; AC exato 5,0; DC 1,07 |

**Limitação para a restauração:** o modelo só viu até N-2. Os estados de restauração têm muitas linhas fora, e perto do limite térmico ele ainda perde sobrecargas.

## 3. O que treinar (proposta; o responsável pode ajustar e deve registrar o que mudar)
- **Modelo:** GENCO **Tiny** (como no paper). Se sobrar tempo, comparar com **Small** (H=24, ~5M parâmetros); registrar custo e ganho.
- **Dados:** `configs/data_case118_grande.yaml` → **40.000 amostras** (10.000 cenários × 4 variantes), contingências até **N-10**, com N-0 a 10% (o estado reparado) e N-1/N-2 a 13% cada, `seed: 42`.
- **Treino:** `configs/train118_grande.yaml` → até **60 épocas**, lote 64, parada antecipada com paciência 15, GPU.
- **Por que N-10:** o paper treina até N-2 e testa até N-20 (o GENCO generaliza, mas com resíduo maior). Treinar com mais linhas fora cobre melhor os estados de restauração.
- **Fora do escopo deste treino:** ilhas energizadas separadamente, OPF e outras redes (ver §7).

### Orçamento de tempo (estimativa, a partir de 22 s/época com 2.560 amostras ≈ 8,6 ms/amostra/época na RTX 5060)
| Amostras | Épocas | Tempo de treino estimado |
|---|---|---|
| 20.000 | 50 | ~2,4 h |
| **40.000** | **60** | **~5,7 h** (recomendado) |
| 100.000 | 50 | ~12 h |

A geração dos dados levou ~164 s para 3.200 amostras com 16 processos (≈ 50 ms/amostra); 40.000 amostras devem levar ~35 min a 1 h (estimativa; N-k alto pode demorar mais). **Medir a primeira época e reavaliar o plano.**

## 4. Passo a passo
Ambiente: o mesmo da máquina com GPU (PyTorch 2.8 + CUDA 12.8; graphkit do branch `genco-paper-repro`; `tools/patch_graphkit_windows_gpu.py` aplicado; shim do `torch_scatter`). Variáveis: `MLFLOW_ALLOW_FILE_STORE=true`, `PYTHONIOENCODING=utf-8`. Rodar pelo Bash.
```bash
# 1) dados (criam data/case118_grande/case118_ieee/raw)
gridfm_datakit generate configs/data_case118_grande.yaml

# 2) treino
gridfm_graphkit train --config configs/train118_grande.yaml --data_path data/case118_grande \
  --num_workers 0 --exp_name final118 --run_name tiny_n10

# 3) avaliação com previsões salvas e métricas AC/DC de referência
gridfm_graphkit evaluate --config configs/train118_grande.yaml --data_path data/case118_grande --num_workers 0 \
  --model_path <run>/artifacts/model/best_model_state_dict.pt \
  --normalizer_stats <run>/artifacts/stats/normalizer_stats.pt \
  --compute_dc_ac_metrics --save_output --exp_name final118 --run_name tiny_n10_eval
```
Se a perda de validação ainda estiver caindo ao fim das épocas, continuar com `finetune` (mesmos argumentos + `--model_path`).

## 5. Como avaliar (relatório obrigatório)
Reaproveitar a fórmula validada de fluxo por linha (`app/export_data.py`) e comparar **GENCO × DC × AC exato**, no conjunto de teste (split por cenário de carga), **separando por número de saídas** (N-0, N-1, N-2, N-3…N-5, N-6…N-10):
1. Erro médio e máximo do carregamento de linha (pontos %).
2. Detecção de sobrecarga nos limiares 80%, 90% e 100%: acertos, perdas e falsos alarmes.
3. Erro de tensão (Vm, Va) e resíduo de balanço de potência.
4. Tempo de inferência (GPU e CPU, por cenário, com lotes de 32/160/320) e o AC exato como referência.

**Metas sugeridas (propostas, não resultados):** erro médio de carregamento ≤ 1,0 ponto % no geral e ≤ 2,0 em N-6…N-10; detecção a 90% ≥ 95%. Se não forem atingidas, relatar o que foi obtido; o plano final é sempre confirmado por AC.

## 6. O que entregar (e onde)
1. **Pesos** `best_model_state_dict.pt` e **`normalizer_stats.pt`** (sem as estatísticas o modelo não funciona fora do treino), seguindo a convenção já usada neste repositório: pasta **`models/case118_genco_tiny_n10/`** (nome sugerido; o `.gitignore` já libera `models/**/*.pt`) com `config.yaml`, o arquivo de splits, e um `README.md` com SHA-256, dados, métricas e instruções de uso, no modelo de `models/case118_genco_tiny/README.md`. Não sobrescrever a pasta do treino reduzido. Se algum arquivo passar de ~50 MB (ex.: modelo Small), usar **Release do GitHub** ou **Hugging Face** e deixar o link no README da pasta.
2. **Configurações exatas** usadas (os dois YAML + qualquer alteração) e a **semente**.
3. **Versões:** commit do `gridfm-graphkit` (branch `genco-paper-repro`), versão do `gridfm-datakit`, PyTorch/CUDA.
4. **Relatório de métricas** (§5), em `docs/` e com a tabela por número de saídas.
5. **Dataset:** se possível publicar no Hugging Face (reprodutibilidade, critério do desafio); caso contrário, descrever como regenerar (config + seed).
6. **Exemplo mínimo de inferência em memória** (um script que carregue pesos + normalização e preveja para uma lista de topologias **sem** ler do disco o dataset inteiro). É o que o backend precisa para chamar o GENCO a partir da busca de restauração. O `tools/measure_genco_inference.py` hoje usa o `evaluate` do graphkit.
7. Atualizar a seção 4 e o registro do o histórico do projeto.

**Prazos:** o backend começa a integrar o GENCO em **18/out** (Fase 5). **Entrega dos pesos até 18/out; limite absoluto 21/out** (depois disso a submissão usa o avaliador clássico e o GENCO fica como resultado parcial).

## 7. Pontos em aberto (decidir com o grupo)
- **Estados parciais/ilhados:** o datakit evita ilhas, então o GENCO nunca viu barras isoladas. A interface avalia só a ilha com a barra de referência; é preciso medir o erro nesses casos (conjunto de validação a gerar no backend com o pandapower) e, se ficar ruim, confirmar sempre no AC.
- **Rede maior (ex.: GOC-500):** a medição atual mostrou que, no IEEE 118, o GENCO é só ~2× mais rápido que o AC e ~2× mais lento que o DC, e a triagem híbrida mandou ~99% dos cenários ao AC (não ganha tempo). O argumento de velocidade pode exigir uma rede maior ou avaliação em lotes grandes; decidir se vale treinar também uma rede maior ou se o argumento da submissão será a precisão.
- **Redespacho de geração (OPF):** fora do escopo; o despacho é fixo.
- **Small × Tiny:** só se houver tempo.
