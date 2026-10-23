"""Fixes gridfm-datakit 1.1.0 on Windows (idempotent).

Problem: gridfm_datakit/network.py builds Julia code with Windows paths
(e.g. "C:\\Users\\..."). In Julia strings, "\\U" is an invalid escape sequence,
and the data generation fails in `correct_network`. The fix replaces "\\" with "/".

Usage (with the venv activated or calling the venv python):
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
        return "already applied"
    if OLD_1 not in text or OLD_2 not in text:
        return "original snippet not found (different datakit version?)"
    path.write_text(text.replace(OLD_1, NEW_1).replace(OLD_2, NEW_2), encoding="utf-8")
    return "applied"


if __name__ == "__main__":
    spec = importlib.util.find_spec("gridfm_datakit")
    if spec is None or not spec.submodule_search_locations:
        sys.exit("gridfm_datakit is not installed in this environment")
    target = pathlib.Path(list(spec.submodule_search_locations)[0]) / "network.py"
    print(f"{target}: {patch(target)}")
