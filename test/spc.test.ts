/**
 * SPC custom visual — pure-logic test suite. Run with `npm test`.
 *
 * Covers the d3/powerbi-free modules (spc/*, extractData, settingsMap, theme, tooltip) across
 * normal and EDGE inputs. Rendering (chart.ts/visual.ts) is verified separately via the manual
 * checklist in docs/edge-cases.md. No test framework — plain assertions under node.
 */

import { extractSeries, hasMeasureColumn } from "../src/extractData";
import { buildDataPoints, computePhasedStatistics, mrLimits, D4 } from "../src/spc/statistics";
import { detectChangepoint, resolveChangepoint } from "../src/spc/changepoint";
import { evaluateRules, RULES } from "../src/spc/rules";
import { modelFromPhased, individualsStrategy } from "../src/spc/strategies/individuals";
import { pStrategy, npStrategy, cStrategy, uStrategy } from "../src/spc/strategies/attribute";
import { limitsFromModel, companionViolations } from "../src/spc/chartType";
import { DataPoint, PhasedStatistics } from "../src/spc/types";
import { buildTooltipItems, buildMrTooltipItems } from "../src/tooltip";
import { toDataLabelMode, toMrChartOptions, toLegendPosition, toSidePosition, toChartType, applicableEnabledRules } from "../src/settingsMap";
import { resolveChartColors } from "../src/theme";
import { buildLegendItems } from "../src/legend";

// Minimal ambient decl so the suite stays dependency-free (no @types/node); node provides it.
declare const process: { exit(code: number): void };

let pass = 0, fail = 0;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function check(name: string, cond: boolean, got?: unknown) {
    if (cond) { pass++; }
    else { fail++; console.log("FAIL:", name, "=> got:", JSON.stringify(got)); }
}
/** Build DataPoints from bare values (the common fixture shape). */
const fromValues = (vals: number[]) =>
    buildDataPoints(vals.map((v, i) => ({ label: "m" + i, value: v, categoryIndex: i })));
const fmt = (n: number) => n.toFixed(2);
// Phase 0: the rule engine + tooltips consume a LimitModel/accessor. These adapters let the
// fixtures keep building a PhasedStatistics directly (to exercise specific phase splits).
const rulesOf = (points: DataPoint[], ph: PhasedStatistics, enabled?: Set<number>) =>
    evaluateRules(points, limitsFromModel(modelFromPhased(points, ph)), enabled);

// ============================================================ extractData (m7/m9/m10/m11)

const dv: any = {
    categorical: {
        categories: [{
            source: { type: { dateTime: true }, displayName: "Month" },
            values: [new Date(2023, 2, 1), new Date(2023, 0, 1), new Date(2023, 1, 1)],
        }],
        values: [
            { source: { displayName: "Volume", format: "#,0", roles: { tooltips: true } }, values: [30, 10, 20] },
            { source: { displayName: "Rate", format: "0.0%", roles: { measure: true } }, values: [0.3, 0.1, 0.2] },
        ],
    },
};
const s = extractSeries(dv);
check("measure by role (sorted)", eq(s.map(p => p.value), [0.1, 0.2, 0.3]), s.map(p => p.value));
check("labels sorted ascending", eq(s.map(p => p.label), ["2023-01-01", "2023-02-01", "2023-03-01"]), s.map(p => p.label));
check("tooltip values aligned after sort", eq(s.map(p => p.tooltips![0].value), [10, 20, 30]), s.map(p => p.tooltips![0].value));
check("categoryIndex follows original row through sort", eq(s.map(p => p.categoryIndex), [1, 2, 0]), s.map(p => p.categoryIndex));

const noRoles: any = { categorical: { categories: [{ source: { type: { numeric: true } }, values: [1, 2] }], values: [{ source: {}, values: [5, 6] }] } };
check("no-roles fallback to values[0]", eq(extractSeries(noRoles).map(p => p.value), [5, 6]));
check("no-roles hasMeasureColumn true", hasMeasureColumn(noRoles) === true);

const tooltipsOnly: any = { categorical: { categories: [{ source: { type: { numeric: true } }, values: [1, 2] }], values: [{ source: { roles: { tooltips: true } }, values: [5, 6] }] } };
check("tooltips-only: hasMeasureColumn false", hasMeasureColumn(tooltipsOnly) === false);
check("tooltips-only: extractSeries empty", extractSeries(tooltipsOnly).length === 0);

