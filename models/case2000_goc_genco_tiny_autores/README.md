# GENCO Tiny for GOC 2000 published by the GENCO authors

**Not our training.** Weights published by the GENCO authors (IBM Research and collaborators; OpenGridFM / Linux Foundation for Energy) under **Apache 2.0**, copied without change:

- Origin: https://huggingface.co/gridfm/genco-pf-datakit, folder `case2000_goc/tiny/seed0/` (downloaded on 2026-10-21). Paper: arXiv 2608.09921.
- Model: GENCO Tiny (`GNS_heterogeneous`, `hidden_size: 12`, 12 layers), network `case2000_goc`, PowerFlow task. It only serves **this** network.
- `config.yaml` (same as the published `.yaml`) lists `scenarios: 20000` and `epochs: 300`.
- Files: `best_model_state_dict.pt`, `normalizer_stats.pt` (needed), `config.yaml`, `metrics.csv` (metrics published by them).
- SHA-256 of the `.pt` files in `SHA256.txt`.

Results measured by us with this model (error and time against our AC): `docs/GENCO_ESCALA.md`. This network is **not** in the interface.
