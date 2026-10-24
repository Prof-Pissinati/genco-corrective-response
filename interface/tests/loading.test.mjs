import test from 'node:test';
import assert from 'node:assert/strict';
import { OVERLOAD_PCT, isOverloaded } from '../src/utils/loading.js';

test('a line at its limit is not overloaded; above the limit plus tolerance it is', () => {
    assert.equal(isOverloaded(100), false);
    assert.equal(isOverloaded(100.0003), false);      // numerical noise of a recomputed AC at an active limit
    assert.equal(isOverloaded(OVERLOAD_PCT), false);
    assert.equal(isOverloaded(100.5), true);
    assert.equal(isOverloaded(177), true);
    assert.equal(isOverloaded(0), false);
});
