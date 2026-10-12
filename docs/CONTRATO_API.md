# Contrato de dados e API (interface ↔ backend)

> Versão 0.5 — 2026-10-12 (`/evaluate`, `/corrective`, `/screen` e `/recovery` implementados; ver §7 a §10).
> A interface e o backend só conversam por este contrato; trocar o avaliador (AC → GENCO) **não** muda nada aqui.

## 1. Convenções
- **Índices a partir de 0** na API, iguais à posição nas tabelas `bus` e `branch` do arquivo MATPOWER. `id` de ramo = linha da tabela `branch` (mesma convenção do `app/data.json` do painel de contingências).
- **Numeração de barras na interface:** a interface mostra e usa o **número da barra do MATPOWER** (`BUS_I`, de 1 a 118 no IEEE 118), o que os engenheiros reconhecem (ex.: linha 38–65). A API usa o índice a partir de 0; cada barra traz `number` (`BUS_I`) para converter. O painel de contingências atual mostra os índices a partir de 0 (ex.: "37–64" para a linha 38–65); vale alinhar.
- **Unidades:** potência ativa em **MW**, reativa em **MVAr**, aparente em **MVA**, tensão em **pu**, ângulo em **graus**, tempo em **minutos**, energia não suprida (ENS) em **MWh**.
- **Carregamento** de um ramo = `max(S_origem, S_destino) / rateA` (razão; 1,0 = 100%), o mesmo cálculo usado nos scripts de contingência do GENCO. O backend calcula; não usar o `loading_percent` do pandapower (ele reclassifica ramos e converte o limite).
- **Faltas em barra:** uma barra em falta retira a barra e **todos os ramos incidentes**; a carga e a geração dela se perdem.
- **Energização:** só a **ilha que contém a barra de referência (REF)** é energizada e calculada. Ilhas sem a referência ficam desenergizadas e sua carga conta como perdida (coerente com o treino do GENCO, que evita ilhas; ilhas com geração própria ficam fora do escopo).
- **Despacho de geração:** fixo; a perda de geradores ou de carga é absorvida pela barra de referência (e, se necessário, redistribuída proporcionalmente). Sem OPF.

## 2. Objetos
**Topologia** (estado a avaliar):
```json
{ "branchOut": [12, 40], "busOut": [7] }
```
**Rede** (`GET /grid/{nome}` ou `grid.json` estático):
```json
{
  "name": "case118_ieee", "baseMVA": 100,
  "buses":    [{"id":0,"type":"PQ|PV|REF","pd":0,"qd":0,"gs":0,"bs":0,"vmin":0.94,"vmax":1.06,"x":0.32,"y":0.99}],
  "branches": [{"id":0,"from":0,"to":1,"r":0.03,"x":0.07,"b":0.02,"tap":0,"shift":0,"rateA":151,"angmin":-360,"angmax":360}],
  "gens":     [{"id":0,"bus":3,"pg":0,"pmin":0,"pmax":100,"qmin":-30,"qmax":30,"vm":1.0}]
}
```
`x`,`y` são o desenho do diagrama (gerado uma vez; o painel atual usa `kamada_kawai`).

## 3. Endpoints
### `POST /evaluate` — estado elétrico de várias topologias
Pedido:
```json
{ "grid": "case118_ieee", "solver": "ac | dc | genco | auto", "topologies": [ {"branchOut":[],"busOut":[7]} ] }
```
Resposta (um item por topologia, mesma ordem):
```json
{ "results": [ {
  "solver": "genco", "converged": true, "ms": 4.2,
  "energized": [0,1,2],  "lostBuses": [7],
  "servedMW": 3980.4, "lostMW": 261.6,
  "buses":    [{"id":0,"vm":1.01,"va":-2.1}],
  "branches": [{"id":0,"pf":120.3,"qf":10.1,"pt":-119.8,"qt":-9.7,"loading":0.82}],
  "violations": {"overload":[5,9], "voltage":[3]}
} ] }
```
`solver:"auto"` = GENCO na triagem; o backend informa em `solver` o que de fato usou.
### `POST /verify` — igual a `/evaluate` com `solver:"ac"` (confirmação exata, pandapower).
## 4. Modos da interface
| Modo | Fonte dos dados |
|---|---|
| `dc` | DC local em JavaScript (transmissão), sempre disponível |
| `backend` | Chamadas acima ao FastAPI local |
| `replay` | JSON pré-calculado (mesmos formatos de resposta) servido no GitHub Pages |

