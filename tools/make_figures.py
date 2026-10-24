"""Generates the contest deliverables that come straight from the repository data (nothing typed by hand).

Outputs, in entrega/ (not versioned):
  T1_numbers.md          every number quoted in the post, with the file it comes from
  F1_overview.png/.svg   pipeline diagram
  F5_accuracy.png/.svg   GENCO vs DC loading error per network (IEEE 14 -> GOC 10,000)
  F6_verifier.png/.svg   GENCO as plan verifier, IEEE 118
  F7_voltage.png/.svg    voltage setter, IEEE 118 replay

Run with an environment that has matplotlib:  python tools/make_figures.py
"""
import json
import pathlib

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "interface" / "src" / "data"
ESCALA = ROOT / "docs" / "escala"
OUT = ROOT / "entrega"
OUT.mkdir(exist_ok=True)
PUBLIC = ROOT / "docs" / "figures"            # versioned copy of the final figures (PNG), so the jury can see them in the repository
PUBLIC.mkdir(exist_ok=True)

# validated with the dataviz palette script (light mode): blue / orange / aqua, adjacent CVD dE >= 9
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#8a8985"
GRID = "#e6e5e1"
GENCO = "#2a78d6"
DC = "#eb6834"
AC = "#1baf7a"

plt.rcParams.update({
    "font.family": ["Segoe UI", "DejaVu Sans"],
    "font.size": 11,
    "axes.edgecolor": GRID,
    "axes.labelcolor": INK2,
    "axes.titlecolor": INK,
    "xtick.color": INK2,
    "ytick.color": INK2,
    "text.color": INK,
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(fig, name):
    fig.savefig(OUT / f"{name}.png", dpi=200)
    if name[:2] in ("F1", "F5", "F6", "F7") and not name.startswith("F10"):   # vector versions only for the pure plots (the composites embed screenshots)
        fig.savefig(OUT / f"{name}.svg")
    fig.savefig(PUBLIC / f"{name}.png", dpi=200)
    plt.close(fig)
    print("ok", name)


def style_axes(ax, grid_axis="y"):
    ax.grid(axis=grid_axis, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.tick_params(length=0)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)


# ---------------------------------------------------------------- data
IEEE = ["14", "30", "57", "118"]
screen = {c: load(DATA / f"screening_case{c}_ieee_autores.json") for c in IEEE}
verif = {c: load(DATA / f"verificacao_planos_case{c}_ieee_autores.json") for c in IEEE}
scale = {n: load(ESCALA / f"{n}.json") for n in
         ["case14_ieee", "case30_ieee", "case57_ieee", "case118_ieee", "case500_goc", "case2000_goc", "case10000_goc"]}
replay = load(DATA / "replay_case118_ieee.json")
tens = load(ESCALA / "tensao_genco_opf_case118_ieee.json")["resumo"]

# ---------------------------------------------------------------- F5
def fig_accuracy():
    # IEEE: every non-islanding single-line outage (screening files); GOC: sampled scenarios (docs/escala)
    pts = []
    for c in IEEE:
        s = screen[c]
        pts.append((int(c), s["loadingMAE_pct"]["genco"], s["loadingMAE_pct"]["dc"], "IEEE " + c))
    for n in ("case500_goc", "case2000_goc", "case10000_goc"):
        e = scale[n]
        pts.append((e["barras"], e["erro"]["genco"]["maePct"], e["erro"]["dc"]["maePct"], f"GOC {e['barras']:,}"))
    x = list(range(len(pts)))
    fig, ax = plt.subplots(figsize=(9.6, 5.4))
    ax.plot(x, [p[2] for p in pts], color=DC, lw=2, marker="o", ms=8, mec=SURFACE, mew=2, label="DC approximation")
    ax.plot(x, [p[1] for p in pts], color=GENCO, lw=2, marker="o", ms=8, mec=SURFACE, mew=2, label="GENCO (authors' Tiny checkpoint)")
    ax.set_yscale("log")
    ax.set_ylim(0.002, 14)
    ax.set_xticks(x)
    ax.set_xticklabels([p[3] for p in pts])
    ax.set_ylabel("Mean error of line loading vs AC (% points, log scale)")
    ax.set_yticks([0.01, 0.1, 1])
    ax.set_yticklabels(["0.01", "0.1", "1"])
    style_axes(ax)
    for i, p in enumerate(pts):
        ax.annotate(f"{p[1]:.2f}" if p[1] >= 1 else f"{p[1]:.3f}", (i, p[1]), textcoords="offset points", xytext=(0, -16), ha="center", fontsize=9.5, color=INK2)
        ax.annotate(f"{p[2]:.2f}", (i, p[2]), textcoords="offset points", xytext=(0, 10), ha="center", fontsize=9.5, color=INK2)
    ax.axvline(3.5, color=GRID, lw=1.2, ls=(0, (4, 4)))
    ax.text(3.6, 0.02, "GOC networks: GENCO is\nno better than DC", fontsize=10, color=INK2, va="bottom", linespacing=1.3)
    ax.legend(frameon=False, loc="lower right", bbox_to_anchor=(1.0, 0.1), ncol=1)
    ax.set_title("Where GENCO is accurate, and where it stops being", loc="left", fontsize=14, fontweight="bold", pad=24)
    fig.text(0.0, 0.0, "", fontsize=1)
    fig.text(0.075, 0.015, "IEEE: every single-line outage that does not island the grid (AC reference). GOC: random single-line scenarios (60 / 30 / 12). "
             "Sources: screening_*_autores.json, docs/escala/*.json.", fontsize=8, color=MUTED)
    fig.subplots_adjust(left=0.09, right=0.98, top=0.86, bottom=0.14)
    save(fig, "F5_accuracy")


# ---------------------------------------------------------------- F6
def fig_verifier():
    v = verif["118"]
    sg = v["seguranca"]
    n_ins = sg["insuficientes"]
    bars = [("DC\n(threshold 100%)", sg["dc"]["aprovadasPorEngano100"], DC),
            ("GENCO\n(threshold 100%)", sg["genco"]["aprovadasPorEngano100"], GENCO),
            ("GENCO\n(threshold 99%)", 0, GENCO)]
    # approval of sufficient plans at the safe threshold
    margins = [0, 3, 5, 8, 10]
    g = [sg["genco"]["aprovadosNoLimiarSeguro"][f"folga{m}"] for m in margins]
    d = [sg["dc"]["aprovadosNoLimiarSeguro"][f"folga{m}"] for m in margins]
    shed = {f["folgaPct"]: f["corteTotalMW"] for f in v["folgas"]}

    fig, (a, b) = plt.subplots(1, 2, figsize=(11.2, 5.2), gridspec_kw={"width_ratios": [1, 1.25], "wspace": 0.28})
    xs = range(len(bars))
    a.bar(xs, [t[1] for t in bars], color=[t[2] for t in bars], width=0.55)
    for i, t in enumerate(bars):
        a.text(i, t[1] + 3, str(t[1]), ha="center", fontsize=12, fontweight="bold", color=INK)
    a.set_xticks(list(xs))
    a.set_xticklabels([t[0] for t in bars], fontsize=10)
    a.set_ylim(0, 140)
    a.set_ylabel(f"Insufficient plans approved by mistake (of {n_ins})")
    a.set_title("Does it let a bad plan through?", loc="left", fontsize=12.5, fontweight="bold")
    style_axes(a)

    b.plot(margins, d, color=DC, lw=2, marker="o", ms=8, mec=SURFACE, mew=2, label="DC (95% threshold)")
    b.plot(margins, g, color=GENCO, lw=2, marker="o", ms=8, mec=SURFACE, mew=2, label="GENCO (99% threshold)")
    b.set_xticks(margins)
    b.set_xticklabels([f"{m}" for m in margins])
    b.set_xlabel("Safety margin used when building the plan (% points below the limit)")
    b.set_ylabel("Sufficient plans approved (of 89)")
    b.set_ylim(-14, 96)
    b.set_yticks([0, 20, 40, 60, 80])
    for m, gg, dd in zip(margins, g, d):
        b.annotate(str(gg), (m, gg), textcoords="offset points", xytext=(0, 9), ha="center", fontsize=9.5, color=INK2)
        if dd != gg:
            b.annotate(str(dd), (m, dd), textcoords="offset points", xytext=(0, -16), ha="center", fontsize=9.5, color=INK2)
    b.text(3, 55, f"3-point margin costs {shed[3]:.0f} MW of shedding\n(vs {shed[0]:.0f} MW at 0)", fontsize=9, color=INK2, ha="left", va="center")
    b.legend(frameon=False, loc="lower left", bbox_to_anchor=(0.3, 0.12))
    b.set_title("Does it approve the good ones?", loc="left", fontsize=12.5, fontweight="bold")
    style_axes(b)
    fig.suptitle("GENCO as plan verifier on IEEE 118: a safer filter than DC", x=0.07, ha="left", fontsize=14.5, fontweight="bold", y=0.98)
    fig.text(0.07, 0.01, "89 single-line outages, 623 states (no plan, partial plan and plans with a 0-10 point margin); AC is the ground truth. "
             "Source: verificacao_planos_case118_ieee_autores.json.", fontsize=8, color=MUTED)
    fig.subplots_adjust(left=0.075, right=0.985, top=0.83, bottom=0.2)
    save(fig, "F6_verifier")


# ---------------------------------------------------------------- F7
LABELS = {(c["type"], c["id"]): c["label"] for c in replay["screen"]["contingencies"]}


def label_of(key):
    # 'c:7|68' = line 7 + bus 68 ; 'c:7|' = line 7 ; 'c:|5' = bus 5  (ids as in the API)
    lines, buses = key[2:].split("|")
    parts = []
    if lines:
        parts.append(LABELS.get(("line", int(lines)), f"line #{lines}"))
    if buses:
        parts.append(LABELS.get(("bus", int(buses)), f"bus {buses}"))
    return " + ".join(parts)


def fig_voltage():
    rows = []
    for k, v in replay["corrective"].items():
        vv = v.get("voltage")
        if vv:
            rows.append((k, vv))
    rows.sort(key=lambda r: (-r[1]["violationsBefore"], -r[1]["maxExcessBeforePu"]))
    n = len(rows)
    y = list(range(n))[::-1]
    fig, (a, b) = plt.subplots(1, 2, figsize=(11.6, 5.8), gridspec_kw={"wspace": 0.12})
    for yi, (k, vv) in zip(y, rows):
        a.plot([0, vv["violationsBefore"]], [yi, yi], color=GRID, lw=3, solid_capstyle="round", zorder=1)
        a.scatter(vv["violationsBefore"], yi, s=70, color=DC, zorder=3, edgecolor=SURFACE, linewidth=1.5)
        a.scatter(vv["violationsAfter"], yi, s=70, color=GENCO, zorder=3, edgecolor=SURFACE, linewidth=1.5)
        # shed (right panel)
        b.plot([vv["shedBeforeMW"], vv["shedAfterMW"]], [yi, yi], color=GRID, lw=3, solid_capstyle="round", zorder=1)
        b.scatter(vv["shedBeforeMW"], yi, s=70, color=DC, zorder=3, edgecolor=SURFACE, linewidth=1.5)
        b.scatter(vv["shedAfterMW"], yi, s=70, color=GENCO, zorder=3, edgecolor=SURFACE, linewidth=1.5)
    a.set_yticks(y)
    a.set_yticklabels([label_of(k) for k, _ in rows], fontsize=9.5)
    b.set_yticks(y)
    b.set_yticklabels([])
    a.set_xlim(-0.3, 3.4)
    a.set_xticks([0, 1, 2])
    a.set_xlabel("Buses out of the voltage band")
    b.set_xlabel("Load shed by the plan (MW)")
    a.set_title("Voltage violations", loc="left", fontsize=12.5, fontweight="bold")
    b.set_title("Cost: load shedding", loc="left", fontsize=12.5, fontweight="bold")
    for ax in (a, b):
        style_axes(ax, "x")
        ax.set_ylim(-0.7, n - 0.3)
    sb = sum(v["shedBeforeMW"] for _, v in rows)
    sa = sum(v["shedAfterMW"] for _, v in rows)
    vb = sum(v["violationsBefore"] for _, v in rows)
    va = sum(v["violationsAfter"] for _, v in rows)
    a.scatter([], [], s=70, color=DC, label="Plan from the LP")
    a.scatter([], [], s=70, color=GENCO, label="After GENCO-OPF sets the voltages")
    a.legend(frameon=False, loc="center right", fontsize=9.5)
    fig.suptitle(f"GENCO-OPF as voltage setter, IEEE 118: {vb} violations in {n} plans → {va}", x=0.06, ha="left", fontsize=14.5, fontweight="bold", y=0.98)
    fig.text(0.06, 0.012, f"Total shedding {sb:.1f} → {sa:.1f} MW (a few plans shed a little more). Every result is confirmed by the AC power flow; no new overload. "
             f"Source: replay_case118_ieee.json (voltage block).", fontsize=8, color=MUTED)
    fig.subplots_adjust(left=0.13, right=0.985, top=0.86, bottom=0.14)
    save(fig, "F7_voltage")
    return n, vb, va, sb, sa


# ---------------------------------------------------------------- F1
def box(ax, xy, w, h, title, sub, color, text_color=INK):
    x, yv = xy
    p = FancyBboxPatch((x, yv), w, h, boxstyle="round,pad=0.0,rounding_size=0.12", fc=SURFACE, ec=color, lw=2.2)
    ax.add_patch(p)
    ax.text(x + w / 2, yv + h * 0.66, title, ha="center", va="center", fontsize=11.5, fontweight="bold", color=text_color)
    ax.text(x + w / 2, yv + h * 0.28, sub, ha="center", va="center", fontsize=8.8, color=INK2, linespacing=1.3)


def arrow(ax, p, q, color=INK2):
    ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=14, lw=1.8, color=color, shrinkA=0, shrinkB=0))


