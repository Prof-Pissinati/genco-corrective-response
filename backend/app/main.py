"""API do backend (FastAPI): /health, /cases, /evaluate, /verify. Contrato em docs/CONTRATO_API.md.

Rodar (a partir da pasta backend/, no ambiente do backend):
    uvicorn app.main:app --port 8000
Variáveis de ambiente: GENCO_CASES_DIR (pasta dos JSON de caso; padrão ../interface/src/data), GENCO_CORS (origens, padrão "*").
"""
from __future__ import annotations

import hashlib
import json
import os
from collections import OrderedDict
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .corrective import plan_corrective
from .evaluate import evaluate
from .network import Network, from_mpc, load_case
from .recovery import recover
from .screening import screen

CASES_DIR = Path(os.environ.get("GENCO_CASES_DIR", Path(__file__).resolve().parents[2] / "interface" / "src" / "data"))
MAX_TOPOLOGIES = 2000

app = FastAPI(title="GENCO Challenge - backend de avaliação", version="0.5.0")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("GENCO_CORS", "*").split(","), allow_methods=["*"], allow_headers=["*"])

_named: dict[str, Network] = {}
_inline: "OrderedDict[str, Network]" = OrderedDict()


def _case_files() -> dict[str, Path]:
    out = {}
    for p in sorted(CASES_DIR.glob("*.json")):
        try:
            head = json.loads(p.read_text(encoding="utf-8"))
        except Exception:                                      # noqa: BLE001
            continue
        if isinstance(head, dict) and {"bus", "gen", "branch", "baseMVA"} <= set(head):
            out[p.stem] = p
    return out


def get_named(name: str) -> Network:
    if name not in _named:
        files = _case_files()
        if name not in files:
            raise HTTPException(404, f"caso '{name}' não encontrado; disponíveis: {sorted(files)}")
        _named[name] = load_case(files[name])
    return _named[name]


def get_inline(case: dict) -> Network:
    key = hashlib.sha1(json.dumps(case, sort_keys=True).encode()).hexdigest()
    if key not in _inline:
        try:
            _inline[key] = from_mpc(case, name="inline")
        except Exception as exc:                               # noqa: BLE001
            raise HTTPException(422, f"caso inválido: {exc}") from exc
        while len(_inline) > 8:
            _inline.popitem(last=False)
    _inline.move_to_end(key)
    return _inline[key]


class Topology(BaseModel):
    branchOut: list[int] = Field(default_factory=list, description="índices (linha da tabela branch, a partir de 0) dos ramos fora")
    busOut: list[int] = Field(default_factory=list, description="números MATPOWER das barras em falta")


class EvalRequest(BaseModel):
    grid: str | None = Field(None, description="nome do caso (ver /cases)")
    case: dict | None = Field(None, description="alternativa a `grid`: tabelas MATPOWER {baseMVA, bus, gen, branch}")
    solver: Literal["ac", "dc", "genco", "auto"] = "ac"
    topologies: list[Topology]


def _resolve(req: EvalRequest) -> Network:
    if req.case is not None:
        return get_inline(req.case)
    if req.grid:
        return get_named(req.grid)
    raise HTTPException(422, "informe `grid` ou `case`")


def _validate(net: Network, topo: Topology):
    bad = [b for b in topo.branchOut if b < 0 or b >= net.nl]
    if bad:
        raise HTTPException(422, f"ramos inexistentes: {bad} (0..{net.nl - 1})")
    known = set(int(n) for n in net.bus_no)
    badb = [b for b in topo.busOut if b not in known]
    if badb:
        raise HTTPException(422, f"barras inexistentes: {badb}")


class CorrectiveOptions(BaseModel):
    maxIter: int = Field(8, ge=1, le=20, description="iterações do ciclo plano -> verificação AC -> aperto dos limites")
    margin: float = Field(0.0, ge=0.0, lt=0.5, description="folga inicial nos limites térmicos (fração do rateA)")


class CorrectiveRequest(BaseModel):
    grid: str | None = Field(None, description="nome do caso (ver /cases)")
    case: dict | None = Field(None, description="alternativa a `grid`: tabelas MATPOWER")
    faults: Topology = Field(default_factory=Topology, description="linhas (branchOut) e barras (busOut) com defeito")
    options: CorrectiveOptions = Field(default_factory=CorrectiveOptions)


@app.get("/health")
def health():
    return {"status": "ok", "version": app.version, "cases": sorted(_case_files()), "solvers": ["ac", "dc"], "endpoints": ["/evaluate", "/verify", "/corrective", "/screen", "/recovery"],
            "pending": {"genco": "disponível na Fase 5 (pesos treinados)"}}


