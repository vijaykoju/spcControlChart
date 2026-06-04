/** Chart-strategy registry. Adding a chart family = add a strategy and register it here. */
import { ChartType, ChartStrategy } from "../chartType";
import { individualsStrategy } from "./individuals";
import { pStrategy, npStrategy, cStrategy, uStrategy } from "./attribute";
import { xbarRStrategy, xbarSStrategy } from "./subgroup";
import { ewmaStrategy, maStrategy } from "./timeWeighted";

export const STRATEGIES: Record<ChartType, ChartStrategy> = {
    individuals: individualsStrategy,
    p: pStrategy,
    np: npStrategy,
    c: cStrategy,
    u: uStrategy,
    "xbar-r": xbarRStrategy,
    "xbar-s": xbarSStrategy,
    ewma: ewmaStrategy,
    ma: maStrategy,
};
