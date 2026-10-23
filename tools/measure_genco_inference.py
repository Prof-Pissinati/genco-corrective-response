"""Measures the GENCO inference time on the test set, using `gridfm_graphkit evaluate` itself.

It wraps the `Trainer.predict` step of evaluate: runs a warm-up pass (discarded) and then a timed
pass. The time includes reading the scenarios from disk, assembling the batches and the model forward (it does not include the conversion
of the predictions into flows per line). It divides by the number of test scenarios (environment variable GENCO_N).

Usage (in the CPU or GPU environment, from the repository root); the arguments are those of `gridfm_graphkit evaluate`:
    GENCO_N=320 python tools/measure_genco_inference.py --config configs/train118_gpu.yaml \
      --model_path <run>/artifacts/model/best_model_state_dict.pt --normalizer_stats <run>/artifacts/stats/normalizer_stats.pt \
      --data_path data/case118 --num_workers 0 --exp_name t118 --run_name infer
"""
import json
import os
import sys
import time

import lightning as L
import torch

n = int(os.environ.get("GENCO_N", "0")) or None
orig = L.Trainer.predict


def timed_predict(self, *args, **kwargs):
    orig(self, *args, **kwargs)  # warm-up (CUDA, caches)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    out = orig(self, *args, **kwargs)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    dt = time.perf_counter() - t0
    res = {
        "accelerator": str(self.accelerator.__class__.__name__),
        "batch_size": getattr(getattr(self.datamodule, "batch_size", None), "__str__", lambda: None)(),
        "segundos_total": round(dt, 4),
        "cenarios": n,
        "ms_por_cenario": round(dt * 1000 / n, 3) if n else None,
    }
    print("[tempo_inferencia] " + json.dumps(res, ensure_ascii=False))
    return out


L.Trainer.predict = timed_predict

from gridfm_graphkit.__main__ import main  # noqa: E402

sys.argv = ["gridfm_graphkit", "evaluate", "--save_output"] + sys.argv[1:]
main()
