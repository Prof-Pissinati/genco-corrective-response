"""Gera os dados do REPLAY ESTÁTICO da interface (versão para o júri, sem backend): resultados pré-calculados do IEEE 118.

Conteúdo de `interface/src/data/replay_case118_ieee.json`:
  base       estado AC do caso sem falhas (igual em todas as análises; guardado uma vez)
  screen     varredura N-1 completa (303 contingências)
  corrective resposta corretiva (pós-falta e com plano) de cada contingência escolhida
  recovery   linha do tempo de reparo e religação por blocos das que exigem corte e de dois cenários combinados
As chaves seguem `interface/src/solver/replay.js` (função `faultKey` / `recoveryKey`).

Uso (a partir da raiz do repositório, no Python do backend):
    python backend/tools/export_replay.py [--top 25]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.corrective import plan_corrective      # noqa: E402
from app.evaluate import evaluate               # noqa: E402
from app.network import load_case               # noqa: E402
from app.recovery import recover                # noqa: E402
from app.screening import screen                # noqa: E402

CASE = ROOT / "interface" / "src" / "data" / "case118_ieee.json"
OUT = ROOT / "interface" / "src" / "data" / "replay_case118_ieee.json"
DEMOS = [  # cenários combinados de demonstração (linhas pelo índice do ramo; barras pelo número)
    {"branchOut": [7], "busOut": [68]},
    {"branchOut": [7, 29], "busOut": [8]},
]


def fault_key(branch_out, bus_out) -> str:
    return "c:" + ",".join(str(x) for x in sorted(branch_out)) + "|" + ",".join(str(x) for x in sorted(bus_out))


def recovery_key(order) -> str:
    return "r:" + ",".join(f"{t}{i}" for t, i in order)


def compact(ev: dict) -> dict:
    """Só o que a interface usa, com menos casas decimais."""
    r = lambda x, n: round(float(x), n)       # noqa: E731
    return {
        "solver": ev["solver"], "converged": ev["converged"], "ms": r(ev["ms"], 1), "energized": ev["energized"], "lostBuses": ev["lostBuses"],
        "servedMW": r(ev["servedMW"], 3), "lostMW": r(ev["lostMW"], 3),
        "buses": [{"id": b["id"], "vm": r(b["vm"], 4), "va": r(b["va"], 3)} for b in ev["buses"]],
        "branches": [{"id": b["id"], "pf": r(b["pf"], 3), "qf": r(b["qf"], 3), "pt": r(b["pt"], 3), "qt": r(b["qt"], 3), "loading": r(b["loading"], 4)} for b in ev["branches"]],
        "gens": [{"id": g["id"], "bus": g["bus"], "pg": r(g["pg"], 3), "qg": r(g["qg"], 3)} for g in ev["gens"]],
        "violations": ev["violations"],
    }


def pack_corrective(resp: dict) -> dict:
    out = {k: v for k, v in resp.items() if k not in ("pre", "postFault", "after")}
    out["postFault"] = compact(resp["postFault"])
    out["after"] = compact(resp["after"])               # `pre` = base (preenchido na leitura)
    return out


def pack_recovery(resp: dict) -> dict:
    out = dict(resp)
    out["events"] = [{**e, "state": compact(e["state"])} for e in resp["events"]]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=25, help="quantas contingências mais severas (além das que exigem corte) levam resposta corretiva")
    args = ap.parse_args()
    t0 = time.perf_counter()
    net = load_case(CASE)
    scr = screen(net, "both")
    print(f"varredura: {scr['count']} contingências, {scr['needAction']} exigem plano ({scr['ms'] / 1000:.1f} s)")

    need = [c for c in scr["contingencies"] if c["needsAction"]]
    plans, chosen = {}, []
    for c in need:                                                        # plano de todas as que exigem ação: separa as que cortam carga
        bo, bu = ([c["id"]], []) if c["type"] == "line" else ([], [c["id"]])
        plans[(c["type"], c["id"])] = plan_corrective(net, bo, bu)
    shed = [c for c in need if plans[(c["type"], c["id"])]["plan"]["totalShedMW"] > 0.05]
    rest = [c for c in need if c not in shed][: args.top]
    chosen = shed + rest
    print(f"escolhidas: {len(shed)} com corte + {len(rest)} mais severas")

    corrective, recovery = {}, {}
    for c in chosen:
        bo, bu = ([c["id"]], []) if c["type"] == "line" else ([], [c["id"]])
        corrective[fault_key(bo, bu)] = pack_corrective(plans[(c["type"], c["id"])])
    for c in shed:
        order = [(c["type"], c["id"])]
        recovery[recovery_key(order)] = pack_recovery(recover(net, order))
    for d in DEMOS:
        order = [("line", k) for k in d["branchOut"]] + [("bus", n) for n in d["busOut"]]
        corrective[fault_key(d["branchOut"], d["busOut"])] = pack_corrective(plan_corrective(net, d["branchOut"], d["busOut"]))
        recovery[recovery_key(order)] = pack_recovery(recover(net, order))

    key_has = lambda c: fault_key(*(([c["id"]], []) if c["type"] == "line" else ([], [c["id"]]))) in corrective        # noqa: E731
    for c in scr["contingencies"]:
        c["hasPlan"] = bool(key_has(c))
        c["hasRecovery"] = recovery_key([(c["type"], c["id"])]) in recovery
    data = {
        "version": 1, "case": net.name, "note": "resultados pré-calculados pelo backend (AC); gerado por backend/tools/export_replay.py",
        "base": compact(evaluate(net, [], [], "ac")), "screen": scr, "corrective": corrective, "recovery": recovery,
    }
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"gravado {OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.0f} KB ({len(corrective)} respostas corretivas, {len(recovery)} religações) em {time.perf_counter() - t0:.0f} s")


if __name__ == "__main__":
    main()
