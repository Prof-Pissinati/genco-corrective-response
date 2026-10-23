"""Evaluates GENCO vs DC vs AC (reference) by number of line outages, on the scenarios of a predictions table.

Input:
  --raw   datakit `raw` folder (bus_data/branch_data in Parquet), e.g. data/case118_grande/case118_ieee/raw
  --pred  `case118_ieee_predictions.parquet` written by `gridfm_graphkit evaluate --save_output` (test set only)
Output: Markdown tables on screen and a JSON (--out) with all the numbers.

Definitions (the same as in `backend/tools/genco_screening.py`, to compare with the validation of the 177 outages):
  AC loading   = max(|S_from|, |S_to|) / rateA                        (branch_data: pf, qf, pt, qt)
  DC loading   = |pf_dc| / rateA
  GENCO loading = same as AC, with the flow computed from predicted Vm/Va and the branch_data admittances
  per line: "overloaded" = AC >= threshold; detected = estimate >= threshold (no margin)
  per scenario: critical = largest AC >= threshold (at 100%: > 1 + 1e-4, as in the backend); flagged = largest estimate >= threshold - margin
  outages = number of lines with br_status = 0 (generator outages are not counted)
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

BINS = [("N-0", 0, 0), ("N-1", 1, 1), ("N-2", 2, 2), ("N-3", 3, 3), ("N-4 a N-5", 4, 5), ("N-6 a N-10", 6, 10), ("Geral", 0, 99)]
LIMIARES = (0.8, 0.9, 1.0)


def carregar(raw: Path, pred_path: Path):
    pred = pd.read_parquet(pred_path).sort_values(["scenario", "bus"]).reset_index(drop=True)
    cen = np.sort(pred.scenario.unique())
    br = pd.read_parquet(raw / "branch_data.parquet", filters=[("scenario", "in", cen.tolist())])
    br = br.sort_values(["scenario", "idx"]).reset_index(drop=True)
    S, nb, nl = len(cen), int(pred.groupby("scenario").size().iloc[0]), int(br.groupby("scenario").size().iloc[0])
    assert (pred.groupby("scenario").size() == nb).all() and (br.groupby("scenario").size() == nl).all()
    assert np.array_equal(br.scenario.unique(), cen)
    return cen, pred, br, S, nb, nl


def metricas(raw: Path, pred_path: Path):
    cen, pred, br, S, nb, nl = carregar(raw, pred_path)
    col = lambda df, c, n: df[c].to_numpy().reshape(S, n)
    vm, va = col(pred, "Vm_pred", nb), col(pred, "Va_pred", nb)
    vm_t, va_t = col(pred, "Vm_target", nb), col(pred, "Va_target", nb)
    v = vm * np.exp(1j * va)
    f, t = col(br, "from_bus", nl).astype(int), col(br, "to_bus", nl).astype(int)
    c = lambda a, b: col(br, a, nl) + 1j * col(br, b, nl)
    yff, yft, ytf, ytt = c("Yff_r", "Yff_i"), c("Yft_r", "Yft_i"), c("Ytf_r", "Ytf_i"), c("Ytt_r", "Ytt_i")
    vf, vt = np.take_along_axis(v, f, 1), np.take_along_axis(v, t, 1)
    sf, st = np.abs(vf * np.conj(yff * vf + yft * vt)), np.abs(vt * np.conj(ytf * vf + ytt * vt))
    rate = col(br, "rate_a", nl)
    on = col(br, "br_status", nl) == 1
    ok = on & (rate > 0)
    safe = np.where(rate > 0, rate, 1.0)
    G = np.where(ok, np.maximum(sf, st) * 100.0 / safe, 0.0)                       # baseMVA = 100
    A = np.where(ok, np.maximum(np.hypot(col(br, "pf", nl), col(br, "qf", nl)), np.hypot(col(br, "pt", nl), col(br, "qt", nl))) / safe, 0.0)
    D = np.where(ok, np.abs(col(br, "pf_dc", nl)) / safe, 0.0)
    saidas = (~on).sum(1)
    res_p = pred.groupby("scenario")["active res. (MW)"].mean().to_numpy()
    pbe_max = pred.groupby("scenario")["PBE"].max().to_numpy()

    def conf(truth, est, th):
        tr, es = truth >= th - 1e-9, est >= th
        tp, fn, fp = int((tr & es).sum()), int((tr & ~es).sum()), int((~tr & es).sum())
        return {"tp": tp, "fn": fn, "fp": fp, "recall": tp / max(tp + fn, 1), "precisao": tp / max(tp + fp, 1), "reais": tp + fn}

    out = {}
    for nome, lo, hi in BINS:
        m = (saidas >= lo) & (saidas <= hi)
        if not m.any():
            continue
        k = ok[m]
        a, g, d = A[m][k], G[m][k], D[m][k]
        r = {"cenarios": int(m.sum()), "linhas": int(k.sum()),
             "erro_medio_pts": {"genco": float(np.mean(np.abs(g - a)) * 100), "dc": float(np.mean(np.abs(d - a)) * 100)},
             "erro_max_pts": {"genco": float(np.max(np.abs(g - a)) * 100), "dc": float(np.max(np.abs(d - a)) * 100)},
             "rmse_vm_pu": float(np.sqrt(np.mean((vm[m] - vm_t[m]) ** 2))), "rmse_va_rad": float(np.sqrt(np.mean((va[m] - va_t[m]) ** 2))),
             "residuo_p_medio_mw": float(res_p[m].mean()), "pbe_max_mva": float(pbe_max[m].max()),
             "por_linha": {}, "por_cenario": {}}
        for th in LIMIARES:
            r["por_linha"][str(th)] = {"genco": conf(a, g, th), "dc": conf(a, d, th)}
            ta = A[m].max(1)
            truth = ta > 1 + 1e-4 if th == 1.0 else ta >= th
            r["por_cenario"][str(th)] = {"criticos": int(truth.sum())}
            for nm, E in (("genco", G[m]), ("dc", D[m])):
                est = E.max(1)
                for mg in (0.0, 0.05):
                    sig = est >= th - mg
                    tp = int((truth & sig).sum())
                    r["por_cenario"][str(th)][f"{nm}_margem{int(mg * 100)}"] = {"recall": tp / max(int(truth.sum()), 1), "enviados_ao_ac": float(sig.mean()), "perdidos": int((truth & ~sig).sum())}
        out[nome] = r
    return out


def markdown(out):
    L = []
    pct = lambda x: f"{x * 100:.0f}%"
    L.append("| Outages | Scenarios | Lines | Mean error GENCO / DC (% pts) | Max error GENCO / DC | RMSE Vm (pu) | RMSE Va (rad) | Mean P residual (MW) |")
    L.append("|---|---|---|---|---|---|---|---|")
    for n, r in out.items():
        L.append(f"| {n} | {r['cenarios']} | {r['linhas']} | **{r['erro_medio_pts']['genco']:.2f}** / {r['erro_medio_pts']['dc']:.2f} | {r['erro_max_pts']['genco']:.1f} / {r['erro_max_pts']['dc']:.1f} | {r['rmse_vm_pu']:.4f} | {r['rmse_va_rad']:.3f} | {r['residuo_p_medio_mw']:.2f} |")
    for th in LIMIARES:
        L.append(f"\n**Detection per line, threshold {int(th * 100)}%** (recall / precision; misses and false alarms in parentheses)\n")
        L.append("| Outages | Actual lines | GENCO recall | GENCO precision | GENCO (misses / FP) | DC recall | DC precision | DC (misses / FP) |")
        L.append("|---|---|---|---|---|---|---|---|")
        for n, r in out.items():
            g, d = r["por_linha"][str(th)]["genco"], r["por_linha"][str(th)]["dc"]
            L.append(f"| {n} | {g['reais']} | **{pct(g['recall'])}** | {pct(g['precisao'])} | {g['fn']} / {g['fp']} | {pct(d['recall'])} | {pct(d['precisao'])} | {d['fn']} / {d['fp']} |")
    for th in LIMIARES:
        L.append(f"\n**Detection per scenario, threshold {int(th * 100)}%** (critical scenario = some line above the threshold; margin = % points below the threshold that already send the scenario to the AC)\n")
        L.append("| Outages | Critical | GENCO no margin | GENCO 5-pt margin (sent to the AC) | DC no margin | DC 5-pt margin (sent to the AC) |")
        L.append("|---|---|---|---|---|---|")
        for n, r in out.items():
            s = r["por_cenario"][str(th)]
            L.append(f"| {n} | {s['criticos']} | **{pct(s['genco_margem0']['recall'])}** | {pct(s['genco_margem5']['recall'])} ({pct(s['genco_margem5']['enviados_ao_ac'])}) | {pct(s['dc_margem0']['recall'])} | {pct(s['dc_margem5']['recall'])} ({pct(s['dc_margem5']['enviados_ao_ac'])}) |")
    return "\n".join(L)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--pred", required=True)
    ap.add_argument("--out", help="output JSON (optional)")
    a = ap.parse_args()
    res = metricas(Path(a.raw), Path(a.pred))
    print(markdown(res))
    if a.out:
        Path(a.out).write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