def fig_overview():
    fig, ax = plt.subplots(figsize=(11.6, 5.4))
    ax.set_xlim(-0.1, 12)
    ax.set_ylim(0, 5.6)
    ax.axis("off")
    ax.text(0, 5.35, "From fault to plan", fontsize=15, fontweight="bold", va="top")
    ax.text(0, 4.95, "GENCO screens, verifies and sets voltages; the AC power flow always has the last word.", fontsize=10, color=INK2, va="top")
    w, h = 2.05, 1.15
    # row 1: pipeline
    ys = 2.95
    xs = [0.0, 2.45, 4.9, 7.35, 9.8]
    box(ax, (xs[0], ys), w, h, "1  Operator marks", "the fault on the diagram\n(line or bus)", INK2)
    box(ax, (xs[1], ys), w, h, "2  GENCO screens", "ranks the N-1 sweep: which\noutages need action", GENCO)
    box(ax, (xs[2], ys), w, h, "3  Corrective LP", "redispatch + minimum\nload shedding (HiGHS)", INK2)
    box(ax, (xs[3], ys), w, h, "4  GENCO verifies", "approves or rejects the plan\nbefore the exact solver", GENCO)
    box(ax, (xs[4], ys), w, h, "5  GENCO-OPF", "sets the generator voltages\n(IEEE 118)", GENCO)
    for i in range(4):
        arrow(ax, (xs[i] + w + 0.04, ys + h / 2), (xs[i + 1] - 0.04, ys + h / 2))
    # AC bar
    ax.add_patch(FancyBboxPatch((-0.05, 1.15), 11.9, 0.8, boxstyle="round,pad=0.0,rounding_size=0.12", fc=SURFACE, ec=AC, lw=2.2))
    ax.text(5.92, 1.68, "AC power flow (own Newton-Raphson): confirms every plan, overload and voltage", ha="center", va="center", fontsize=11.5, fontweight="bold")
    ax.text(5.92, 1.35, "if it disagrees, the plan is rebuilt; GENCO never replaces it", ha="center", va="center", fontsize=9, color=INK2)
    for x in (xs[1] + w / 2, xs[3] + w / 2, xs[4] + w / 2):
        arrow(ax, (x, ys - 0.04), (x, 1.99), color=AC)
    # outputs
    ax.text(0, 0.62, "Result", fontsize=10, fontweight="bold", color=INK2)
    ax.text(0.9, 0.62, "redispatch + load shed per bus, line loadings and voltages, repair order with block-by-block reconnection (ENS in MWh)", fontsize=9.5, color=INK2)
    ax.text(0, 0.2, "Views in the interface: DC | AC | GENCO, with the GENCO error against the AC shown on screen. In the static demo the GENCO results are precomputed.", fontsize=9.5, color=INK2)
    fig.subplots_adjust(left=0.03, right=0.99, top=0.99, bottom=0.01)
    save(fig, "F1_overview")


