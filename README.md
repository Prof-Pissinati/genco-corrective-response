# concurso-genco

Project for the **[GENCO Challenge](https://huggingface.co/spaces/gridfm/genco-challenge)** (GridFM Porto 2026).

- Open challenge, US$ 1,000 prize. **Submission deadline: Oct 25, 2026** (end of day, AoE), as a post in the *Community* tab of the Space.
- The **GENCO** model and the **OpenGridFM** tools (`gridfm-datakit`, `gridfm-graphkit`) are mandatory.
- Criteria: originality and impact, technical quality, exploration/extension of GENCO, narrative and reproducibility.

## Idea

Decision-support tool for **contingencies on transmission grids** (IEEE 14, 30, 57 and 118): the operator marks faulted lines and/or buses and the system proposes the generation **redispatch** and, if needed, the **minimum load shedding**, always confirmed by a classical AC power flow. **GENCO** enters as a fast evaluator for screening the contingencies and as a verifier of the plans (it improves on the DC; still weak near the limit, hence the AC confirmation), and, in OPF mode, it chooses the generators' reference voltage to fix voltage violations (IEEE 118). Architecture: `docs/ARQUITETURA.md`.

## Interface and backend: corrective response to contingencies

The operator marks **faulted lines and/or buses**; the system shows the pre-fault, post-fault and **with-plan** states (generation redispatch and, if overloads remain, the **minimum load shedding**, verified by the AC power flow). On IEEE 118, plans that end with voltage out of range go through the **generator voltage adjustment by GENCO-OPF** (`docs/TENSAO_GENCO_OPF.md`). There is also the **N-1 screening** (risk map of every line and bus, with the GENCO estimate) and the **repair timeline with block-by-block load reconnection**. Details: `docs/CONTRATO_API.md`, `docs/GENCO_VARREDURA.md`.

- **Static demo (nothing to install):** it only *replays* results precomputed by the backend, because GitHub Pages cannot run a server. This is a hosting limit, not a limit of the tool: with the backend running (below), any fault, on any of the four networks, is computed live. `interface/` builds, with `npm run build:replay`, a single HTML file (`interface/standalone/genco-replay.html`) with **precomputed results** for the IEEE 14, 30, 57 and 118 networks (on the 118: 42 corrective responses, 17 reconnections, full screening). The *Replay (static demo)* workflow builds it on every push to `main` (artifact) and can publish it to GitHub Pages. To regenerate the data: `python backend/tools/export_replay.py --case <network>` (add `--voltage-genco models/case118_genco_opf_small_autores` on the 118, in the GENCO environment).
- **Diagram views:** a selector chooses **AC** (default), **DC** or **GENCO** (the loading GENCO estimates, precomputed for the intact network and single-line outages; `docs/ARQUITETURA.md`). To regenerate the GENCO data: `python backend/tools/export_genco_lines.py --case <network> --modelo models/case<N>_genco_tiny_autores` (GENCO environment).
- **Full interface (any fault):** on Windows, `start-local.bat` (starts backend and interface); on other systems, `pip install -r backend/requirements.txt && uvicorn app.main:app --port 8000` in the `backend/` folder and `npm ci && npm run dev` in the `interface/` folder.
- **Tests:** `pytest` in `backend/` (install `requirements-dev.txt`) and `npm test` in `interface/`.

## Structure

| Folder | Content |
|---|---|
| `configs/` | YAML for data generation (datakit) and training (graphkit) |
| `tools/` | Windows fixes (see below) and GENCO inference helpers |
| `docs/referencias/` | Reference papers (GENCO and gridfm-datakit, arXiv) |
| `models/case118_genco_tiny_n10/` | **Weights of the final GENCO Tiny training** (IEEE 118, up to N-10) + normalizer, configuration, results and how to use |
| `models/case118_genco_tiny/` | Weights of the reduced GENCO Tiny training (IEEE 118, up to N-2), kept for comparison |
| `models/*_autores/` | Checkpoints published by the GENCO authors (not ours; see each folder's README and `NOTICE.md`) |
| `interface/` | Web interface (React/Vite): diagram, corrective response, N-1 screening, repair and reconnection |
| `backend/` | FastAPI service: AC/DC, corrective response, voltage adjustment, N-1 screening, repair and reconnection |
| `docs/CONTRATO_API.md` | Data and API contract between interface and backend |
| `docs/TREINO_GENCO.md` | Final GENCO training script on IEEE 118 (for whoever trains) |
| `docs/FIGURES.md`, `docs/NUMBERS.md`, `docs/figures/` | Where each figure and each number of the contest post comes from (data, script, protocol, limits) and the figures themselves |
| `docs/GENCO_VARREDURA.md` | GENCO validation on the IEEE 118 line outages (results and how to reproduce) |
| `docs/GENCO_ESCALA.md` | Scale study: GENCO error and time on networks from 14 to 10,000 buses (IEEE and GOC), with the limits of the test |
| `docs/TENSAO_PASSO0.md` and `docs/TENSAO_GENCO_OPF.md` | Voltage correction: what an AC-OPF would do (Step 0) and GENCO-OPF choosing the generator voltage (IEEE 118) |
| `docs/REDES_ADICIONAIS.md` | The IEEE 14, 30 and 57 networks (besides 118): preparation, GENCO results and how to reproduce |
| `docs/GENCO_CHECKPOINT_AUTORES.md` | The checkpoint published by the GENCO authors against our training (screening, several lines out and plan verifier) |
| `docs/GENCO_VERIFICACAO.md` | GENCO as a verifier of the corrective plans (states with redispatch and shedding that it did not see in training) |
| `docs/RELATORIO_TREINO_N10.md` | Report of our final training (IEEE 118, up to N-10) |
| `docs/ARQUITETURA.md` | Architecture and design decisions |

Data, virtual environment and `mlruns/` are **not** versioned (see `.gitignore`). Some folders and files keep Portuguese names (`*_autores` = authors', `docs/escala` = scale, `verificacao_planos_*` = plan verification) because other files refer to them.

## Environment (Windows, CPU)

Requires Python **3.10–3.12** (3.14 is not supported). Example with `uv`:

```bash
uv venv .venv --python 3.12
# CPU PyTorch compatible with the GENCO branch (torch < 2.9)
uv pip install --python .venv/Scripts/python.exe "torch>=2.7.1,<2.9" torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/Scripts/python.exe gridfm-datakit
```

**GENCO is not in the PyPI package.** It is in the `genco-paper-repro` branch on GitHub:

```bash
git clone --depth 1 --branch genco-paper-repro https://github.com/gridfm/gridfm-graphkit.git
uv pip install --python .venv/Scripts/python.exe -e gridfm-graphkit
```

Three adjustments needed on Windows:

1. **`torch_scatter`** has no package for Windows. Copy `tools/torch_scatter_shim/torch_scatter/` into the environment's `site-packages` (a pure-PyTorch substitute; only `scatter_add`, `scatter_mean` and `scatter_max` are used).
2. **Path bug in datakit 1.1.0** (backslashes in Julia code): run `python tools/patch_datakit_windows.py`.
3. **Recent MLflow** refuses the file backend: `export MLFLOW_ALLOW_FILE_STORE=true`.

Tips: the executables are `gridfm_datakit` and `gridfm_graphkit` (with an *underscore*); on the first data generation Julia (~280 MB) and PowerModels are downloaded automatically; run from Bash, since PowerShell treats Julia's progress output as an error.

### Optional: train on an NVIDIA GPU (Windows)

Create a second environment with `torch==2.8.0` from the index `https://download.pytorch.org/whl/cu128` (RTX 50xx GPUs require CUDA 12.8+), install graphkit and the shim in it and apply `python tools/patch_graphkit_windows_gpu.py <gridfm-graphkit folder>` (the default DDP/NCCL does not exist on Windows). Use `configs/bench_train14_gpu.yaml` (same as `_cpu`, only `accelerator` changes). Details and measurements in the repository history.

## Contingency panel (prototype)

Static page in `app/` (no build). It already includes `app/data.json` with 320 IEEE 118 test scenarios (real AC and DC and predictions of the GENCO Tiny trained on 3,200 samples). To view it:

```bash
python -m http.server 8765 --directory app
# open http://127.0.0.1:8765/index.html
```

To regenerate `data.json` (needs `networkx` and `pandas`) and include GENCO predictions: in the GENCO environment, run `gridfm_graphkit evaluate --config configs/train118_gpu.yaml --model_path <run>/artifacts/model/best_model_state_dict.pt --normalizer_stats <run>/artifacts/stats/normalizer_stats.pt --data_path data/case118 --num_workers 0 --save_output` and then `python app/export_data.py data/case118/case118_ieee/raw app/data.json <.../test/case118_ieee_predictions.parquet>`.

## Quick use (smoke test, IEEE 14)

```bash
export MLFLOW_ALLOW_FILE_STORE=true PYTHONIOENCODING=utf-8
gridfm_datakit generate configs/smoke_case14.yaml                      # generates ./data/smoke14
gridfm_graphkit train --config configs/smoke_train14.yaml \
  --data_path data/smoke14 --num_workers 0 --exp_name smoke --run_name t14
```

## Status (10/22/2026)

- ✅ Interface and backend working on four networks (IEEE 14, 30, 57 and 118): corrective response, N-1 screening (303 contingencies on the 118), repair and block reconnection, static demo (replay).
- ✅ **GENCO Tiny N-10** (39,761 samples, up to N-10; weights in `models/case118_genco_tiny_n10/`) validated on 177 line outages: mean loading error 0.93 % points (DC 2.95; reduced training 2.08) and 98.8% of the lines ≥ 90% detected; at 100% it detects 52% (DC 13%), so the final plan is confirmed by the AC (`docs/GENCO_VARREDURA.md`, `docs/RELATORIO_TREINO_N10.md`). The checkpoint published by the authors does better (0.11 % points; `docs/GENCO_CHECKPOINT_AUTORES.md`) and is the main model shown in the interface.
- ✅ **GENCO as a plan verifier** (`docs/GENCO_VERIFICACAO.md`): on 623 states with redispatch and load shedding that it never saw, mean error per line of 1.03 % points (DC 2.92); it approved 0 of 173 insufficient plans by mistake (DC 121); with a 5-point margin in the plan, it approves 75 of 89 plans.
- ✅ **GENCO-OPF fixing the voltage (IEEE 118)** (`docs/TENSAO_GENCO_OPF.md`): on the replay, 13 plans ended with voltage out of range; with the generator voltage adjusted by GENCO-OPF, the power plan redone and the AC confirming, the 15 violations become 0, with no overload and less shedding (901.8 → 866.2 MW).
- ✅ **Scale study** (`docs/GENCO_ESCALA.md`): up to 10,000 buses; on CPU GENCO is not faster than our AC, and on the GOC networks it does not beat the DC. GPU not tested.
- ⏳ GENCO integration into the live backend (today it appears as offline validation, a column in the screening, the verifier and the precomputed voltage adjustment).

## How to collaborate

- Work on **branches** (`feature/...`) and open *pull requests*; avoid direct commits to `main`.
- Do not push data, large checkpoints or the virtual environment.
- Before starting, run `git pull`.

## License and citation

Code under the **Apache License 2.0** (file `LICENSE`). Texts and figures: CC BY 4.0. Third-party materials (PGLib data, papers, GENCO/OpenGridFM) keep their licenses: see `NOTICE.md`. To cite this work, use `CITATION.cff`.