const targetDv: any = { categorical: {
    categories: [{ source: { type: { dateTime: true } }, values: [new Date(2023, 2, 1), new Date(2023, 0, 1), new Date(2023, 1, 1)] }],
    values: [
        { source: { displayName: "Target", roles: { target: true } }, values: [3.3, 3.1, 3.2] },
        { source: { roles: { measure: true } }, values: [0.3, 0.1, 0.2] },
    ],
}};
check("target aligned after sort", eq(extractSeries(targetDv).map(p => p.target), [3.1, 3.2, 3.3]));

const targetOnly: any = { categorical: { categories: [{ source: { type: { numeric: true } }, values: [1, 2] }], values: [{ source: { roles: { target: true } }, values: [9, 9] }] } };
check("target-only renders nothing", extractSeries(targetOnly).length === 0);

const targetNulls: any = { categorical: {
    categories: [{ source: { type: { numeric: true } }, values: [1, 2, 3] }],
    values: [
        { source: { roles: { measure: true } }, values: [5, 6, 7] },
        { source: { roles: { target: true } }, values: [3, null, "x"] },
    ],
}};
const sNulls = extractSeries(targetNulls);
check("target null/text -> null, rows kept", eq(sNulls.map(p => p.target), [3, null, null]) && sNulls.length === 3);

// edge: text axis keeps observation order; hierarchy joins labels; duplicates kept
const textDv: any = { categorical: { categories: [{ source: { type: { text: true } }, values: ["B", "A", "C"] }], values: [{ source: { roles: { measure: true } }, values: [1, 2, 3] }] } };
check("text axis: observation order (no sort)", eq(extractSeries(textDv).map(p => p.label), ["B", "A", "C"]));

const hierDv: any = { categorical: { categories: [
    { source: { type: { numeric: true } }, values: [2023, 2023] },
    { source: { type: { text: true } }, values: ["Q1", "Q2"] },
], values: [{ source: { roles: { measure: true } }, values: [1, 2] }] } };
check("hierarchy labels joined", extractSeries(hierDv)[0].label === "2023 / Q1", extractSeries(hierDv)[0].label);

const dupDv: any = { categorical: { categories: [{ source: { type: { dateTime: true } }, values: [new Date(2023, 0, 1), new Date(2023, 0, 1), new Date(2023, 1, 1)] }], values: [{ source: { roles: { measure: true } }, values: [1, 2, 3] }] } };
check("duplicate axis values: 3 points kept", extractSeries(dupDv).length === 3);

check("extractSeries empty dv -> []", extractSeries({ categorical: { categories: [], values: [] } } as any).length === 0);

// ============================================================ statistics (m2) + edge cases

const raw = [10, 11, 9, 12, 10, 11, 13, 9, 10, 11, 12, 10];
const pts = fromValues(raw);
const ph = computePhasedStatistics(pts, pts.length + 1);
check("buildDataPoints empty -> []", buildDataPoints([]).length === 0);

const one = fromValues([5]);
const onePh = computePhasedStatistics(one, 2);
check("1 point: movingRange null", one[0].movingRange === null);
check("1 point: limits finite, = value", Number.isFinite(onePh.phase1.ucl) && onePh.phase1.xBar === 5 && onePh.phase1.ucl === 5);
check("1 point: no MR violation", companionViolations(modelFromPhased(one, onePh).companion!)[0] === false);

const two = fromValues([5, 8]);
check("2 points: single MR", two[0].movingRange === null && two[1].movingRange === 3);

// optional fields (m9/m10) carried through buildDataPoints; absent -> undefined; stats unaffected
const carried = buildDataPoints([
    { label: "a", value: 1, categoryIndex: 0, tooltips: [{ displayName: "x", value: 1 }], target: 2 },
    { label: "b", value: 2, categoryIndex: 1 },
]);
check("buildDataPoints carries tooltips + target; absent -> undefined",
    eq(carried[0].tooltips, [{ displayName: "x", value: 1 }]) && carried[0].target === 2 &&
    carried[1].tooltips === undefined && carried[1].target === undefined);
check("optional fields don't perturb stats",
    eq(computePhasedStatistics(carried, 3).phase1, computePhasedStatistics(fromValues([1, 2]), 3).phase1));

