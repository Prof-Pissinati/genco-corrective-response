"""Corrige o gridfm-graphkit (branch genco-paper-repro) para treinar em GPU no Windows.

Problema: com accelerator=gpu o cli.py força DDPStrategy (feita para várias GPUs), que usa o backend NCCL, e o
PyTorch para Windows não traz NCCL ("Distributed package doesn't have NCCL built in"). O backend gloo também falha
aqui ("unsupported gloo device").
Correção: com uma única GPU (devices == 1) usar SingleDeviceStrategy("cuda:0") em vez de DDP. Idempotente.

Uso: python tools/patch_graphkit_windows_gpu.py <caminho/para/gridfm-graphkit>
"""
import sys
from pathlib import Path

if len(sys.argv) != 2:
    sys.exit(__doc__)

cli = Path(sys.argv[1]) / "gridfm_graphkit" / "cli.py"
src = cli.read_text(encoding="utf-8")

old = "        _strategy = DDPStrategy(find_unused_parameters=False)"
new = (
    "        _strategy = (\n"
    '            SingleDeviceStrategy(device="cuda:0")\n'
    '            if config_args.training.devices == 1 and _accelerator in ("gpu", "cuda")\n'
    "            else DDPStrategy(find_unused_parameters=False)\n"
    "        )"
)
imp_old = "from lightning.pytorch.strategies import DDPStrategy"
imp_new = "from lightning.pytorch.strategies import DDPStrategy, SingleDeviceStrategy"

if "SingleDeviceStrategy(device" in src:
    print(f"{cli}: já aplicado")
elif old in src and imp_old in src:
    cli.write_text(src.replace(old, new).replace(imp_old, imp_new), encoding="utf-8")
    print(f"{cli}: aplicado")
else:
    sys.exit(f"{cli}: trecho esperado não encontrado (versão diferente do graphkit?)")