# ---------------------------------------------------------------- screenshots (raw_*.png come from tools/captura/*.mjs)
def raw(name):
    f = OUT / f"raw_{name}.png"
    return plt.imread(f) if f.exists() else None


def mark_line(ax, label="line 8–5"):
    """Rings the faulted line (coordinates saved by the capture script, in CSS pixels of the clip; screenshots are 1:1)."""
    f = OUT / "raw_F2_coords.json"
    if not f.exists():
        return
    c = load(f)
    x, y = c["mid"]
    r = 0.9 * abs(c["bus5"][1] - c["bus8"][1])          # about the length of the line
    ax.add_patch(plt.Circle((x, y), r, fill=False, ec="#ffd400", lw=3.2, zorder=5))
    ax.annotate(label, (x + r, y - 0.2 * r), xytext=(x + 6.5 * r, y - 1.7 * r), fontsize=13, fontweight="bold", color="#111", zorder=6,
                bbox=dict(boxstyle="round,pad=0.35", fc="#ffd400", ec="none"), arrowprops=dict(arrowstyle="-|>", color="#ffd400", lw=2.4), ha="center", va="center")


def put(ax, img, title, sub=None):
    ax.imshow(img)
    ax.axis("off")
    ax.set_title(title, loc="left", fontsize=12.5, fontweight="bold", pad=18 if sub else 6)
    if sub:
        ax.text(0, 1.012, sub, transform=ax.transAxes, fontsize=9.5, color=INK2, va="bottom")


