/**
 * Individuals (X-mR) strategy — the first ChartStrategy. A thin adapter over the existing
 * statistics/changepoint logic, so its output is identical to the pre-seam pipeline. The strategy
 * owns phase resolution (it calls resolveChangepoint itself); the companion is the moving-range
 * chart, with limits derived from each point's MR̄.
 */

import type { ChartStrategy, ChartContext, LimitModel, CompanionModel } from "../chartType";
import { DataPoint, PhasedStatistics } from "../types";
import { computePhasedStatistics, splitPhases, statsForPoint, D4 } from "../statistics";
import { resolveChangepoint } from "../changepoint";

/** Map a (points, PhasedStatistics) pair to a LimitModel — the individuals mapping, shared by the
 *  strategy and tests (tests build a PhasedStatistics directly to exercise specific phase splits). */
export function modelFromPhased(points: DataPoint[], phased: PhasedStatistics): LimitModel {
    const perPoint = points.map(p => statsForPoint(phased, p));
    const companion: CompanionModel = {
        kind: "mr",
        value: points.map(p => p.movingRange),
        limits: perPoint.map(s => ({ center: s.mrBar, ucl: D4 * s.mrBar, lcl: 0 })),
        axisTitle: "Moving Range",
    };
    return {
        perPoint,
        segments: splitPhases(points, phased),
        companion,
        phaseOf: p => (p.index < phased.changeAt ? 1 : 2),
        singlePhase: phased.singlePhase,
        varyingLimits: false,
    };
}

export const individualsStrategy: ChartStrategy = {
    id: "individuals",
    applicableRules: new Set([1, 2, 3, 4, 5, 6, 7, 8]),
    zonesMeaningful: true,
    build(raw, ctx: ChartContext) {
        const changeAt = resolveChangepoint(raw, ctx.changepoint);
        return { points: raw, limits: modelFromPhased(raw, computePhasedStatistics(raw, changeAt, ctx.opts)) };
    },
};
