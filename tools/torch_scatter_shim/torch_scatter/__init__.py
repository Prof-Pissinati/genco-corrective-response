"""Minimal pure-PyTorch stand-in for the parts of `torch_scatter` used by gridfm-graphkit.

The real package has no Windows wheel for recent PyTorch builds and needs a C++ toolchain.
Only scatter_add / scatter_mean / scatter_max are used (index is 1-D, dim usually 0).
"""
import torch


def _broadcast(index, src, dim):
    if dim < 0:
        dim += src.dim()
    if index.dim() == 1:
        shape = [1] * src.dim()
        shape[dim] = -1
        index = index.view(shape)
    return index.expand_as(src), dim


def _out_shape(src, dim, dim_size, index):
    size = list(src.shape)
    size[dim] = int(index.max()) + 1 if dim_size is None and index.numel() > 0 else (dim_size or 0)
    return size


def scatter_add(src, index, dim=-1, out=None, dim_size=None):
    index, dim = _broadcast(index, src, dim)
    if out is None:
        out = torch.zeros(_out_shape(src, dim, dim_size, index), dtype=src.dtype, device=src.device)
    return out.scatter_add_(dim, index, src)


scatter_sum = scatter_add


def scatter_mean(src, index, dim=-1, out=None, dim_size=None):
    total = scatter_add(src, index, dim, out, dim_size)
    idx_b, d = _broadcast(index, src, dim)
    count = torch.zeros_like(total).scatter_add_(d, idx_b, torch.ones_like(src))
    return total / count.clamp(min=1)


def scatter_max(src, index, dim=-1, out=None, dim_size=None):
    idx_b, d = _broadcast(index, src, dim)
    size = _out_shape(src, d, dim_size, idx_b)
    fill = torch.full(size, torch.finfo(src.dtype).min if src.is_floating_point() else torch.iinfo(src.dtype).min,
                      dtype=src.dtype, device=src.device)
    res = fill.scatter_reduce(d, idx_b, src, reduce="amax", include_self=True)
    # empty segments -> 0 (torch_scatter convention)
    present = torch.zeros(size, dtype=torch.bool, device=src.device).scatter_(d, idx_b, True)
    res = torch.where(present, res, torch.zeros_like(res))
    # argmax: position of the first element equal to the segment max (torch_scatter returns src.size(dim) for empty)
    pos = torch.arange(src.size(d), device=src.device).view([-1 if i == d else 1 for i in range(src.dim())]).expand_as(src)
    hit = src == res.gather(d, idx_b)
    big = torch.full_like(pos, src.size(d))
    arg = torch.full(size, src.size(d), dtype=torch.long, device=src.device).scatter_reduce(
        d, idx_b, torch.where(hit, pos, big), reduce="amin", include_self=True)
    return res, arg
