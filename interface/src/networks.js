// src/networks.js
// Networks the interface can open (transmission), with the GENCO results for each one.
// Data for each network: exported case (backend/tools/export_case.py), GENCO results (backend/tools/genco_screening.py and genco_verifica_planos.py)
// and replay (backend/tools/export_replay.py). The model is the checkpoint published by the GENCO authors (gridfm/genco-pf-datakit, Apache 2.0).
import CASE14 from './data/case14_ieee.json';
import CASE30 from './data/case30_ieee.json';
import CASE57 from './data/case57_ieee.json';
import CASE118 from './data/case118_ieee.json';
import LAYOUT14 from './data/layout_case14_ieee.json';
import LAYOUT30 from './data/layout_case30_ieee.json';
import LAYOUT57 from './data/layout_case57_ieee.json';
import LAYOUT118 from './data/layout_case118_ieee.json';
import SCREENING_14 from './data/screening_case14_ieee_autores.json';
import SCREENING_30 from './data/screening_case30_ieee_autores.json';
import SCREENING_57 from './data/screening_case57_ieee_autores.json';
import SCREENING_118 from './data/screening_case118_ieee_autores.json';
import VERIF_14 from './data/verificacao_planos_case14_ieee_autores.json';
import VERIF_30 from './data/verificacao_planos_case30_ieee_autores.json';
import VERIF_57 from './data/verificacao_planos_case57_ieee_autores.json';
import VERIF_118 from './data/verificacao_planos_case118_ieee_autores.json';
import VERIF_118_N10 from './data/verificacao_planos_case118_ieee_n10.json';

/** `layout`: design positions and bends, drawn by the author (`layout_<network>.json`); the automatic layout that comes with the case itself only applies if it is missing. */
export const NETWORKS = [
    { key: 'case14_ieee', label: 'IEEE 14', mpc: CASE14, layout: LAYOUT14, genco: { screening: SCREENING_14, verification: VERIF_14, verificationAlt: null } },
    { key: 'case30_ieee', label: 'IEEE 30', mpc: CASE30, layout: LAYOUT30, genco: { screening: SCREENING_30, verification: VERIF_30, verificationAlt: null } },
    { key: 'case57_ieee', label: 'IEEE 57', mpc: CASE57, layout: LAYOUT57, genco: { screening: SCREENING_57, verification: VERIF_57, verificationAlt: null } },
    { key: 'case118_ieee', label: 'IEEE 118', mpc: CASE118, layout: LAYOUT118, genco: { screening: SCREENING_118, verification: VERIF_118, verificationAlt: VERIF_118_N10 } },
];

export const networkOf = (gridName) => NETWORKS.find(n => n.key === gridName) || null;

/** `buildTransmissionSystem` options to open a network. */
export function systemOptions(n) {
    return {
        layout: n.layout ? n.layout.positions : n.mpc.layout,
        waypoints: n.layout ? n.layout.waypoints : undefined,
        name: `${n.label} (transmission)`, gridName: n.mpc.name,
    };
}
