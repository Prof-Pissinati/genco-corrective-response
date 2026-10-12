# Backend (FastAPI) — Fase 2

Serviço local que avalia topologias de uma rede de transmissão e responde no formato de `../docs/CONTRATO_API.md`.

| Endpoint | O que faz |
|---|---|
| `GET /health` | estado do serviço, casos e solvers disponíveis |
| `GET /cases` | nomes dos casos (arquivos `*.json` de `interface/src/data`) |
| `POST /evaluate` | estado elétrico de **uma ou várias topologias** (lote, até 2000), solver `ac` ou `dc` |
| `POST /verify` | igual a `/evaluate` com o solver AC (confirmação exata) |
| `POST /corrective` | **resposta corretiva** às falhas (linhas e/ou barras): redespacho da geração e corte mínimo de carga, verificado pelo AC (`app/corrective.py`) |

O solver `genco` retorna 501 até os pesos serem integrados (Fase 5). `/restore`, `/plan` e `/scenario` foram substituídos por `/corrective` (ver `docs/CONTRATO_API.md` §8).

## Solvers
- **AC:** Newton-Raphson em coordenadas polares (`app/acpf.py`, numpy/scipy esparso), barra de referência absorve desbalanço e perdas, geradores PV mantêm P e |V|, sem limites de Q (como o `compute_ac_pf` do PowerModels usado nos dados do GENCO; as violações de Q são reportadas). Só a ilha com a barra de referência é calculada.
- **DC:** despacho fixo, a referência absorve o desbalanço (mesma formulação do solver em JS da interface).
- **Validação:** o AC bate com o **PowerModels** (6 cenários do gridfm-datakit, 0 a 7 linhas fora: diferença de tensão ~1e-12 pu e de fluxo < 1e-6 MW) e com o **pandapower** (tensões, caso base). Tempo típico no IEEE 118: ~10 a 30 ms por topologia.
- **Decisão de 2026-10-08:** o plano previa o pandapower como solver AC; o backend usa um Newton-Raphson próprio (simples, esparso e com mapeamento direto dos ramos da tabela MATPOWER e das ilhas) e mantém o **pandapower como referência de validação** (nos testes) junto com o PowerModels.

## Rodar
**Mais fácil (Windows):** dê duplo clique em `iniciar-local.bat` (na raiz do repositório). Ele abre duas janelas (backend na porta 8000 e interface na 5173) e o navegador. Para parar, feche as janelas.

**Passo a passo manual**, com o ambiente leve `..\backend-run`, que usa o Python do sistema (Python 3.12 ou mais novo):
```powershell
# uma vez, a partir da pasta do projeto (concurso-genco):
python -m venv ..\backend-run
..\backend-run\Scripts\python.exe -m pip install -r backend\requirements.txt

# toda vez:
cd backend
..\..\backend-run\Scripts\python.exe -m uvicorn app.main:app --port 8000
```
Atenção: **não use um Python baixado pelo `uv`** (fica na pasta de instalação do `uv`, em `AppData`) para ambientes que outras pessoas vão executar; em alguns casos essa pasta não é visível ao PowerShell do usuário. Use o Python instalado no sistema.

Variáveis: `GENCO_CASES_DIR` (pasta dos casos; padrão `interface/src/data`), `GENCO_CORS` (origens permitidas; padrão `*`, uso local).

Exemplo (caso base e faltas nas barras 81 e 100, ambos pelo AC):
```bash
curl -s localhost:8000/evaluate -H "Content-Type: application/json" \
  -d '{"grid":"case118_ieee","solver":"ac","topologies":[{}, {"busOut":[81,100]}]}'
```
A interface chama o backend pelo botão **AC** (barra lateral). Sem o backend, ela continua com o **DC local** (o botão mostra `DC*` e a dica explica o motivo). Endereço do backend: `VITE_BACKEND_URL` (padrão `http://127.0.0.1:8000`).

## Testes
```powershell
# ambiente de testes completo (Python 3.12 recomendado):  pip install -r backend\requirements-dev.txt
cd backend; python -m pytest -q       # 35 testes (~20 s); sem o pandapower, 18 passam e 1 é pulado
```
- `tests/test_acpf.py`: AC × PowerModels (6 cenários), AC × pandapower, DC × referência da interface.
- `tests/test_api.py`: topologia/ilhas, resposta da API, erros (404/422/501), caso inline, nome do caso.
- `tests/fixtures/datakit_case118.json`: cenários do datakit (gerados por `tools/export_datakit_fixture.py`).

## Gerar o caso para a interface
`backend/tools/export_case.py` lê um caso MATPOWER, calcula o **despacho base com AC-OPF** (o `Pg` do PGLib não fecha com a carga) e o layout do diagrama, e grava `interface/src/data/case118_ieee.json` (o `name` do JSON deve ser igual ao nome do arquivo: é o nome do caso na API). Também grava a referência DC (`--ref`) usada nos testes da interface (`npm test`):
```bash
python backend/tools/export_case.py <pglib_opf_case118_ieee.m> interface/src/data/case118_ieee.json --ref interface/tests/case118_dc_ref.json
```
O `.m` do PGLib (licença CC BY 4.0) está em `interface/src/data/pglib_opf_case118_ieee.m`. Para o `export_case.py` o pandapower é necessário (`requirements.txt`).
