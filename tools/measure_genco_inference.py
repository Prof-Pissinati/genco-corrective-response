"""Mede o tempo de inferência do GENCO sobre o conjunto de teste, usando o próprio `gridfm_graphkit evaluate`.

Envolve a etapa `Trainer.predict` do evaluate: roda uma passagem de aquecimento (descartada) e depois uma passagem
cronometrada. O tempo inclui ler os cenários do disco, montar os lotes e o forward do modelo (não inclui a conversão
das previsões em fluxos por linha). Divide pelo número de cenários de teste (variável de ambiente GENCO_N).

Uso (no ambiente CPU ou GPU, a partir da raiz do repositório); os argumentos são os do `gridfm_graphkit evaluate`:
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
    orig(self, *args, **kwargs)  # aquecimento (CUDA, caches)
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
