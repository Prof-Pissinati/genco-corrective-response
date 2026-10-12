# Licença e atribuições

Copyright 2026 os autores deste repositório (`Prof-Pissinati` e `leonardp315`). O código próprio é distribuído sob a **Apache License 2.0** (arquivo `LICENSE`); textos e figuras, sob **CC BY 4.0**.

## Materiais de terceiros

Este repositório reúne código próprio e materiais de terceiros. Os materiais de terceiros mantêm suas licenças originais.

| Material | Onde está | Origem e licença |
|---|---|---|
| Caso IEEE 118 (PGLib-OPF v23.07, `pglib_opf_case118_ieee.m`) e o caso derivado `case118_ieee.json` | `interface/src/data/` | IEEE PES Power Grid Library, https://github.com/power-grid-lib/pglib-opf (CC BY 4.0). O JSON acrescenta o despacho de um AC-OPF (PowerModels.jl) e um layout de desenho. |
| Artigo do GENCO (arXiv 2608.09921) | `docs/referencias/` | CC BY 4.0, https://arxiv.org/abs/2608.09921 |
| Artigo do gridfm-datakit (arXiv 2512.14658) | `docs/referencias/` | CC BY 4.0, https://arxiv.org/abs/2512.14658 |
| GENCO, gridfm-graphkit e gridfm-datakit | usados como dependências (não copiados) | Ecossistema OpenGridFM, Apache 2.0: https://github.com/gridfm |
| Pesos do GENCO Tiny (`models/case118_genco_tiny/`) | `models/` | Treinados por nós com o GENCO (branch `genco-paper-repro`) em dados gerados com o gridfm-datakit sobre o caso IEEE 118 acima. |
| Interface | `interface/` | Derivada do Simulador de Potência (repositório do autor, atualmente privado; ver `interface/ORIGEM.md`), do mesmo autor. Dependências npm com suas próprias licenças (`interface/package-lock.json`). |

Dados sintéticos: as listas de falhas, os tempos de reparo e de manobra e os cenários do replay são **fictícios**, criados para demonstração.