## 7. `/evaluate` em detalhe (v0.2) e decisões
- **Identificação (substitui o que está em §1 e nos exemplos):** na API as **barras são identificadas pelo número MATPOWER** (`BUS_I`) em `busOut`, `energized`, `lostBuses` e `buses[].id` (não pelo índice a partir de 0); os **ramos** seguem pelo índice da linha na tabela `branch` (a partir de 0) em `branchOut` e `branches[].id`. Assim o backend e a interface falam a mesma numeração.
- **Pedido:** `grid` (nome do caso em `/cases`) **ou** `case` (tabelas MATPOWER `{baseMVA, bus, gen, branch}`, para casos importados; o despacho é rebalanceado como na interface se diferir da carga em mais de 10%); `solver` ∈ `ac | dc | auto | genco`; até 2000 topologias por pedido.
- **Solvers:** `ac` (Newton-Raphson), `dc`; `auto` = AC por enquanto (será GENCO na triagem, Fase 5); `genco` responde **501** até a Fase 5. O campo `solver` da resposta informa o que foi usado.
- **Resposta por topologia:** `converged`, `ms`, `energized`, `lostBuses`, `servedMW`, `lostMW`, `buses[{id, vm, va}]`, `branches[{id, pf, qf, pt, qt, loading}]` (apenas ramos ativos), `gens[{id, bus, pg, qg}]` e `violations{overload, voltage, qgen}` (`overload`: ramos com carregamento > 1,0; `voltage`: barras fora de [vmin, vmax]; `qgen`: geradores fora de [qmin, qmax]; os dois últimos só no AC). Se o AC não converge, `converged:false` e `error` descrevem o motivo.
- **Erros:** 404 (caso inexistente), 422 (ramo/barra inexistente, caso inválido, falta `grid`/`case`), 413 (lotes grandes), 501 (`genco`).

## 8. Resposta corretiva (v0.3, Fase 3): `POST /corrective`
> **Mudança de escopo (2026-10-09):** em transmissão (malha, sem ramos normalmente abertos) não há espaço para manobras de restauração. `/restore`, `/plan` e `/scenario` (§3) ficam **substituídos** por `/corrective`: o operador marca falhas em **linhas e/ou barras** e o sistema propõe o **redespacho da geração** e, se ainda houver violação, o **corte mínimo de carga** (qualquer carga pode ser cortada), verificado pelo AC. Violações de tensão são apenas reportadas.

Pedido:
```json
{ "grid": "case118_ieee",
  "faults": { "branchOut": [7], "busOut": [] },
  "options": { "maxIter": 8, "margin": 0.0 } }
```
`grid` ou `case` (tabelas MATPOWER), como em `/evaluate`. `faults.busOut` usa o número MATPOWER; `faults.branchOut` o índice do ramo.

Resposta:
```json
{ "grid": "case118_ieee", "faults": {"branchOut":[7],"busOut":[]}, "needsAction": true,
  "pre": { ...resultado de /evaluate sem falhas... },
  "postFault": { ...após as falhas, com a geração redistribuída pela folga (resposta automática)... },
  "after": { ...após o plano (redespacho + corte), verificado pelo AC... },
  "plan": { "shed": [{"bus":15,"mw":90.0,"pct":1.0}], "redispatch": [{"gen":3,"bus":66,"pgBefore":38,"pgAfter":748}],
            "totalShedMW": 148.0, "totalRedispatchMW": 1078.9, "iterations": 2 },
  "summary": { "loadTotalMW": 4242, "isolatedMW": 0, "shedMW": 148.0, "servedMW": 4094, "servedPct": 0.965,
               "overloadsPost": 5, "overloadsAfter": 0, "convergedAfter": true, "ms": 210 } }
```
- Cada estado (`pre`, `postFault`, `after`) tem o mesmo formato de um item de `/evaluate`, e `violations` ganhou `pgen` (geradores fora de [Pmin, Pmax]).
- `needsAction=false` quando a resposta automática da geração já mantém os limites: o plano vem vazio e `after` = `postFault`.
- **Como o plano é calculado:** (1) AC pós-falta com o desbalanço redistribuído pela folga dos geradores; (2) se restarem sobrecargas, um problema linear (HiGHS) minimiza a carga cortada (custo 1 por MW) com um custo pequeno de redespacho (1e-3 por MW), sujeito aos limites térmicos dos ramos (sensibilidades DC aplicadas sobre os fluxos do AC, com a folga de Q) e aos limites Pmin/Pmax dos geradores; (3) o AC verifica e, se sobrar sobrecarga, os limites dos ramos violados são apertados e o problema é resolvido de novo (até `maxIter`).
- **Limites conhecidos:** o corte minimiza MW e por isso pode concentrar-se em poucas barras (100% da carga delas); não há prioridade entre cargas; violações de tensão não são corrigidas (sem controle de tensão/reativo); o redespacho não considera custos de geração; a inversão densa das sensibilidades serve para redes de até alguns milhares de barras.
- Erros: 404 (caso inexistente), 422 (ramo/barra inexistente).

