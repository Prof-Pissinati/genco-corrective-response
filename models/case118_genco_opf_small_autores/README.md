# GENCO OPF Small for IEEE 118 published by the GENCO authors

**Not our training.** Weights published by the GENCO authors (IBM Research and collaborators; OpenGridFM / Linux Foundation for Energy) under **Apache 2.0**, copied without change:

- Origin: https://huggingface.co/gridfm/genco-opf-datakit, folder `case118_ieee/small/seed0/` (downloaded on 2026-10-22). Paper: arXiv 2608.09921.
- Model: GENCO Small (`GNS_heterogeneous`, `hidden_size: 24`, 12 layers), network `case118_ieee`, **OptimalPowerFlow** task (it predicts optimal dispatch and voltages). Training according to `config.yaml`: 250,000 scenarios, 200 epochs.
- Weights: `last.pt` (the model card says to use `last.pt` on the 118). `normalizer_stats.pt` is needed at inference. `config.yaml` is a copy of the published `.yaml`.
- Metrics published by them (`metrics.csv`, on their test set): mean cost difference 1.68%, dispatch RMSE 17.7 MW; **there is no out-of-range voltage metric**. The predicted voltage is limited by construction between `vmin` and `vmax`.
- SHA-256 in `SHA256.txt`.

How we use it and what we measured: `docs/TENSAO_GENCO_OPF.md`.
