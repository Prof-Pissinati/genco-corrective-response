# concurso-genco

Projeto para o **[GENCO Challenge](https://huggingface.co/spaces/gridfm/genco-challenge)** (GridFM Porto 2026).

- Desafio aberto, prêmio de US$ 1.000. **Prazo de submissão: 25/out/2026** (fim do dia, AoE), por post na aba *Community* do Space.
- Obrigatório usar o modelo **GENCO** e as ferramentas **OpenGridFM** (`gridfm-datakit`, `gridfm-graphkit`).
- Critérios: originalidade e impacto, qualidade técnica, exploração/extensão do GENCO, narrativa e reprodutibilidade.

## Ideia

Ferramenta de apoio à decisão para **contingências em redes de transmissão** (IEEE 118): o operador marca linhas e/ou barras com defeito e o sistema propõe o **redespacho** da geração e, se necessário, o **corte mínimo de carga**, sempre confirmado por um fluxo de potência AC clássico. O **GENCO** entra como avaliador rápido na triagem das contingências (melhora o DC; ainda fraco perto do limite, daí a confirmação pelo AC). Arquitetura: `docs/ARQUITETURA.md`.

## Interface e backend: resposta corretiva a contingências (IEEE 118)

O operador marca **linhas e/ou barras com defeito**; o sistema mostra o estado pré-falta, pós-falta e **com plano** (redespacho da geração e, se ainda houver sobrecarga, o **corte mínimo de carga**, verificado pelo fluxo AC). Há ainda a **varredura N-1** (mapa de risco de todas as linhas e barras, com a estimativa do GENCO) e a **linha do tempo de reparo com religação da carga por blocos**. Detalhes: o histórico do projeto, `docs/CONTRATO_API.md`, `docs/GENCO_VARREDURA.md`.

- **Demo estático (sem instalar nada):** `interface/` gera, com `npm run build:replay`, um único arquivo HTML (`interface/standalone/genco-replay.html`) com **resultados pré-calculados** do IEEE 118 (42 respostas corretivas, 17 religações, varredura completa). O workflow *Replay (demo estático)* o gera a cada push na `main` (artefato) e pode publicá-lo no GitHub Pages. Para regenerar os dados: `python backend/tools/export_replay.py`.
- **Interface completa (qualquer falha):** no Windows, `iniciar-local.bat` (liga backend e interface); em outros sistemas, `pip install -r backend/requirements.txt && uvicorn app.main:app --port 8000` na pasta `backend/` e `npm ci && npm run dev` na pasta `interface/`.
- **Testes:** `pytest` em `backend/` (instale `requirements-dev.txt`) e `npm test` em `interface/`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `configs/` | YAML de geração de dados (datakit) e de treino (graphkit) |
| `tools/` | Correções necessárias no Windows (veja abaixo) |
| `docs/referencias/` | Papers de referência (GENCO e gridfm-datakit, arXiv) |
| `models/case118_genco_tiny/` | Pesos do GENCO Tiny treinado no IEEE 118 (treino reduzido) + como usar |
| `interface/` | Interface web (React/Vite): diagrama, resposta corretiva, varredura N-1, reparo e religação |
| `backend/` | Serviço FastAPI: AC/DC, resposta corretiva, varredura N-1, reparo e religação |
| `docs/CONTRATO_API.md` | Contrato de dados e API entre interface e backend |
| `docs/TREINO_GENCO.md` | Roteiro do treino final do GENCO no IEEE 118 (para quem treina) |
| `docs/GENCO_VARREDURA.md` | Validação do GENCO nas saídas de linha do IEEE 118 (resultados e como reproduzir) |
| `docs/ARQUITETURA.md` | Arquitetura e decisões de projeto |

Dados, ambiente virtual e `mlruns/` **não** são versionados (ver `.gitignore`).

## Ambiente (Windows, CPU)

Requer Python **3.10–3.12** (o 3.14 não é suportado). Exemplo com `uv`:

```bash
uv venv .venv --python 3.12
# PyTorch CPU compatível com o branch do GENCO (torch < 2.9)
uv pip install --python .venv/Scripts/python.exe "torch>=2.7.1,<2.9" torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/Scripts/python.exe gridfm-datakit
```

**O GENCO não está no pacote do PyPI.** Ele está no branch `genco-paper-repro` do GitHub:

```bash
git clone --depth 1 --branch genco-paper-repro https://github.com/gridfm/gridfm-graphkit.git
uv pip install --python .venv/Scripts/python.exe -e gridfm-graphkit
```

Três ajustes necessários no Windows:

1. **`torch_scatter`** não tem pacote para Windows. Copie `tools/torch_scatter_shim/torch_scatter/` para o `site-packages` do ambiente (substituto em PyTorch puro; só `scatter_add`, `scatter_mean` e `scatter_max` são usados).
2. **Bug de caminhos no datakit 1.1.0** (barras invertidas em código Julia): rode `python tools/patch_datakit_windows.py`.
3. **MLflow recente** recusa o backend de arquivos: `export MLFLOW_ALLOW_FILE_STORE=true`.

Dicas: os executáveis são `gridfm_datakit` e `gridfm_graphkit` (com *underscore*); na primeira geração de dados o Julia (~280 MB) e o PowerModels são baixados automaticamente; rode pelo Bash, pois o PowerShell trata a saída de progresso do Julia como erro.

### Opcional: treinar na GPU NVIDIA (Windows)

Crie um segundo ambiente com `torch==2.8.0` do índice `https://download.pytorch.org/whl/cu128` (GPUs RTX 50xx exigem CUDA 12.8+), instale o graphkit e o shim nele e aplique `python tools/patch_graphkit_windows_gpu.py <pasta do gridfm-graphkit>` (o DDP/NCCL padrão não existe no Windows). Use `configs/bench_train14_gpu.yaml` (igual ao `_cpu`, só muda `accelerator`). Detalhes e medições no o histórico do projeto.

## Painel de contingências (protótipo)

Página estática em `app/` (sem build). Já inclui `app/data.json` com 320 cenários de teste do IEEE 118 (AC e DC reais e previsões do GENCO Tiny treinado em 3200 amostras). Para ver:

```bash
python -m http.server 8765 --directory app
# abra http://127.0.0.1:8765/index.html
```

Para regenerar o `data.json` (precisa de `networkx` e `pandas`) e incluir previsões do GENCO: no ambiente do GENCO, rode `gridfm_graphkit evaluate --config configs/train118_gpu.yaml --model_path <run>/artifacts/model/best_model_state_dict.pt --normalizer_stats <run>/artifacts/stats/normalizer_stats.pt --data_path data/case118 --num_workers 0 --save_output` e depois `python app/export_data.py data/case118/case118_ieee/raw app/data.json <.../test/case118_ieee_predictions.parquet>`.

## Uso rápido (teste de fumaça, IEEE 14)

```bash
export MLFLOW_ALLOW_FILE_STORE=true PYTHONIOENCODING=utf-8
gridfm_datakit generate configs/smoke_case14.yaml                      # gera ./data/smoke14
gridfm_graphkit train --config configs/smoke_train14.yaml \
  --data_path data/smoke14 --num_workers 0 --exp_name smoke --run_name t14
```

## Estado (12/10/2026)

- ✅ Interface e backend funcionando para o IEEE 118: resposta corretiva, varredura N-1 (303 contingências), reparo e religação por blocos, demo estático (replay).
- ✅ GENCO Tiny (treino reduzido) validado em 177 saídas de linha: melhora o DC, mas só detecta 25% das linhas acima de 100% (`docs/GENCO_VARREDURA.md`).
- ⏳ Treino maior do GENCO (`docs/TREINO_GENCO.md`) e integração do GENCO ao backend.

## Como colaborar

- Trabalhe em **branches** (`feature/...`) e abra *pull requests*; evite commits diretos na `main`.
- Não suba dados, checkpoints grandes nem o ambiente virtual.
- Antes de começar, rode `git pull`.

## Licença e citação

Código sob **Apache License 2.0** (arquivo `LICENSE`). Textos e figuras: CC BY 4.0. Materiais de terceiros (dados do PGLib, artigos, GENCO/OpenGridFM) mantêm suas licenças: veja `NOTICE.md`. Para citar este trabalho, use `CITATION.cff`.
