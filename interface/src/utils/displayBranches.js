// src/utils/displayBranches.js
// In transmission, a bus fault switches off every line connected to it. The data model only stores the faulted bus
// (the lines stay `state: 1`, and the backend removes them from the topology); for DISPLAY these lines count as open
// (dashed, with no flow arrow, in the "Open Lines" count). The original data is not changed.

/** List of lines to display: those connected to a faulted bus come with `state: 0` (and `openByFault: true`). Without faults, it returns the same list. */
export function branchesForDisplay(branches, faultNodes) {
    if (!faultNodes || !faultNodes.size || !branches || !branches.length) return branches;
    const faulted = new Set([...faultNodes].map(Number));
    let changed = false;
    const out = branches.map(b => {
        if (b.state === 0) return b;
        if (faulted.has(Number(b.from)) || faulted.has(Number(b.to))) { changed = true; return { ...b, state: 0, openByFault: true }; }
        return b;
    });
    return changed ? out : branches;
}
