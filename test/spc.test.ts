/**
 * SPC custom visual — pure-logic test suite. Run with `npm test`.
 *
 * Covers the d3/powerbi-free modules (spc/*, extractData, settingsMap, theme, tooltip) across
 * normal and EDGE inputs. Rendering (chart.ts/visual.ts) is verified separately via the manual
 * checklist in docs/edge-cases.md. No test framework — plain assertions under node.
 */

import { extractSeries, hasMeasureColumn } from "../src/extractData";
import { buildDataPoints, computePhasedStatistics, mrLimits, evaluateMrViolations, D4 } from "../src/spc/statistics";
import { detectChangepoint, resolveChangepoint } from "../src/spc/changepoint";
import { evaluateRules } from "../src/spc/rules";
import { buildTooltipItems, buildMrTooltipItems } from "../src/tooltip";
import { toDataLabelMode, toMrChartOptions, toLegendPosition } from "../src/settingsMap";
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
check("1 point: no MR violation", evaluateMrViolations(one, onePh)[0] === false);

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
check("all-identical: no rule fires", evaluateRules(flat, flatPh).every(r => !r.violation));

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
const gapRunRes = evaluateRules(gapRun, computePhasedStatistics(gapRun, 99));
check("a gap breaks the run (rule 4 never fires across it)", gapRunRes.every(r => !r.firedRules.includes(4)), gapRunRes.map(r => r.firedRules));

// changepoint ignores gaps and maps the split back to the first phase-2 REAL point's index
const stepGap = fromVals([...Array(15).fill(10), null, ...Array(15).fill(20)]);
const cpGap = detectChangepoint(stepGap, 3, 10);
check("changepoint detects the step despite a gap", cpGap.significant, cpGap);
check("changepoint maps changeAt to the real point index (17)", cpGap.changeAt === 17, cpGap.changeAt);

// a gap slot fires NO rule — incl. the direction-based 5/8, which would otherwise fire AT the
// gap over the preceding run (a 6-point up-trend then a blank → the blank must not violate).
const trendThenGap = fromVals([1, 2, 3, 4, 5, 6, 7, null]);
const trendGapRes = evaluateRules(trendThenGap, computePhasedStatistics(trendThenGap, 99));
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

const results = evaluateRules(pts, ph);
// rule 4 (run of 7): 5 below xBar then 7 above -> fires exactly at the 7th (index 11), not the 6th
const run = fromValues([...Array(5).fill(1), ...Array(7).fill(2)]);
const runRes = evaluateRules(run, computePhasedStatistics(run, run.length + 1));
check("rule4 fires at the 7th consecutive (window boundary)", runRes[11].firedRules.includes(4), runRes[11].firedRules);
check("rule4 does not fire with only 6 in window", !runRes[10].firedRules.includes(4), runRes[10].firedRules);
check("rules don't fire on a short series", evaluateRules(fromValues([1, 2, 1]), computePhasedStatistics(fromValues([1, 2, 1]), 4)).every(r => !r.violation));

let threw = false;
try {
    evaluateRules([{ index: 2, label: "x", value: 1, movingRange: null, prevValue: null, direction: null, categoryIndex: 0 }] as any, onePh);
} catch { threw = true; }
check("evaluateRules throws on non-contiguous input", threw);

// ============================================================ tooltip (m9/m13)

const items = buildTooltipItems(pts[0], results, ph, fmt, "Month", "Rate", "Target");
const byName = Object.fromEntries(items.map(i => [i.displayName, i.value]));
check("tooltip axis label + fmt'd value", byName["Month"] === pts[0].label && byName["Rate"] === fmt(pts[0].value));
check("Phase row omitted when single-phase", !items.some(i => i.displayName === "Phase"));
check("tooltip center/UCL/LCL", byName["Center (x̄)"] === fmt(ph.phase1.xBar) && byName["UCL"] === fmt(ph.phase1.ucl) && byName["LCL"] === fmt(ph.phase1.lcl));

const ph2 = computePhasedStatistics(pts, 7);
const res2 = evaluateRules(pts, ph2);
check("Phase row present + correct in two-phase",
    buildTooltipItems(pts[0], res2, ph2, fmt, "Month", "Rate", "Target").find(i => i.displayName === "Phase")?.value === "1" &&
    buildTooltipItems(pts[8], res2, ph2, fmt, "Month", "Rate", "Target").find(i => i.displayName === "Phase")?.value === "2");

const ptWithTarget = { ...pts[0], target: 0.027 };
check("tooltip target row labelled with targetName", buildTooltipItems(ptWithTarget, results, ph, fmt, "Month", "Rate", "FY Target").find(i => i.displayName === "FY Target")?.value === fmt(0.027));
check("tooltip target row omitted when no target", !buildTooltipItems(pts[0], results, ph, fmt, "Month", "Rate", "FY Target").some(i => i.displayName === "FY Target"));

// Use a fixture guaranteed to violate (out-of-limit spike) so this assertion actually runs.
const spike = fromValues([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100]);
const spikePh = computePhasedStatistics(spike, spike.length + 1);
const spikeRes = evaluateRules(spike, spikePh);
const spikeIdx = spikeRes.findIndex(r => r.violation);
check("spike fixture produces a violation", spikeIdx >= 0, spikeRes.map(r => r.firedRules));
check("'Rule violations' line present on a violating point",
    buildTooltipItems(spike[spikeIdx], spikeRes, spikePh, fmt, "Month", "Rate", "Target").some(i => i.displayName === "Rule violations" && (i.value as string).length > 0));
check("'Rule violations' line omitted on a clean point",
    !buildTooltipItems(spike[0], spikeRes, spikePh, fmt, "Month", "Rate", "Target").some(i => i.displayName === "Rule violations"));

const mrTip = buildMrTooltipItems(fromValues([10, 13, 9])[1], computePhasedStatistics(fromValues([10, 13, 9]), 4), fmt, "Month");
const mrTipBy = Object.fromEntries(mrTip.map(i => [i.displayName, i.value]));
check("MR tooltip: moving range value", mrTipBy["Moving range"] === fmt(3));

// ============================================================ settingsMap (m10/m13)

check("toDataLabelMode passthrough + guard", toDataLabelMode("all") === "all" && toDataLabelMode("violations") === "violations" && toDataLabelMode("xyz") === "off");
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