def compare_views(sc, name, outage, label):
    """AC and GENCO views of the same state (screenshots) and the 185 in-service line loadings against each other."""
    ac, gc = raw(f"F9_{sc}_ac"), raw(f"F9_{sc}_genco")
    chip_file = OUT / f"raw_F9_{sc}_chip.txt"
    if ac is None or gc is None or not chip_file.exists():
        return
    import numpy as np
    chip = chip_file.read_text(encoding="utf-8")
    g = load(DATA / "genco_lines_case118_ieee.json")["outages"][outage]
    keep = np.arange(len(g["ac"])) != int(outage)          # the outaged line is not counted (loading 0 in both)
    x, y = np.array(g["ac"], float)[keep], np.array(g["genco"], float)[keep]
    n_ac, n_ge = int((x > 100.01).sum()), int((y > 100.01).sum())
    err = chip.split(" · ", 1)[1].split(" · reference")[0] if " · " in chip else ""
    over = lambda n, m: f"{n} lines above their limit (red), max {m:.0f}%" if n else f"no line above its limit, max {m:.0f}%"
    fig = plt.figure(figsize=(19, 7.4))
    gs = fig.add_gridspec(1, 3, width_ratios=[1, 1, 0.62], wspace=0.04)
    a0, a1, a2 = fig.add_subplot(gs[0]), fig.add_subplot(gs[1]), fig.add_subplot(gs[2])
    put(a0, ac, "AC power flow (reference)", f"{label} out, base dispatch, no redispatch: {over(n_ac, x.max())}")
    put(a1, gc, "GENCO estimate, same state", f"{over(n_ge, y.max())}; {err}")
    lim = max(x.max(), y.max()) * 1.05
    a2.plot([0, lim], [0, lim], color=GRID, lw=2, zorder=1)
    a2.scatter(x, y, s=22, color=GENCO, edgecolor=SURFACE, linewidth=0.6, zorder=3)
    a2.axvline(100, color=MUTED, lw=1, ls=(0, (4, 4)), zorder=2)
    a2.axhline(100, color=MUTED, lw=1, ls=(0, (4, 4)), zorder=2)
    a2.set_xlim(0, lim)
    a2.set_ylim(0, lim)
    a2.set_aspect("equal")
    a2.set_xlabel("Line loading, AC (%)")
    a2.set_ylabel("Line loading, GENCO (%)")
    a2.set_title("185 lines in service, one state", loc="left", fontsize=12.5, fontweight="bold", pad=18)
    a2.text(0, 1.012, "each dot is a line; on the diagonal = same as AC", transform=a2.transAxes, fontsize=9.5, color=INK2, va="bottom")
    style_axes(a2, "both")
    fig.subplots_adjust(left=0.01, right=0.985, top=0.88, bottom=0.12)
    fig.text(0.012, 0.05, "Colors: blue to orange as the loading goes up to the line limit (100%); red only above it (overload, with a 0.01% tolerance). Dashed lines in the plot mark 100%.", fontsize=9.5, color=INK2)
    save(fig, name)


