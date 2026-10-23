# GENCO Tiny for IEEE 118 published by the GENCO authors

**Not our training.** These are the weights that the GENCO authors (IBM Research and collaborators; OpenGridFM / Linux Foundation for Energy) published on Hugging Face,
under **Apache 2.0**, copied without change:

- Origin: https://huggingface.co/gridfm/genco-pf-datakit, folder `case118_ieee/tiny/seed0/` (downloaded on 2026-10-21).
- Paper: *GENCO*, arXiv 2608.09921 (https://arxiv.org/abs/2608.09921). Code: https://github.com/gridfm/gridfm-graphkit (branch `genco-paper-repro`).
- Model: GENCO Tiny (`GNS_heterogeneous`, `hidden_size: 12`, 12 layers), network `case118_ieee`, PowerFlow task. Same architecture as our `case118_genco_tiny_n10`.

| File | What for |
|---|---|
| `best_model_state_dict.pt` | weights (5.3 MB) |
| `normalizer_stats.pt` | normalizer statistics, **needed** at inference |
| `case118_ieee_tiny_seed0.yaml` | configuration published by the authors (identical to `config.yaml`) |
| `config.yaml` | copy of the `.yaml`, with the name our tools expect |
| `metrics.csv` | metrics published by them, on their test set (active residual 0.166 MW, reactive 0.024 MVAr) |
| `SHA256.txt` | checksums of the files in this directory |

SHA-256 of the weights: `6da8e3f13fa8f8adae4ec9ffd40384ad8890dbfa7d3fd980c10a645e3166a96d` (matches the one published in the guide we received).

## What is fact and what is assumption
- **Checked by us:** the folder on Hugging Face, the Apache-2.0 license, the size (5.28 MB), the architecture and the `config.yaml`, which lists `scenarios: 250000`, `epochs: 200`, `seed: 0`.
- **Not reported by the model card:** the training set and the level of topology perturbation. The guide we received *assumes* that it is the dataset `gridfm/pf_small_case118_ieee`
  generated with **at most one line out (N-1)**; we did not verify this. The `scenarios: 250000` of the config is the dataset size, not necessarily the number of samples used.
- The `config.yaml` has `mask_ref_vm: true`, an option that our graphkit commit (`95b90eec…`) does not recognize (it is ignored without error; the card says `main` added it).

## How we use it and what we measured (2026-10-21)
`docs/GENCO_CHECKPOINT_AUTORES.md`: screening on the 177 line outages, plan verifier (623 states with redispatch and shedding, which this model did not see either) and comparison with
2, 3, 5, 8 and 10 lines out, next to our `case118_genco_tiny_n10`. Reproduce:
```bash
python backend/tools/genco_verifica_planos.py --modelo models/case118_genco_tiny_autores --dst <file.json>
python backend/tools/genco_screening.py predict --out <build folder> --modelo models/case118_genco_tiny_autores --pred <predictions.parquet>
python backend/tools/genco_compara_modelos.py --modelo models/case118_genco_tiny_n10 --modelo models/case118_genco_tiny_autores
```
