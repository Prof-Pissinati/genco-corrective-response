# Arquitetura

Resposta corretiva a contingências em redes de transmissão, com o GENCO validado como avaliador rápido (IEEE 118).

```
Navegador (React + Vite, `interface/`)
   │  adaptador de solver (`src/solver/`)
   ├── DC local (JavaScript, sempre disponível)
   ├── backend  -> FastAPI (`backend/`): AC (Newton-Raphson), DC, resposta corretiva, varredura N-1, reparo e religação
   └── replay   -> resultados pré-calculados (arquivo único, sem backend; `npm run build:replay`)
GENCO (`models/`, `backend/tools/genco_screening.py`): validação offline nas saídas de linha (`docs/GENCO_VARREDURA.md`)
```

## O que o operador faz
1. Marca **linhas e/ou barras com defeito** no diagrama.
2. **Analisar falhas**: o sistema mostra o estado pré-falta, pós-falta e **com plano**. A geração é redistribuída pela folga e, se ainda houver sobrecarga, o plano combina redespacho e o **corte mínimo de carga** (qualquer carga; maximiza a carga atendida), verificado pelo fluxo AC. A tensão só é reportada.
3. **Varredura N-1**: todas as linhas e barras, ordenadas por severidade, com a estimativa do GENCO.
4. **Reparo e religação por blocos**: ordem dos reparos, recálculo do plano a cada reparo e religação da carga em blocos, cada bloco verificado pelo AC; energia não suprida (ENS) com tempos sintéticos.

## Decisões de projeto
- **Transmissão em malha** não tem ramos normalmente abertos (0 de 186 linhas no IEEE 118); os recursos são o redespacho e o corte de carga.
- **Despacho base** do IEEE 118: AC-OPF do PowerModels (Pg e Vm), para o caso base respeitar os limites.
- **Barra de referência** absorve o desbalanço e as perdas; só a ilha da referência é energizada.
- **Plano final sempre confirmado pelo AC**; o GENCO entra como triagem (melhora o DC, ainda fraco no limite de 100%).
- **Contrato** entre interface e backend: `docs/CONTRATO_API.md`. Trocar o avaliador (AC → GENCO) não muda o contrato.

## Onde fica cada coisa
| Pasta | Conteúdo |
|---|---|
| `interface/src/solver/` | Cliente do backend, replay, funções puras de exibição (corretiva, varredura, religação) |
| `interface/src/components/` | Diagrama, painéis (corretivo, varredura, religação), barra lateral |
| `backend/app/` | `acpf.py` (AC/DC), `evaluate.py`, `corrective.py`, `screening.py`, `recovery.py`, `main.py` (API) |
| `backend/tools/` | Exportação do caso e do replay, medição do GENCO |
| `models/case118_genco_tiny/` | Pesos do GENCO Tiny (treino reduzido) |
| `configs/`, `tools/` | Geração de dados e treino do GENCO; correções para Windows |
