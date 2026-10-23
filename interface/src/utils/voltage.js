// src/utils/voltage.js
// Single criterion for "voltage out of range" for the diagram (glow), the inspector and the tooltips.
// Transmission: the range is that of each bus (case vmin/vmax, 0.94 to 1.06 pu in IEEE 118), with the same tolerance as the backend.
// Distribution (no per-bus range): old behavior, 0.93 and 1.05 critical and 0.95 as a warning.

export const VOLTAGE_TOL = 5e-4;       // pu; same as TOL_VOLTAGE in backend/app/evaluate.py

/** 'bad' (out of range), 'warn' (warning, distribution only) or 'ok'. `lim` = { vmin, vmax } of the bus, or null. */
export function voltageLevel(v, lim = null) {
    if (!Number.isFinite(v)) return 'ok';
    if (lim && Number.isFinite(lim.vmin) && Number.isFinite(lim.vmax)) {
        return v < lim.vmin - VOLTAGE_TOL || v > lim.vmax + VOLTAGE_TOL ? 'bad' : 'ok';
    }
    if (v < 0.93 || v > 1.05) return 'bad';
    return v < 0.95 ? 'warn' : 'ok';
}

/** Voltage in pu to display: 4 decimals in transmission (1.0603 must not look like 1.060, inside the limit), 3 in distribution. */
export function formatVoltage(v, transmission = false) {
    return Number(v).toFixed(transmission ? 4 : 3);
}