def compose_screens():
    r = replay["corrective"]["c:7|"]
    sm, pl = r["summary"], r["plan"]
    imgs = [raw("F2_a_pre"), raw("F2_b_post"), raw("F2_c_plan")]
    if all(i is not None for i in imgs):
        fig, axs = plt.subplots(1, 3, figsize=(18, 6.4))
        put(axs[0], imgs[0], "1  Intact network", "IEEE 118, AC power flow")
        put(axs[1], imgs[1], "2  Line 8–5 trips", f"{sm['overloadsPost']} lines overloaded (red)")
        for a_ in axs:
            mark_line(a_)
        put(axs[2], imgs[2], "3  Plan applied", f"redispatch {pl['totalRedispatchMW']:.0f} MW + shed {sm['shedMW']:.1f} MW ({(1 - sm['servedPct']) * 100:.1f}% of the load), no overload, AC-confirmed")
        fig.subplots_adjust(left=0.01, right=0.99, top=0.88, bottom=0.07, wspace=0.03)
        for x, color, text in ((0.30, "#d90000", "red: overloaded line (above its limit)"), (0.46, "#9b4dca", "purple: redispatched generator"), (0.66, "none", "dashed: load shed at that bus")):
            fig.patches.append(plt.Rectangle((x - 0.012, 0.022), 0.009, 0.022, transform=fig.transFigure, fc=color, ec="#0079ff" if color == "none" else color, lw=1.6, ls="--" if color == "none" else "-"))
            fig.text(x, 0.033, text, fontsize=10.5, color=INK2, va="center")
        save(fig, "F2_states")
    panel, plan_img = raw("F3_panel"), raw("F3_diagram")
    if panel is not None and plan_img is not None:
        fig, axs = plt.subplots(1, 2, figsize=(14.5, 9), gridspec_kw={"width_ratios": [0.38, 1.0]})
        put(axs[0], panel, "Corrective response panel", "what the operator reads")
        put(axs[1], plan_img, "The same plan on the diagram", "purple = redispatched generators, dashed = load shed")
        fig.subplots_adjust(left=0.01, right=0.99, top=0.9, bottom=0.01, wspace=0.03)
        save(fig, "F3_corrective_panel")
    a, b = raw("F4_list"), raw("F4_genco")
    if a is not None and b is not None:
        fig, axs = plt.subplots(1, 2, figsize=(12, 7.2))
        put(axs[0], a, "N-1 sweep: every line and bus", f"{replay['screen']['count']} contingencies, {replay['screen']['needAction']} need a plan; click a row to apply it")
        put(axs[1], b, "How far to trust GENCO", "the numbers the interface shows about the checkpoint")
        fig.subplots_adjust(left=0.01, right=0.99, top=0.88, bottom=0.01, wspace=0.04)
        save(fig, "F4_screening")
    img = raw("F8_recovery")
    if img is not None:
        rec = replay["recovery"]["r:line7"]["summary"]
        fig, ax = plt.subplots(figsize=(15, 9.1))
        put(ax, img, "Repair order and block-by-block reconnection", f"line 8–5 repaired; restored in {rec['totalHours']:.2f} h, ENS {rec['ensMWh']:.0f} MWh, {rec['blocks']} blocks reconnected (step 4 of 7 shown)")
        fig.subplots_adjust(left=0.01, right=0.99, top=0.92, bottom=0.01)
        save(fig, "F8_recovery")
    lay = [raw("F10_full"), raw("F10_mini"), raw("F10_hidden"), raw("F10_directory")]
    if all(i is not None for i in lay):
        fig, axs = plt.subplots(2, 2, figsize=(16, 9.6))
        titles = (("Left menu: full", "every control and the state summary"),
                  ("Left menu: compact", "icons only, more room for the diagram"),
                  ("Left menu: hidden", "diagram and panels only"),
                  ("Right menu: element directory open", "every bus and line, with search; it opens and closes with the arrow"))
        for ax, img, (t, sub) in zip(axs.ravel(), lay, titles):
            put(ax, img, t, sub)
        fig.subplots_adjust(left=0.01, right=0.99, top=0.93, bottom=0.01, wspace=0.03, hspace=0.16)
        save(fig, "F10_layouts")
    compare_views("typical", "F9_ac_vs_genco", "117", "line 76–77")
    compare_views("overload", "F9b_ac_vs_genco_overload", "7", "line 8–5")