const flat = fromValues(Array(12).fill(5));
const flatPh = computePhasedStatistics(flat, flat.length + 1);
check("all-identical: sigma 0, limits collapse to xBar, no NaN",
    flatPh.phase1.sigma === 0 && flatPh.phase1.ucl === 5 && flatPh.phase1.lcl === 5);
check("all-identical: no rule fires", rulesOf(flat, flatPh).every(r => !r.violation));

const neg = fromValues([-5, -3, -8, -4, -6]);
check("negatives: floorLcl on -> lcl floored to 0", computePhasedStatistics(neg, neg.length + 1).phase1.lcl === 0);
check("negatives: floorLcl off -> lcl negative", computePhasedStatistics(neg, neg.length + 1, { floorLcl: false }).phase1.lcl < 0);

// Gap-aware: a blank-measure row is KEPT as a slot (value null), not dropped, and the moving
// range is NOT bridged across it.
const gapDv: any = { categorical: { categories: [{ source: { type: { numeric: true } }, values: [1, 2, 3] }], values: [{ source: { roles: { measure: true } }, values: [5, null, 7] }] } };
const gapped = buildDataPoints(extractSeries(gapDv));
check("blank row kept as a gap slot", gapped.length === 3 && eq(gapped.map(p => p.value), [5, null, 7]));
check("categoryIndex over all slots", eq(gapped.map(p => p.categoryIndex), [0, 1, 2]));
check("MR NOT bridged across a gap (gap + post-gap MR null)", gapped[1].movingRange === null && gapped[2].movingRange === null);

// gap excluded from xBar; the gap-spanning MR is excluded (no bridge)
const fromVals = (vals: (number | null)[]) => buildDataPoints(vals.map((v, i) => ({ label: "m" + i, value: v, categoryIndex: i })));
const gp = computePhasedStatistics(fromVals([10, 12, 8, null, 20, 22]), 99);
check("gap excluded from xBar (mean of real values)", Math.abs(gp.phase1.xBar - 14.4) < 1e-9, gp.phase1.xBar);
check("MR excludes the gap-spanning pair", Math.abs(gp.phase1.mrBar - 8 / 3) < 1e-9, gp.phase1.mrBar);

// a gap breaks a run: no 7-consecutive-real window exists across it → rule 4 never fires
const gapRun = fromVals([1, 1, 1, 1, 1, 2, 2, 2, null, 2, 2, 2, 2]);
const gapRunRes = rulesOf(gapRun, computePhasedStatistics(gapRun, 99));
check("a gap breaks the run (rule 4 never fires across it)", gapRunRes.every(r => !r.firedRules.includes(4)), gapRunRes.map(r => r.firedRules));

// changepoint ignores gaps and maps the split back to the first phase-2 REAL point's index
const stepGap = fromVals([...Array(15).fill(10), null, ...Array(15).fill(20)]);
const cpGap = detectChangepoint(stepGap, 3, 10);
check("changepoint detects the step despite a gap", cpGap.significant, cpGap);
check("changepoint maps changeAt to the real point index (17)", cpGap.changeAt === 17, cpGap.changeAt);

// a gap slot fires NO rule — incl. the direction-based 5/8, which would otherwise fire AT the
// gap over the preceding run (a 6-point up-trend then a blank → the blank must not violate).
const trendThenGap = fromVals([1, 2, 3, 4, 5, 6, 7, null]);
const trendGapRes = rulesOf(trendThenGap, computePhasedStatistics(trendThenGap, 99));
check("a gap slot fires no rule (no trend false-positive at the gap)",
    trendGapRes[7].firedRules.length === 0 && trendGapRes[7].violation === false, trendGapRes[7]);

// all-gap series → finite zero stats (no NaN); the render side routes this to the empty state
const allGap = computePhasedStatistics(fromVals([null, null, null]), 4);
check("all-gap stats finite (no NaN)",
    Number.isFinite(allGap.phase1.xBar) && Number.isFinite(allGap.phase1.ucl) && Number.isFinite(allGap.phase1.sigma), allGap.phase1);

// ============================================================ changepoint (m4) + edge cases

const flat24 = fromValues(Array(24).fill(5));
const cpFlat = detectChangepoint(flat24, 3, 10);
check("changepoint all-identical -> single phase, finite stat", cpFlat.changeAt === 25 && Number.isFinite(cpFlat.bestStatistic));
check("changepoint n < 2*seg -> single phase", detectChangepoint(fromValues([1, 2, 3, 4, 5]), 3, 10).changeAt === 6);

