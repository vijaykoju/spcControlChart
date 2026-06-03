/** Chart-strategy registry. Adding a chart family = add a strategy and register it here. */
import { ChartType, ChartStrategy } from "../chartType";
import { individualsStrategy } from "./individuals";

export const STRATEGIES: Record<ChartType, ChartStrategy> = {
    individuals: individualsStrategy,
};
