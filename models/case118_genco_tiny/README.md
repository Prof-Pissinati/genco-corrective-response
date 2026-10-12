# GENCO Tiny treinado no IEEE 118 (treino reduzido)

Pesos do modelo **GENCO Tiny** (`GNS_heterogeneous`, `hidden_size: 12`, 12 camadas, ~1,3 M de parâmetros) para a rede **`case118_ieee`**, tarefa **PowerFlow**. Treinado pelo colaborador `leonardp315` com o `gridfm-graphkit` (branch `genco-paper-repro`).

| Arquivo | Para quê |
|---|---|
| `best_model_state_dict.pt` | pesos do melhor ponto de validação (5,3 MB) |
| `normalizer_stats.pt` | estatísticas do normalizador, **necessárias** na inferência |
| `config.yaml` | configuração usada no treino (`configs/train118_gpu_100ep.yaml`) |
| `case118_ieee_scenario_splits.json` | cenários de treino/validação/teste (por índice de cenário) |

SHA-256:
```
2ede897013c63f517be27bf5052250080e7042375b10a57bae2b18174eac0b0d  best_model_state_dict.pt
9e0885eb0ff3bb7593937b5745b4933f29aba0d5a6a0a7feb8c2e8f2d17d9adc  normalizer_stats.pt
```

## Como foi treinado
- Dados: `configs/data_case118.yaml` (gridfm-datakit, modo PF, contingências até N-2, **3200 amostras**: 800 cenários de carga × 4 variantes de topologia, `seed: 0`). Split 2560/320/320.
- Treino: 100 épocas, lote 32, GPU (RTX 5060), 34 min. Perda de validação 0,030 → 0,0038.
- Teste (320 cenários nunca vistos): RMSE Vm ≈ 0,0013 p.u. (barras PQ), 0,014 p.u. (referência); RMSE Va ≈ 0,056 rad; resíduo de potência ativa médio ≈ 1,9 MW.
- Comparação com DC e tempos: (erro médio de carregamento de linha: GENCO 1,9 × DC 2,9 pontos %; 2,3 ms/cenário na GPU).

## Como usar
Ambiente: Python 3.12, `torch<2.9`, `gridfm-graphkit` do branch `genco-paper-repro`, shim de `torch_scatter` (`tools/torch_scatter_shim/`). Em GPU no Windows, aplicar também `tools/patch_graphkit_windows_gpu.py`. Detalhes no `README.md` da raiz.

Os dados precisam existir no formato do datakit (`data/case118/case118_ieee/raw`, gerados com `configs/data_case118.yaml`). Previsões (Vm, Va, Pg, Qg por barra) para os cenários de teste:

```bash
export MLFLOW_ALLOW_FILE_STORE=true MLFLOW_DISABLE_AGENT_HINT=1 PYTHONIOENCODING=utf-8
gridfm_graphkit predict --config models/case118_genco_tiny/config.yaml \
  --model_path models/case118_genco_tiny/best_model_state_dict.pt \
  --normalizer_stats models/case118_genco_tiny/normalizer_stats.pt \
  --data_path data/case118 --num_workers 0 --output_path saida_predict
# gera saida_predict/case118_ieee_predictions.parquet (colunas Vm_pred, Va_pred em rad, ...)
```

O **fluxo por linha** não vem direto do modelo: calcula-se a partir de `Vm_pred`/`Va_pred` e das admitâncias (`Yff`, `Yft`) do `branch_data` (função `genco_flows` em `app/export_data.py`; com as tensões reais reproduz o AC com erro < 0,01 MW). Para medir tempo de inferência: `tools/measure_genco_inference.py`.

## Limitações
- **Treino reduzido** (o artigo usa 250 mil amostras e 200 épocas): melhora o DC, mas ainda perde sobrecargas perto do limite; usar com confirmação por AC.
- Vale **só para o IEEE 118** (o GENCO é treinado por rede) e para a distribuição de cargas/topologias do dataset (N-0/N-1/N-2, cargas escaladas).
- O datakit evita ilhas; topologias com ilhas desenergizadas estão **fora do treino**.
