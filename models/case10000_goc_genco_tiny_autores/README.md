# GENCO Tiny for GOC 10000 published by the GENCO authors

**Not our training.** Weights published by the GENCO authors (IBM Research and collaborators; OpenGridFM / Linux Foundation for Energy) under **Apache 2.0**, copied without change:

- Origin: https://huggingface.co/gridfm/genco-pf-datakit, folder `case10000_goc/tiny/seed0/` (downloaded on 2026-10-21). Paper: arXiv 2608.09921.
- Model: GENCO Tiny (`GNS_heterogeneous`, `hidden_size: 12`, 12 layers), network `case10000_goc`, PowerFlow task. It only serves **this** network.
- `config.yaml` (same as the published `.yaml`) lists `scenarios: 20000` and `epochs: 200`.
- **The weights used here are the published `last.pt`** (the model card says to use `last.pt` on GOC 10000), saved under the name `best_model_state_dict.pt` that our tools expect.
- SHA-256 of the `.pt` files in `SHA256.txt`.

Results measured by us with this model (error and time against our AC): `docs/GENCO_ESCALA.md`. This network is **not** in the interface.
