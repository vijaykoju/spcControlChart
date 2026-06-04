/**
 * X̄-R / X̄-s control-chart constants by subgroup size m (2–25).
 *
 *   A2 → X̄ limits from R̄ (x̄̄ ± A2·R̄);   A3 → X̄ limits from s̄ (x̄̄ ± A3·s̄)
 *   D3,D4 → R-chart limits (D3·R̄, D4·R̄);  B3,B4 → s-chart limits (B3·s̄, B4·s̄)
 *
 * Standard values (e.g. Montgomery, "Introduction to Statistical Quality Control", Appendix VI).
 * A2/A3 are 3-sigma constants, so the X̄ 1-sigma equivalent is A·spread/3 (see strategies/subgroup).
 */

export interface ControlConstants {
    A2: number;
    A3: number;
    D3: number;
    D4: number;
    B3: number;
    B4: number;
}

// Indexed by subgroup size m. Min m = 2 (m = 1 is the individuals chart).
const TABLE: { [m: number]: ControlConstants } = {
    2: { A2: 1.880, A3: 2.659, D3: 0, D4: 3.267, B3: 0, B4: 3.267 },
    3: { A2: 1.023, A3: 1.954, D3: 0, D4: 2.574, B3: 0, B4: 2.568 },
    4: { A2: 0.729, A3: 1.628, D3: 0, D4: 2.282, B3: 0, B4: 2.266 },
    5: { A2: 0.577, A3: 1.427, D3: 0, D4: 2.114, B3: 0, B4: 2.089 },
    6: { A2: 0.483, A3: 1.287, D3: 0, D4: 2.004, B3: 0.030, B4: 1.970 },
    7: { A2: 0.419, A3: 1.182, D3: 0.076, D4: 1.924, B3: 0.118, B4: 1.882 },
    8: { A2: 0.373, A3: 1.099, D3: 0.136, D4: 1.864, B3: 0.185, B4: 1.815 },
    9: { A2: 0.337, A3: 1.032, D3: 0.184, D4: 1.816, B3: 0.239, B4: 1.761 },
    10: { A2: 0.308, A3: 0.975, D3: 0.223, D4: 1.777, B3: 0.284, B4: 1.716 },
    11: { A2: 0.285, A3: 0.927, D3: 0.256, D4: 1.744, B3: 0.321, B4: 1.679 },
    12: { A2: 0.266, A3: 0.886, D3: 0.283, D4: 1.717, B3: 0.354, B4: 1.646 },
    13: { A2: 0.249, A3: 0.850, D3: 0.307, D4: 1.693, B3: 0.382, B4: 1.618 },
    14: { A2: 0.235, A3: 0.817, D3: 0.328, D4: 1.672, B3: 0.406, B4: 1.594 },
    15: { A2: 0.223, A3: 0.789, D3: 0.347, D4: 1.653, B3: 0.428, B4: 1.572 },
    16: { A2: 0.212, A3: 0.763, D3: 0.363, D4: 1.637, B3: 0.448, B4: 1.552 },
    17: { A2: 0.203, A3: 0.739, D3: 0.378, D4: 1.622, B3: 0.466, B4: 1.534 },
    18: { A2: 0.194, A3: 0.718, D3: 0.391, D4: 1.608, B3: 0.482, B4: 1.518 },
    19: { A2: 0.187, A3: 0.698, D3: 0.403, D4: 1.597, B3: 0.497, B4: 1.503 },
    20: { A2: 0.180, A3: 0.680, D3: 0.415, D4: 1.585, B3: 0.510, B4: 1.490 },
    21: { A2: 0.173, A3: 0.663, D3: 0.425, D4: 1.575, B3: 0.523, B4: 1.477 },
    22: { A2: 0.167, A3: 0.647, D3: 0.434, D4: 1.566, B3: 0.534, B4: 1.466 },
    23: { A2: 0.162, A3: 0.633, D3: 0.443, D4: 1.557, B3: 0.545, B4: 1.455 },
    24: { A2: 0.157, A3: 0.619, D3: 0.451, D4: 1.548, B3: 0.555, B4: 1.445 },
    25: { A2: 0.153, A3: 0.606, D3: 0.459, D4: 1.541, B3: 0.565, B4: 1.435 },
};

/** Constants for subgroup size m, or null when m is not a whole number in [2, 25]. */
export function constantsFor(m: number): ControlConstants | null {
    return Number.isInteger(m) && TABLE[m] ? TABLE[m] : null;
}