# ---------------------------------------------------------------- T1
def table_numbers(volt):
    n, vb, va, sb, sa = volt
    s118 = screen["118"]
    v118 = verif["118"]
    sg = v118["seguranca"]
    e118 = scale["case118_ieee"]
    e10k = scale["case10000_goc"]
    fol = {f["folgaPct"]: f for f in v118["folgas"]}
    rec = replay["recovery"]
    lines = []

    def row(what, val, src):
        lines.append(f"| {what} | {val} | `{src}` |")

    lines += ["# T1 - Numbers quoted in the post, with the source of each value", "",
              "Generated by `tools/make_figures.py` from the files in the repository (do not edit by hand).", "",
              "| What | Value | Source |", "|---|---|---|"]
    for c in IEEE:
        s = screen[c]
        row(f"IEEE {c}: mean loading error vs AC, GENCO / DC (% points)", f"{s['loadingMAE_pct']['genco']:.3f} / {s['loadingMAE_pct']['dc']:.3f}",
            f"interface/src/data/screening_case{c}_ieee_autores.json  loadingMAE_pct")
    row("IEEE 118: scenarios evaluated (single-line outages)", s118["scenarios"], "screening_case118_ieee_autores.json  scenarios")
    row("IEEE 118: lines loaded >= 100% found, GENCO / DC", f"{s118['lineLevel']['genco']['1.0']['recall']*100:.0f}% / {s118['lineLevel']['dc']['1.0']['recall']*100:.0f}%", "screening_case118_ieee_autores.json  lineLevel.*.1.0.recall")
    row("IEEE 118: lines loaded >= 90% found, GENCO / DC", f"{s118['lineLevel']['genco']['0.9']['recall']*100:.1f}% / {s118['lineLevel']['dc']['0.9']['recall']*100:.0f}%", "screening_case118_ieee_autores.json  lineLevel.*.0.9.recall")
    row("IEEE 118 verifier: states / outages evaluated", f"{v118['estados']} / {v118['contingencias']}", "verificacao_planos_case118_ieee_autores.json  estados, contingencias")
    row("IEEE 118 verifier: insufficient plans (AC overload)", sg["insuficientes"], "verificacao_planos_case118_ieee_autores.json  seguranca.insuficientes")
    row("  approved by mistake at 100% threshold, DC / GENCO", f"{sg['dc']['aprovadasPorEngano100']} / {sg['genco']['aprovadasPorEngano100']}", "...  seguranca.*.aprovadasPorEngano100")
    row("  approved by mistake at 99% threshold, GENCO", "0 (upper bound 1.7% at 95% confidence, rule of three)", "...  seguranca.regraDeTres95; docs/GENCO_VERIFICACAO.md")
    row("  sufficient plans approved with a 3-point margin, GENCO / DC (of 89)", f"{sg['genco']['aprovadosNoLimiarSeguro']['folga3']} / {sg['dc']['aprovadosNoLimiarSeguro']['folga3']}", "...  seguranca.*.aprovadosNoLimiarSeguro.folga3")
    row("  3-point margin: total shed / mean redispatch", f"{fol[3]['corteTotalMW']:.0f} MW / {fol[3]['redespachoMedioMW']:.0f} MW", "...  folgas[folgaPct=3]")
    row("Voltage setter (replay, IEEE 118): plans with voltage out of band", n, "interface/src/data/replay_case118_ieee.json  corrective.*.voltage")
    row("  violations before -> after", f"{vb} -> {va}", "same, violationsBefore/After")
    row("  load shed before -> after (those plans)", f"{sb:.1f} -> {sa:.1f} MW", "same, shedBeforeMW/AfterMW")
    lg = tens["laco"]
    row("Voltage setter (larger test, 43 outages): voltage solved / no overload", f"{lg['tensaoResolvida']} of {lg['casos']} / {lg['semSobrecarga']} of {lg['casos']}", "docs/escala/tensao_genco_opf_case118_ieee.json  resumo.laco")
    row("  mean loops; shed before -> after", f"{lg['voltasMedias']}; {lg['corteTotalMW'][0]} -> {lg['corteTotalMW'][1]} MW", "same, voltasMedias, corteTotalMW")
    row("Scale IEEE 118 (CPU, per scenario): AC / DC / GENCO", f"{e118['msPorCenario']['acNosso']} / {e118['msPorCenario']['dc']} / {e118['msPorCenario']['gencoTotal']} ms", "docs/escala/case118_ieee.json  msPorCenario")
    row("Scale GOC 10,000 (CPU): AC / DC / GENCO", f"{e10k['msPorCenario']['acNosso']} / {e10k['msPorCenario']['dc']} / {e10k['msPorCenario']['gencoTotal']} ms", "docs/escala/case10000_goc.json  msPorCenario")
    row("Scale GOC 10,000: mean error GENCO / DC (% points)", f"{e10k['erro']['genco']['maePct']} / {e10k['erro']['dc']['maePct']}", "docs/escala/case10000_goc.json  erro")
    row("Replay IEEE 118: N-1 sweep contingencies / need action", f"{replay['screen']['count']} / {replay['screen']['needAction']}", "replay_case118_ieee.json  screen")
    row("Replay IEEE 118: precomputed corrective responses / repair sequences", f"{len(replay['corrective'])} / {len(rec)}", "replay_case118_ieee.json  corrective, recovery")
    import numpy as np
    gl = load(DATA / "genco_lines_case118_ieee.json")["outages"]
    def in_service(k, o):          # the interface leaves the outaged line out of the error (its loading is 0 in both)
        keep = np.arange(len(o["ac"])) != int(k)
        return np.array(o["ac"], float)[keep], np.array(o["genco"], float)[keep]
    errs = [float(np.abs(np.subtract(*in_service(k, o))).mean()) for k, o in gl.items()]
    for oid, lab in (("117", "line 76-77 out (no overload)"), ("7", "line 8-5 out (overload)")):
        x, y = in_service(oid, gl[oid])
        row(f"F9, IEEE 118, {lab}: mean / max loading error GENCO vs AC (pt); lines above the limit AC / GENCO", f"{np.abs(x - y).mean():.2f} / {np.abs(x - y).max():.1f}; {int((x > 100.01).sum())} / {int((y > 100.01).sum())}", "interface/src/data/genco_lines_case118_ieee.json  outages[" + oid + "]")
    vf = load(ROOT / "docs" / "escala" / "verificador_fora_da_amostra_case118_ieee.json")["steps"]
    src_vf = "docs/escala/verificador_fora_da_amostra_case118_ieee.json"
    row("Verifier threshold on held-out contingencies (integer steps), leave one out: insufficient plans approved by mistake, GENCO / DC", f"{vf['integer']['genco']['leaveOneOut']['wrongApprovalsTotal']} / {vf['integer']['dc']['leaveOneOut']['wrongApprovalsTotal']} of {vf['integer']['genco']['leaveOneOut']['insufficientTested']}", src_vf)
    row("  chosen on a random half, tested on the other (2,000 splits): wrong approvals, GENCO / DC", f"{vf['integer']['genco']['half']['wrongApprovalsTotal']} of {vf['integer']['genco']['half']['insufficientTested']:,} / {vf['integer']['dc']['half']['wrongApprovalsTotal']} of {vf['integer']['dc']['half']['insufficientTested']:,}", src_vf)
    row("  threshold tuned to the tenth of a point: wrong approval rate, GENCO; splits with a mistake", f"{vf['tenth']['genco']['half']['wrongApprovalRatePct']}%; {vf['tenth']['genco']['half']['shareOfSplitsWithWrongApproval']*100:.0f}%", src_vf)
    row("  same with one extra point of safety: wrong approvals, GENCO / DC", f"{vf['tenth']['genco']['halfMinusOnePoint']['wrongApprovalsTotal']} / {vf['tenth']['dc']['halfMinusOnePoint']['wrongApprovalsTotal']}", src_vf)
    on = load(ROOT / "docs" / "escala" / "verificador_fora_da_amostra_case118_ieee.json")["otherNetworks"]
    for c in ("30", "57"):
        row(f"Thresholds fixed on the IEEE 118 applied to the IEEE {c} (authors' checkpoint): insufficient plans / approved by mistake GENCO at 99% / DC at 95%", f"{on[c]['genco']['insufficientPlans']} / {on[c]['genco']['approvedByMistakeAtFrozenThreshold']} / {on[c]['dc']['approvedByMistakeAtFrozenThreshold']}", src_vf)
    row("  cost of the extra point: 3-point-margin plans approved, GENCO (leave one out, integer steps)", f"{vf['integer']['genco']['leaveOneOut']['safeApprovedPct']['folga3']}% -> {vf['integer']['genco']['leaveOneOutMinusOnePoint']['safeApprovedPct']['folga3']}%", src_vf)
    nw = load(ROOT / "docs" / "escala" / "newton_um_passo_case118_ieee.json")["methods"]
    nv_all = load(ROOT / "docs" / "escala" / "newton_verificador_case118_ieee.json")
    nv = nv_all["methods"]
    src_n1 = "docs/escala/newton_um_passo_case118_ieee.json"
    src_nv = "docs/escala/newton_verificador_case118_ieee.json"
    row("Classical baseline, IEEE 118 screening (177 outages), mean loading error: Newton 1 step / 2 steps / GENCO / DC (pt)", f"{nw['newton_1_step']['maePct']} / {nw['newton_2_step']['maePct']} / {nw['genco_authors']['maePct']} / {nw['dc']['maePct']}", src_n1)
    row("  lines at 100% or more found: Newton 1 step / 2 steps / GENCO / DC", f"{nw['newton_1_step']['recall100']}% / {nw['newton_2_step']['recall100']}% / {nw['genco_authors']['recall100']}% / {nw['dc']['recall100']}%", src_n1)
    row("  time per scenario on CPU: Newton 1 step / 2 steps", f"{nw['newton_1_step']['msPerScenario']} / {nw['newton_2_step']['msPerScenario']} ms", src_n1)
    row("Classical baseline as plan verifier: insufficient plans approved by mistake at 100%, Newton 1 step / 2 steps", f"{nv['newton_1_step']['approvedByMistakeAt100']} / {nv['newton_2_step']['approvedByMistakeAt100']} of {nv_all['insufficientPlans']}", src_nv)
    row("  highest threshold with no mistake; 3-point-margin plans approved: Newton 1 step", f"{nv['newton_1_step']['highestThresholdWithNoMistake']}%; {nv['newton_1_step']['safePlansApprovedAtThatThreshold']['folga3']} of 89", src_nv)
    row("  highest threshold with no mistake; 3-point-margin plans approved: Newton 2 steps", f"{nv['newton_2_step']['highestThresholdWithNoMistake']}%; {nv['newton_2_step']['safePlansApprovedAtThatThreshold']['folga3']} of 89", src_nv)
    rs = replay["recovery"]["r:line7"]["summary"]
    row("Replay IEEE 118, line 8-5 repaired: time to restore / energy not supplied / blocks reconnected", f"{rs['totalHours']:.2f} h / {rs['ensMWh']:.0f} MWh / {rs['blocks']}", "replay_case118_ieee.json  recovery[r:line7].summary")
    sc = screen["118"]["msPerScenario"]
    row("IEEE 118 screening, CPU per scenario: GENCO / AC / DC", f"{sc['genco_cpu_este_pc']:.1f} / {sc['ac_backend']:.1f} / {sc['dc_backend']:.1f} ms", "screening_case118_ieee_autores.json  msPerScenario")
    row("IEEE 118, 177 single-line outages: median of the per-outage mean loading error, GENCO", f"{float(np.median(errs)):.2f} pt", "interface/src/data/genco_lines_case118_ieee.json  outages[*]")
    lines += ["", "Hand-entered (not in a JSON): test suites passed at the time of writing - backend 59, interface 135 (`pytest` in `backend/`, `npm test` in `interface/`).",
              "Reproduce with the commands in `README.md`. Training of our own N-10 model is reported only as an exploration log (`docs/RELATORIO_TREINO_N10.md`)."]
    text = "\n".join(lines) + "\n"
    (OUT / "T1_numbers.md").write_text(text, encoding="utf-8")
    (ROOT / "docs" / "NUMBERS.md").write_text(text.replace("# T1 - Numbers quoted in the post", "# Numbers quoted in the post"), encoding="utf-8")
    print("ok T1")


if __name__ == "__main__":
    fig_overview()
    fig_accuracy()
    fig_verifier()
    volt = fig_voltage()
    compose_screens()
    table_numbers(volt)
