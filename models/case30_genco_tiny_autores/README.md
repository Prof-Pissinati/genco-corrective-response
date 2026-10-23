# GENCO Tiny for IEEE 30 published by the GENCO authors

**Not our training.** Weights published by the GENCO authors (IBM Research and collaborators; OpenGridFM / Linux Foundation for Energy) under **Apache 2.0**, copied without change:

- Origin: https://huggingface.co/gridfm/genco-pf-datakit, folder `case30_ieee/tiny/seed0/` (downloaded on 2026-10-21). Paper: arXiv 2608.09921.
- Model: GENCO Tiny (`GNS_heterogeneous`, `hidden_size: 12`, 12 layers), network `case30_ieee`, PowerFlow task. It only serves **this** network.
- Files: `best_model_state_dict.pt` (weights), `normalizer_stats.pt` (needed at inference), `case30_ieee_tiny_seed0.yaml` and `config.yaml` (the same configuration, with the name our tools expect), `metrics.csv` (metrics published by them, on their test set).
- SHA-256 of the weights and of the normalizer in `SHA256.txt` (the weights' one matches the guide we received).
- The model card does not report the training data; the guide we received assumes the dataset `gridfm/pf_small_case30_ieee` with at most one line out (N-1). Not verified by us.

Results measured by us with this model: `docs/REDES_ADICIONAIS.md`. More details about the IEEE 118 checkpoint: `models/case118_genco_tiny_autores/README.md`.
