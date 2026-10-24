/** A line is overloaded only above its limit plus a numerical tolerance (0.01% of the rating, the same as TOL_LOADING in backend/app/evaluate.py).
 *  A plan from the OPF/LP leaves lines exactly AT the limit (100.00%), and the recomputed AC gives 100.0003% from numerical noise: that is not an overload. */
export const OVERLOAD_PCT = 100.01;
export const isOverloaded = (percentage) => percentage > OVERLOAD_PCT;