const step = fromValues([...Array(15).fill(10), ...Array(15).fill(20)]);
const cpStep = detectChangepoint(step, 3, 10);
check("changepoint detects a clean step", cpStep.significant && cpStep.changeAt === 16, cpStep);
check("manual changepoint clamps >= 2", resolveChangepoint(step, { manualChangepoint: 0 }) === 2);
check("manual changepoint clamps <= n+1", resolveChangepoint(step, { manualChangepoint: 999 }) === 31);
check("manual changepoint rounds", resolveChangepoint(step, { manualChangepoint: 2.7 }) === 3);
check("non-finite manual -> detection", resolveChangepoint(step, { manualChangepoint: NaN }) === detectChangepoint(step).changeAt);

// ============================================================ rules (m3) + window boundaries

const results = rulesOf(pts, ph);
const phModel = modelFromPhased(pts, ph);
// rule 4 (run of 7): 5 below xBar then 7 above -> fires exactly at the 7th (index 11), not the 6th
const run = fromValues([...Array(5).fill(1), ...Array(7).fill(2)]);
const runRes = rulesOf(run, computePhasedStatistics(run, run.length + 1));
check("rule4 fires at the 7th consecutive (window boundary)", runRes[11].firedRules.includes(4), runRes[11].firedRules);
check("rule4 does not fire with only 6 in window", !runRes[10].firedRules.includes(4), runRes[10].firedRules);
check("rules don't fire on a short series", rulesOf(fromValues([1, 2, 1]), computePhasedStatistics(fromValues([1, 2, 1]), 4)).every(r => !r.violation));

// rules 2/3 fire on the out-of-zone point itself, not an in-control point that merely trails it.
// Regression (screenshot 8092): 10.55 — sitting on x̄ — was flagged because its two predecessors
// (7.63, 6.83) were below Zone A; the violation belongs on the low point, not the one after it.
const r2fix = fromValues([11.04, 10.15, 7.63, 6.83, 10.55, 11.21, 9.96, 10.67, 10.19, 11.12, 11.31, 9.83, 8.78, 11.15, 10.79, 11.06, 12.60, 9.06, 10.94, 10.12, 10.60]);
const r2res = rulesOf(r2fix, computePhasedStatistics(r2fix, r2fix.length + 1));
check("rule2 fires on the low point (6.83), not the in-zone point after it (10.55)",
    r2res[3].firedRules.includes(2) && !r2res[4].firedRules.includes(2), [r2res[3].firedRules, r2res[4].firedRules]);

// rule5 requires a strictly monotonic run, not "6 of any 7 directions": a single reversal
// inside the 7-point window must not read as a trend.
const trend7 = fromValues([1, 2, 3, 4, 5, 6, 7, 8]);
check("rule5 fires on a strict 7-point up-trend",
    rulesOf(trend7, computePhasedStatistics(trend7, trend7.length + 1))[6].firedRules.includes(5));
const zig = fromValues([1, 2, 3, 4, 5, 6, 5.5, 7]); // 6 ups + 1 reversal in the last 7
check("rule5 does NOT fire when the window has a reversal (no false trend)",
    !rulesOf(zig, computePhasedStatistics(zig, zig.length + 1)).some(r => r.firedRules.includes(5)));

// rule8 requires strict 14-point alternation; one non-alternating step must not trip it.
const alt = fromValues(Array.from({ length: 16 }, (_, k) => (k % 2 === 0 ? 1 : 2)));
check("rule8 fires on a strict 14-point alternation",
    rulesOf(alt, computePhasedStatistics(alt, alt.length + 1)).some(r => r.firedRules.includes(8)));
const altBreak = fromValues([1, 2, 1, 2, 1, 2, 1, 2, 2, 1, 2, 1, 2, 1, 2, 1]); // the "2,2" breaks alternation
check("rule8 does NOT fire when one step fails to alternate",
    !rulesOf(altBreak, computePhasedStatistics(altBreak, altBreak.length + 1)).some(r => r.firedRules.includes(8)));

let threw = false;
try {
    evaluateRules([{ index: 2, label: "x", value: 1, movingRange: null, prevValue: null, direction: null, categoryIndex: 0 }] as any, () => onePh.phase1);
} catch { threw = true; }
check("evaluateRules throws on non-contiguous input", threw);