@app.get("/cases")
def cases():
    return {"cases": sorted(_case_files())}


@app.post("/evaluate")
def evaluate_endpoint(req: EvalRequest):
    if req.solver == "genco":
        raise HTTPException(501, "solver 'genco' ainda não disponível (Fase 5); use 'ac', 'dc' ou 'auto'")
    if len(req.topologies) > MAX_TOPOLOGIES:
        raise HTTPException(413, f"no máximo {MAX_TOPOLOGIES} topologias por pedido")
    net = _resolve(req)
    solver = "ac" if req.solver == "auto" else req.solver     # 'auto' = GENCO na triagem (Fase 5); por ora AC
    results = []
    for topo in req.topologies:
        _validate(net, topo)
        results.append(evaluate(net, topo.branchOut, topo.busOut, solver))
    return {"grid": net.name, "results": results}


@app.post("/verify")
def verify_endpoint(req: EvalRequest):
    """Confirmação exata: igual a /evaluate com solver AC."""
    return evaluate_endpoint(req.model_copy(update={"solver": "ac"}))


@app.post("/corrective")
def corrective_endpoint(req: CorrectiveRequest):
    """Resposta corretiva às falhas: redespacho da geração e, se ainda houver violação, o corte mínimo de carga (verificado pelo AC)."""
    net = _resolve(EvalRequest(grid=req.grid, case=req.case, topologies=[]))
    _validate(net, req.faults)
    out = plan_corrective(net, req.faults.branchOut, req.faults.busOut, max_iter=req.options.maxIter, margin=req.options.margin)
    return {"grid": net.name, **out}


class ScreenRequest(BaseModel):
    grid: str | None = Field(None, description="nome do caso (ver /cases)")
    case: dict | None = Field(None, description="alternativa a `grid`: tabelas MATPOWER")
    scope: Literal["both", "lines", "buses"] = "both"


@app.post("/screen")
def screen_endpoint(req: ScreenRequest):
    """Varredura N-1: cada linha e cada barra, com o que o estado pós-falta (AC, com resposta automática da geração) exige."""
    net = _resolve(EvalRequest(grid=req.grid, case=req.case, topologies=[]))
    return screen(net, req.scope)


class RepairItem(BaseModel):
    type: Literal["line", "bus"]
    id: int = Field(description="índice do ramo (line) ou número MATPOWER da barra (bus)")


class RecoveryOptions(BaseModel):
    blockMW: float = Field(50.0, gt=0, le=1000, description="tamanho máximo de cada bloco de carga religado")
    repairHours: float = Field(2.0, ge=0, le=100, description="horas entre um reparo e o seguinte (dado sintético)")
    blockMinutes: float = Field(10.0, ge=0, le=600, description="minutos por manobra de religação (dado sintético)")


class RecoveryRequest(BaseModel):
    grid: str | None = Field(None, description="nome do caso (ver /cases)")
    case: dict | None = Field(None, description="alternativa a `grid`: tabelas MATPOWER")
    faults: Topology = Field(default_factory=Topology, description="todas as falhas iniciais")
    repairOrder: list[RepairItem] | None = Field(None, description="ordem dos reparos (permutação das falhas); padrão: linhas e depois barras")
    options: RecoveryOptions = Field(default_factory=RecoveryOptions)


@app.post("/recovery")
def recovery_endpoint(req: RecoveryRequest):
    """Reparo e religação da carga por blocos: linha do tempo do plano inicial até a rede restaurada (cada passo verificado pelo AC)."""
    net = _resolve(EvalRequest(grid=req.grid, case=req.case, topologies=[]))
    _validate(net, req.faults)
    default = [("line", k) for k in req.faults.branchOut] + [("bus", n) for n in req.faults.busOut]
    if req.repairOrder is None:
        order = default
    else:
        order = [(r.type, r.id) for r in req.repairOrder]
        if sorted(order) != sorted(default) or len(set(order)) != len(order):
            raise HTTPException(422, "repairOrder deve ser uma permutação das falhas informadas, sem repetição")
    if not order:
        raise HTTPException(422, "informe ao menos uma falha")
    if int(net.bus_no[net.ref]) in req.faults.busOut:
        raise HTTPException(422, "a barra de referência em falta deixa a rede sem energia; não há religação por blocos")
    return {"grid": net.name, "faults": req.faults.model_dump(),
            **recover(net, order, req.options.blockMW, req.options.repairHours, req.options.blockMinutes)}
