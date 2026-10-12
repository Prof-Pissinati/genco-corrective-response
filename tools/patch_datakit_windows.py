"""Corrige o gridfm-datakit 1.1.0 no Windows (idempotente).

Problema: gridfm_datakit/network.py monta codigo Julia com caminhos do Windows
(ex.: "C:\\Users\\..."). Em strings Julia, "\\U" e uma sequencia de escape invalida,
e a geracao de dados falha em `correct_network`. A correcao troca "\\" por "/".

Uso (com o venv ativado ou chamando o python do venv):
    python tools/patch_datakit_windows.py
"""
import importlib.util
import pathlib
import sys

OLD_1 = """f'data = PowerModels.parse_file("{network_path}")',"""
NEW_1 = """f'data = PowerModels.parse_file("{str(network_path).replace(chr(92), "/")}")',"""
OLD_2 = """f'PowerModels.export_matpower("{tmp_path}", data)',"""
NEW_2 = """f'PowerModels.export_matpower("{str(tmp_path).replace(chr(92), "/")}", data)',"""


def patch(path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8")
    if NEW_1 in text and NEW_2 in text:
        return "ja aplicado"
    if OLD_1 not in text or OLD_2 not in text:
        return "trecho original nao encontrado (versao diferente do datakit?)"
    path.write_text(text.replace(OLD_1, NEW_1).replace(OLD_2, NEW_2), encoding="utf-8")
    return "aplicado"


if __name__ == "__main__":
    spec = importlib.util.find_spec("gridfm_datakit")
    if spec is None or not spec.submodule_search_locations:
        sys.exit("gridfm_datakit nao esta instalado neste ambiente")
    target = pathlib.Path(list(spec.submodule_search_locations)[0]) / "network.py"
    print(f"{target}: {patch(target)}")
