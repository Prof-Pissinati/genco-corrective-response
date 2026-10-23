# License and attributions

Copyright 2026 the authors of this repository (`Prof-Pissinati` and `leonardp315`). The original code is distributed under the **Apache License 2.0** (file `LICENSE`); texts and figures under **CC BY 4.0**.

## Third-party materials

This repository gathers original code and third-party materials. The third-party materials keep their original licenses.

| Material | Where it is | Origin and license |
|---|---|---|
| IEEE 118 case (PGLib-OPF v23.07, `pglib_opf_case118_ieee.m`) and the derived case `case118_ieee.json` | `interface/src/data/` | IEEE PES Power Grid Library, https://github.com/power-grid-lib/pglib-opf (CC BY 4.0). The JSON adds the dispatch of an AC-OPF (PowerModels.jl) and a drawing layout. |
| GENCO paper (arXiv 2608.09921) | `docs/referencias/` | CC BY 4.0, https://arxiv.org/abs/2608.09921 |
| gridfm-datakit paper (arXiv 2512.14658) | `docs/referencias/` | CC BY 4.0, https://arxiv.org/abs/2512.14658 |
| GENCO, gridfm-graphkit and gridfm-datakit | used as dependencies (not copied) | OpenGridFM ecosystem, Apache 2.0: https://github.com/gridfm |
| GENCO Tiny weights (`models/case118_genco_tiny_n10/` and `models/case118_genco_tiny/`) | `models/` | Trained by us with GENCO (branch `genco-paper-repro`) on data generated with gridfm-datakit over the IEEE 118 case above. |
| IEEE 14, 30 and 57 cases (PGLib-OPF v23.07, `pglib_opf_case<N>_ieee.m`) and the derived cases `case<N>_ieee.json` | `interface/src/data/` | IEEE PES Power Grid Library, https://github.com/power-grid-lib/pglib-opf (CC BY 4.0). The JSON files add the dispatch of an AC-OPF (PowerModels.jl) and an automatic layout. |
| GOC 500, 2000 and 10000 cases (PGLib-OPF v23.07, `pglib_opf_case<N>_goc.m`) | `interface/src/data/` | IEEE PES Power Grid Library, https://github.com/power-grid-lib/pglib-opf (CC BY 4.0). Used only in the scale study (`docs/GENCO_ESCALA.md`); the derived JSON cases are not versioned. |
| Authors' GENCO Tiny weights for GOC 500, 2000 and 10000 (`models/case{500,2000,10000}_goc_genco_tiny_autores/`) | `models/` | **Not ours.** Published by the GENCO authors at https://huggingface.co/gridfm/genco-pf-datakit (`case<N>_goc/tiny/seed0`), Apache 2.0, copied without change; see the `README.md` of each folder and the arXiv paper 2608.09921. |
| Authors' GENCO Tiny weights for IEEE 14, 30 and 57 (`models/case{14,30,57}_genco_tiny_autores/`) | `models/` | **Not ours.** Published by the GENCO authors at https://huggingface.co/gridfm/genco-pf-datakit (`case<N>_ieee/tiny/seed0`), Apache 2.0, copied without change; see the `README.md` of each folder and the arXiv paper 2608.09921. |
| Authors' GENCO **OPF** Small weights for IEEE 118 (`models/case118_genco_opf_small_autores/`) | `models/` | **Not ours.** Published by the GENCO authors at https://huggingface.co/gridfm/genco-opf-datakit (`case118_ieee/small/seed0`), Apache 2.0, copied without change; see the folder's `README.md` and the arXiv paper 2608.09921. |
| Authors' GENCO Tiny weights (`models/case118_genco_tiny_autores/`) | `models/` | **Not ours.** Published by the GENCO authors at https://huggingface.co/gridfm/genco-pf-datakit (`case118_ieee/tiny/seed0`), Apache 2.0, copied without change; see the folder's `README.md` and the arXiv paper 2608.09921. |
| Interface | `interface/` | Derived from the Power Simulator (the author's repository, currently private; see `interface/ORIGEM.md`), by the same author. npm dependencies with their own licenses (`interface/package-lock.json`). |

Synthetic data: the fault lists, the repair and switching times and the replay scenarios are **fictitious**, created for demonstration.