## 9. Varredura N-1 (v0.4, Fase 4a): `POST /screen`
Pedido: `{ "grid": "case118_ieee", "scope": "both" }` (`grid` ou `case`; `scope` = `both` | `lines` | `buses`; a barra de referência não entra).

Resposta:
```json
{ "grid": "case118_ieee", "count": 303, "needAction": 210, "noAction": 93, "ms": 11900,
  "contingencies": [ { "type": "line", "id": 7, "label": "linha 8–5", "converged": true, "overloads": 5, "voltage": 0,
                       "maxLoadingPct": 177.0, "isolatedMW": 0.0, "needsAction": true } ] }
```
- Cada contingência é avaliada pelo AC **depois da resposta automática da geração** (redistribuição pela folga). `needsAction` = ainda há violação a corrigir (o plano completo vem de `/corrective`).
- Ordenação: as que exigem ação primeiro, por número de sobrecargas e carregamento máximo. `id` = índice do ramo (`line`) ou número MATPOWER (`bus`).
- Tempo: ~12 s para as 303 contingências do IEEE 118 (um núcleo).


## 10. Reparo e religação por blocos (v0.5, Fase 4b): `POST /recovery`
Pedido:
```json
{ "grid": "case118_ieee",
  "faults": { "branchOut": [7], "busOut": [68] },
  "repairOrder": [ {"type": "bus", "id": 68}, {"type": "line", "id": 7} ],
  "options": { "blockMW": 50, "repairHours": 2, "blockMinutes": 10 } }
```
`repairOrder` (opcional) deve ser uma permutação das falhas; o padrão é linhas e depois barras. `repairHours` e `blockMinutes` são dados de entrada **sintéticos** (só entram no cálculo da ENS).

Resposta: `{ grid, faults, repairOrder:[{type,id,label}], options, events:[...], summary }`.
- `events`: passo 0 = **plano inicial** (redespacho + corte mínimo, como em `/corrective`); depois, para cada reparo, um evento `repair` (topologia nova, ainda com a carga e o despacho do plano anterior), um `cut` se o novo plano pedir menos carga em alguma barra e os `reconnect` (blocos de até `blockMW`, escolhendo a cada passo o bloco que deixa menos sobrecargas e o menor carregamento máximo). Cada evento traz `kind`, `label`, `tHours`, `remaining` (falhas que restam), `shed` (`bus`, `mw`, `pct`), `servedMW`, `unservedMW`, `overloads`, `maxLoadingPct`, `converged`, `block` (nos `reconnect`) e `state` (estado AC completo, mesmo formato de um item de `/evaluate`).
- `summary`: `ensMWh` (integral da carga não suprida no tempo), `totalHours`, `blocks`, `blocksWithOverload`, `eventsWithOverload`, `restored` (carga toda atendida, sem sobrecarga, no fim) e `ms`.
- **Como funciona:** a cada reparo roda `plan_corrective` para as falhas que restam; a carga que o novo plano permite atender é religada em blocos. O despacho dos blocos é o do novo plano; a barra de referência absorve a diferença (redistribuí-la pelos geradores foi testado e piorou).
- **Limite conhecido:** estados intermediários (logo após um reparo e alguns blocos) podem ter sobrecarga **transitória**; só o estado de cada plano é verificado como livre de sobrecarga. `blocksWithOverload` e `eventsWithOverload` informam quantos.
- Erros: 422 (falha inexistente, `repairOrder` que não é permutação, sem falhas, barra de referência em falta), 404 (caso inexistente).