// chart-type seam: the individuals strategy owns phase resolution (calls resolveChangepoint) and
// emits per-point limits + an MR companion. `step` has a clean changepoint at index 16.
const stepModel = individualsStrategy.computeLimits(step, { opts: {}, changepoint: {} });
check("individuals strategy resolves the changepoint into two phases",
    !stepModel.singlePhase && stepModel.phaseOf!(step[14]) === 1 && stepModel.phaseOf!(step[15]) === 2,
    { singlePhase: stepModel.singlePhase });
check("individuals strategy emits per-point limits + MR companion aligned to points",
    stepModel.perPoint.length === step.length && stepModel.companion?.kind === "mr" &&
    stepModel.companion.value.length === step.length);

// ============================================================ attribute charts (Phase 1)
const attr = (strategy: typeof pStrategy, values: (number | null)[], sizes?: (number | null)[]) => {
    const raw = buildDataPoints(values.map((v, i) => ({ label: "m" + i, value: v, categoryIndex: i, sampleSize: sizes ? sizes[i] : undefined })));
    const pts = strategy.prepare(raw);
    return { pts, model: strategy.computeLimits(pts, { opts: {} }) };
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

// c-chart: c̄ = 2, σ = √2, LCL floored at 0; constant limits, no companion.
const cRes = attr(cStrategy, [2, 2, 2, 2]);
check("c-chart: center c̄ + √c̄ limits, floored LCL",
    near(cRes.model.perPoint[0].xBar, 2) && near(cRes.model.perPoint[0].ucl, 2 + 3 * Math.SQRT2) &&
    cRes.model.perPoint[0].lcl === 0 && cRes.model.varyingLimits === false && cRes.model.companion === null);

// p-chart: p̄ = 0.1; per-point limits differ with n (varying).
const pRes = attr(pStrategy, [5, 10], [100, 50]);
check("p-chart: plotted value = count/n", near(pRes.pts[0].value as number, 0.05) && near(pRes.pts[1].value as number, 0.2));
check("p-chart: p̄ + per-point varying limits",
    near(pRes.model.perPoint[0].xBar, 0.1) && near(pRes.model.perPoint[0].ucl, 0.19) &&
    near(pRes.model.perPoint[1].ucl, 0.227279) && pRes.model.varyingLimits === true);

// np-chart: constant n; center = mean count = np̄; σ = √(np̄(1−p̄)).
const npRes = attr(npStrategy, [2, 4, 3, 3], [50, 50, 50, 50]);
check("np-chart: center np̄ + √(np̄(1−p̄)) constant limits",
    near(npRes.model.perPoint[0].xBar, 3) && near(npRes.model.perPoint[0].ucl, 3 + 3 * Math.sqrt(3 * 0.94)) &&
    npRes.model.varyingLimits === false && (npRes.pts[0].value as number) === 2);

// u-chart: ū = 30/9; σᵢ = √(ū/nᵢ) varies.
const uRes = attr(uStrategy, [10, 20], [5, 4]);
check("u-chart: ū + per-point √(ū/nᵢ) limits",
    near(uRes.model.perPoint[0].xBar, 30 / 9) && near(uRes.model.perPoint[0].ucl, 30 / 9 + 3 * Math.sqrt((30 / 9) / 5)) &&
    uRes.model.varyingLimits === true);

// nᵢ ≤ 0 → gap; limits stay finite (no NaN/Infinity corrupting the Y-scale).
const pGap = attr(pStrategy, [5, 3], [100, 0]);
check("p-chart: nᵢ ≤ 0 is a gap, limits finite",
    pGap.pts[1].value === null && Number.isFinite(pGap.model.perPoint[1].ucl) && near(pGap.model.perPoint[0].xBar, 0.05));

check("attribute prepare preserves categoryIndex + sets raw count", pRes.pts[0].categoryIndex === 0 && pRes.pts[0].count === 5);
check("attribute applicableRules = {1,4}",
    eq([...applicableEnabledRules(new Set([1, 2, 3, 4, 5]), pStrategy.applicableRules)].sort(), [1, 4]));

// end-to-end: a p-chart point beyond its per-point UCL trips Beyond Limits; in-control points clean.
const pViol = attr(pStrategy, [15, 15, 15, 50], [100, 100, 100, 100]);
const pViolRes = evaluateRules(pViol.pts, limitsFromModel(pViol.model), pStrategy.applicableRules);
check("p-chart: point beyond per-point UCL fires rule 1; others clean",
    pViolRes[3].firedRules.includes(1) && !pViolRes[0].violation && !pViolRes[1].violation && !pViolRes[2].violation,
    pViolRes.map(r => r.firedRules));

// ============================================================ tooltip (m9/m13)

const items = buildTooltipItems(pts[0], results, phModel, fmt, "Month", "Rate", "Target");
const byName = Object.fromEntries(items.map(i => [i.displayName, i.value]));
check("tooltip axis label + fmt'd value", byName["Month"] === pts[0].label && byName["Rate"] === fmt(pts[0].value));
check("Phase row omitted when single-phase", !items.some(i => i.displayName === "Phase"));
check("tooltip center/UCL/LCL", byName["Center (x̄)"] === fmt(ph.phase1.xBar) && byName["UCL"] === fmt(ph.phase1.ucl) && byName["LCL"] === fmt(ph.phase1.lcl));

const ph2 = computePhasedStatistics(pts, 7);
const ph2Model = modelFromPhased(pts, ph2);
const res2 = rulesOf(pts, ph2);
check("Phase row present + correct in two-phase",
    buildTooltipItems(pts[0], res2, ph2Model, fmt, "Month", "Rate", "Target").find(i => i.displayName === "Phase")?.value === "1" &&
    buildTooltipItems(pts[8], res2, ph2Model, fmt, "Month", "Rate", "Target").find(i => i.displayName === "Phase")?.value === "2");

const ptWithTarget = { ...pts[0], target: 0.027 };
check("tooltip target row labelled with targetName", buildTooltipItems(ptWithTarget, results, phModel, fmt, "Month", "Rate", "FY Target").find(i => i.displayName === "FY Target")?.value === fmt(0.027));
check("tooltip target row omitted when no target", !buildTooltipItems(pts[0], results, phModel, fmt, "Month", "Rate", "FY Target").some(i => i.displayName === "FY Target"));

// Use a fixture guaranteed to violate (out-of-limit spike) so this assertion actually runs.
const spike = fromValues([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100]);
const spikePh = computePhasedStatistics(spike, spike.length + 1);
const spikeModel = modelFromPhased(spike, spikePh);
const spikeRes = rulesOf(spike, spikePh);
const spikeIdx = spikeRes.findIndex(r => r.violation);
check("spike fixture produces a violation", spikeIdx >= 0, spikeRes.map(r => r.firedRules));
const ruleNames = new Set(RULES.map(r => r.name));
const spikeTip = buildTooltipItems(spike[spikeIdx], spikeRes, spikeModel, fmt, "Month", "Rate", "Target");
// Each rule that fired on the point gets its own row: displayName = name, value = short tooltip text.
const firedHere = spikeRes[spikeIdx].firedRules.map(id => RULES.find(r => r.id === id)!);
check("violating point: one tooltip row per fired rule (name → tooltip text)",
    firedHere.length > 0 && firedHere.every(r =>
        spikeTip.some(i => i.displayName === r.name && i.value === r.tooltip)), spikeTip);
check("clean point: no rule rows in the tooltip",
    !buildTooltipItems(spike[0], spikeRes, spikeModel, fmt, "Month", "Rate", "Target").some(i => ruleNames.has(i.displayName)));
check("every rule has non-empty tooltip + description text",
    RULES.every(r => r.tooltip.length > 0 && r.description.length > 0));
// No em/en dashes in user-facing rule text (tooltip + panel).
check("rule text has no em/en dashes",
    RULES.every(r => !/[—–]/.test(r.tooltip) && !/[—–]/.test(r.description)),
    RULES.filter(r => /[—–]/.test(r.tooltip) || /[—–]/.test(r.description)).map(r => r.name));

const mrPts = fromValues([10, 13, 9]);
const mrTip = buildMrTooltipItems(mrPts[1], modelFromPhased(mrPts, computePhasedStatistics(mrPts, 4)), fmt, "Month");
const mrTipBy = Object.fromEntries(mrTip.map(i => [i.displayName, i.value]));
check("MR tooltip: moving range value", mrTipBy["Moving range"] === fmt(3));

// ============================================================ settingsMap (m10/m13)

check("toDataLabelMode passthrough + guard", toDataLabelMode("all") === "all" && toDataLabelMode("violations") === "violations" && toDataLabelMode("xyz") === "off");
check("toSidePosition passthrough + guard",
    toSidePosition("left") === "left" && toSidePosition("right") === "right" && toSidePosition("xyz") === "right");
check("toChartType passthrough + guard",
    toChartType("individuals") === "individuals" && toChartType("p") === "p" &&
    toChartType("u") === "u" && toChartType("xyz") === "individuals");
// rule applicability: user-enabled ∩ chart-type-applicable
check("applicableEnabledRules intersects enabled with applicable",
    eq([...applicableEnabledRules(new Set([1, 2, 3, 8]), new Set([1, 3, 4]))].sort(), [1, 3]));
check("toMrChartOptions clamps", toMrChartOptions(true, 0.05).ratio === 0.1 && toMrChartOptions(true, 0.8).ratio === 0.5 && toMrChartOptions(false, 0.25).ratio === 0.25);

// ============================================================ theme (m12)

const fmtColors = { line: "#L", violation: "#V", limit: "#LIM", center: "#C", zoneA: "#ZA", zoneB: "#ZB", zoneC: "#ZC", phaseChange: "#P", target: "#T", dataLabel: "#D" };
check("resolveChartColors non-HC passthrough", eq(resolveChartColors({ isHighContrast: false, foreground: "#FG", foregroundSelected: "#SEL", format: fmtColors }), fmtColors));
const hcColors = resolveChartColors({ isHighContrast: true, foreground: "#FG", foregroundSelected: "#SEL", format: fmtColors });
check("resolveChartColors HC: marks=foreground, violation=foregroundSelected",
    hcColors.line === "#FG" && hcColors.limit === "#FG" && hcColors.zoneA === "#FG" && hcColors.target === "#FG" && hcColors.violation === "#SEL");

// ============================================================ mrLimits (m13)

const ml = mrLimits({ mrBar: 2 } as any);
check("D4 = 3.267 and mrLimits", D4 === 3.267 && ml.center === 2 && ml.ucl === 3.267 * 2 && ml.lcl === 0);

// ============================================================ legend (m16)

const legBase = { colors: fmtColors, showZones: false, hasTarget: false, hasPhaseChange: false, isHighContrast: false, measureName: "Rate" };
const coreLeg = buildLegendItems(legBase).map(i => i.label);
check("legend core: data-line defaults to measure name + center/limits/violation",
    coreLeg.length === 4 && coreLeg[0] === "Rate" && coreLeg.includes("Control limits") && coreLeg.includes("Violation"), coreLeg);
const zonesLeg = buildLegendItems({ ...legBase, showZones: true }).map(i => i.label);
check("legend adds zones when shading on", zonesLeg.includes("Zone A") && zonesLeg.includes("Zone C"), zonesLeg);
const hcLeg = buildLegendItems({ ...legBase, showZones: true, isHighContrast: true }).map(i => i.label);
check("legend drops zones in high contrast", !hcLeg.some(l => l.startsWith("Zone")), hcLeg);
const tgtPhaseLeg = buildLegendItems({ ...legBase, hasTarget: true, hasPhaseChange: true }).map(i => i.label);
check("legend adds target + phase when present", tgtPhaseLeg.includes("Target") && tgtPhaseLeg.includes("Phase change"), tgtPhaseLeg);
check("toLegendPosition valid + guard",
    toLegendPosition("left") === "left" && toLegendPosition("bottom") === "bottom" && toLegendPosition("xyz") === "top");

// m17: per-entry label overrides
const ovLeg = buildLegendItems({ ...legBase, hasTarget: true, labels: { dataLine: "Mortality %", limits: "Limits (3σ)", target: "   " } }).map(i => i.label);
check("override replaces data-line + limits labels", ovLeg[0] === "Mortality %" && ovLeg.includes("Limits (3σ)"), ovLeg);
check("whitespace override falls back to default", ovLeg.includes("Target") && !ovLeg.includes("   "), ovLeg);
const hiddenOv = buildLegendItems({ ...legBase, hasTarget: false, labels: { target: "Goal" } }).map(i => i.label);
check("override for a hidden entry is ignored", !hiddenOv.includes("Goal") && !hiddenOv.includes("Target"), hiddenOv);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
