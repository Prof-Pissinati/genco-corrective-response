// Voltage-out-of-range criterion: per bus in transmission (same tolerance as the backend), old rule in distribution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voltageLevel, formatVoltage, VOLTAGE_TOL } from '../src/utils/voltage.js';

const lim = { vmin: 0.94, vmax: 1.06 };

test('transmission: bus range with the backend tolerance (0.0005 pu)', () => {
    assert.equal(VOLTAGE_TOL, 5e-4);
    assert.equal(voltageLevel(1.06, lim), 'ok');
    assert.equal(voltageLevel(1.06 + VOLTAGE_TOL / 2, lim), 'ok');
    assert.equal(voltageLevel(1.060307, lim), 'ok', 'bus 17 of the plan for the fault at 68 (1.060307) is within the tolerance: what vanishes in 3-decimal rounding does not count');
    assert.equal(voltageLevel(1.0606, lim), 'bad', 'above 1.0605 is a violation');
    assert.equal(voltageLevel(1.055, lim), 'ok', '1.05 is not a limit in transmission');
    assert.equal(voltageLevel(0.94, lim), 'ok');
    assert.equal(voltageLevel(0.9394, lim), 'bad');
    assert.equal(voltageLevel(0.945, lim), 'ok', 'no warning band in transmission');
});

test('distribution (no per-bus range): old rule', () => {
    assert.equal(voltageLevel(1.0, null), 'ok');
    assert.equal(voltageLevel(1.051, null), 'bad');
    assert.equal(voltageLevel(0.92, null), 'bad');
    assert.equal(voltageLevel(0.94, null), 'warn');
    assert.equal(voltageLevel(NaN, lim), 'ok');
    assert.equal(voltageLevel(undefined, null), 'ok');
});

test('display: 4 decimals in transmission, so 1.0603 does not look like 1.060', () => {
    assert.equal(formatVoltage(1.0603, true), '1.0603');
    assert.equal(formatVoltage(1.0603, false), '1.060');
});

test('IEEE 118: the on-screen rule matches the backend violations (fault at bus 68, and bus 17 at 1.0603 stays within the tolerance)', () => {
    const caso = JSON.parse(readFileSync(new URL('../src/data/case118_ieee.json', import.meta.url)));
    const limites = new Map(caso.bus.map(b => [b[0], { vmax: b[11], vmin: b[12] }]));
    const rep = JSON.parse(readFileSync(new URL('../src/data/replay_case118_ieee.json', import.meta.url)));
    const e = rep.corrective['c:|68'];
    for (const st of ['postFault', 'after']) {
        const ui = e[st].buses.filter(b => voltageLevel(b.vm, limites.get(b.id)) === 'bad').map(b => b.id).sort((a, b) => a - b);
        assert.deepEqual(ui, [...e[st].violations.voltage].sort((a, b) => a - b), `stage ${st}: UI and backend agree`);
    }
    assert.deepEqual(e.after.violations.voltage, []);
    assert.ok(Math.abs(e.after.buses.find(b => b.id === 17).vm - 1.060307) < 1e-6);
});
