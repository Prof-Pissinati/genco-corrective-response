"""Fixes gridfm-graphkit (branch genco-paper-repro) to train on GPU on Windows.

Problem: with accelerator=gpu cli.py forces DDPStrategy (made for several GPUs), which uses the NCCL backend, and
PyTorch for Windows does not ship NCCL ("Distributed package doesn't have NCCL built in"). The gloo backend also fails
here ("unsupported gloo device").
Fix: with a single GPU (devices == 1) use SingleDeviceStrategy("cuda:0") instead of DDP. Idempotent.

Usage: python tools/patch_graphkit_windows_gpu.py <path/to/gridfm-graphkit>
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
    print(f"{cli}: already applied")
elif old in src and imp_old in src:
    cli.write_text(src.replace(old, new).replace(imp_old, imp_new), encoding="utf-8")
    print(f"{cli}: applied")
else:
    sys.exit(f"{cli}: expected snippet not found (different graphkit version?)")
