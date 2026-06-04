/** Chart-strategy registry. Adding a chart family = add a strategy and register it here. */
import { ChartType, ChartStrategy } from "../chartType";
import { individualsStrategy } from "./individuals";
import { pStrategy, npStrategy, cStrategy, uStrategy } from "./attribute";

export const STRATEGIES: Record<ChartType, ChartStrategy> = {
    individuals: individualsStrategy,
    p: pStrategy,
    np: npStrategy,
    c: cStrategy,
    u: uStrategy,
};
