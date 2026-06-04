/**
 * SPC control chart renderer: observation-ordered X axis, zone shading, control
 * limits + center line (phase-aware, stepped at the changepoint), the data line,
 * and violation markers. Colors/visibility come from the format pane (m8), with
 * the Deneb-spec values as defaults.
 */

import * as d3 from "d3";
import type powerbi from "powerbi-visuals-api";
import { ITooltipServiceWrapper } from "powerbi-visuals-utils-tooltiputils";
import { DataPoint, PointRuleResult, SpcStatistics, ChartColors } from "../spc/types";
import { PhaseSegment } from "../spc/statistics";
import { LimitModel, CompanionModel, CompanionPoint, companionViolations } from "../spc/chartType";
import { buildTooltipItems, buildMrTooltipItems } from "../tooltip";
import { buildLegendItems, LegendItem, LegendKey } from "../legend";
import { ChartColorSet } from "../theme";

type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

/** Render-time services injected by visual.ts (tooltip wrapper + value formatters). */
export interface ChartServices {
    tooltip?: ITooltipServiceWrapper;
    /** Formats the measure value (Y axis + built-in tooltip), e.g. "2.5%". */
    formatValue: (n: number) => string;
    /** Formats a user tooltip-field value with its own format string ("" for blank). */
    formatExtra: (value: powerbi.PrimitiveValue, format?: string) => string;
    axisName: string;
    measureName: string;
    targetName: string;
    /** Cross-filtering (m11). Absent → non-interactive render. */
    selectionManager?: powerbi.extensibility.ISelectionManager;
    allowInteractions?: boolean;
}

/** Data-label display mode (Annotations card). */
export type DataLabelMode = "off" | "all" | "violations";

export interface ChartModel {
    points: DataPoint[];
    limits: LimitModel;
    results: PointRuleResult[];
    measureName?: string;
    colors?: ChartColors;
    showZones?: boolean;
    showZoneLabels?: boolean;
    /** Symbol-shape keys (see SYMBOLS); fall back to circle / diamond. */
    pointShape?: string;
    violationShape?: string;
    // --- Annotations (m10) ---
    showPhaseChangeLine?: boolean;
    phaseChangeColor?: string;
    showTargetLine?: boolean;
    targetColor?: string;
    dataLabelMode?: DataLabelMode;
    dataLabelColor?: string;
    // --- Theming / accessibility (m12) ---
    isHighContrast?: boolean;
    /** HC foreground; recolors the CSS-driven axis/title/zone-label text when high-contrast. */
    foreground?: string;
    // --- MR companion chart (m13) ---
    showMrChart?: boolean;
    mrHeightRatio?: number;
    // --- Legend / reference key (m16) ---
    showLegend?: boolean;
    legendPosition?: "top" | "bottom" | "left" | "right";
    legendTextColor?: string;
    /** Per-entry legend label overrides (m17); empty → default. */
    legendLabels?: Partial<Record<LegendKey, string>>;
    // --- Rule reference panel ---
    showRuleReference?: boolean;
    /** Which side the reserved panel strip sits on. */
    ruleReferencePosition?: "left" | "right";
    ruleReferenceTextColor?: string;
    /** The enabled rules to list, in id order (name + fuller description). */
    ruleReferenceItems?: { name: string; description: string }[];
}

/** Marker shape keys exposed in the format pane → d3 symbol types. */
const SYMBOLS: { [key: string]: d3.SymbolType } = {
    circle: d3.symbolCircle,
    diamond: d3.symbolDiamond,
    square: d3.symbolSquare,
    triangle: d3.symbolTriangle,
    cross: d3.symbolCross,
    star: d3.symbolStar,
};

function symbolFor(shape: string | undefined, fallback: d3.SymbolType): d3.SymbolType {
    return (shape && SYMBOLS[shape]) || fallback;
}

const MARGIN = { top: 16, right: 16, bottom: 28, left: 56 };
const MAX_X_TICKS = 8;

/** Default palette (overridden by the format pane). */
const DEFAULT_COLORS: ChartColors = {
    line: "#1976D2",
    violation: "#D32F2F",
    limit: "#D32F2F",
    center: "#388E3C",
    zoneA: "#F44336",
    zoneB: "#FF9800",
    zoneC: "#4CAF50",
};

/** Annotation defaults (m10), overridden by the Annotations card. */
const DEFAULT_PHASE_CHANGE_COLOR = "#616161";
const DEFAULT_TARGET_COLOR = "#7B1FA2";
const DEFAULT_LABEL_COLOR = "#333333";

/** Legend metrics (m16/m17). A horizontal legend wraps to multiple rows to fit the width. */
const LEGEND_COL = 130;   // vertical (left/right) column width
const LEGEND_ROW_H = 18;  // row height (horizontal wrap + vertical stack)
const LEGEND_GLYPH = 14;  // swatch width
const LEGEND_GAP = 6;     // glyph→label gap
const LEGEND_ITEM_GAP = 14; // gap between items in a row

// Rule-reference side panel (HTML layer): a compact reserved strip; CSS wraps the text to the
// width (so little blank space) and scrolls vertically when the rules don't fit the height.
const RR_PAD = 10;          // div padding (px)
const RULE_PANEL_W = 190;   // reserved strip width (px)

/** Rough on-screen width of a legend item (glyph + gap + ~6.5px/char label + trailing gap). */
function legendItemWidth(label: string): number {
    return LEGEND_GLYPH + LEGEND_GAP + label.length * 6.5 + LEGEND_ITEM_GAP;
}

/** Rows a horizontal legend needs when its items wrap within `availW`. */
function legendRowCount(items: LegendItem[], availW: number): number {
    let rows = 1, x = 0;
    for (const it of items) {
        const w = legendItemWidth(it.label);
        if (x > 0 && x + w > availW) { rows++; x = 0; }
        x += w;
    }
    return rows;
}

type Svg = d3.Selection<SVGSVGElement, unknown, null, undefined>;
type GSel = d3.Selection<SVGGElement, unknown, null, undefined>;
type YScale = d3.ScaleLinear<number, number>;

interface SegmentPixels {
    s: SpcStatistics;
    x0: number;
    x1: number;
    /** This segment's companion (dispersion) limits, for the MR/R/s panel. */
    companion?: CompanionPoint;
}

export function renderChart(
    svg: Svg, model: ChartModel, width: number, height: number, services?: ChartServices
): void {
    // Preserve the rule-panel scroll position across this re-render (data refresh, resize, format
    // change all rebuild the DOM). Read before the clear; restored after the panel is rebuilt.
    const prevPanel = svg.select<HTMLElement>(".spc-rule-panel").node();
    const prevPanelScroll = prevPanel ? prevPanel.scrollTop : 0;
    svg.selectAll("*").remove();
    const { points, limits, results, measureName } = model;
    if (points.length === 0 || width <= 0 || height <= 0) return;
    const formatValue = services?.formatValue ?? ((n: number) => String(n));

    // Per-field fallback (not `?? DEFAULT_COLORS`): a cleared swatch is "" — falsy but
    // not nullish — so coalesce each color individually to avoid an empty fill/stroke.
    const c = model.colors;
    const colors: ChartColors = {
        line: c?.line || DEFAULT_COLORS.line,
        violation: c?.violation || DEFAULT_COLORS.violation,
        limit: c?.limit || DEFAULT_COLORS.limit,
        center: c?.center || DEFAULT_COLORS.center,
        zoneA: c?.zoneA || DEFAULT_COLORS.zoneA,
        zoneB: c?.zoneB || DEFAULT_COLORS.zoneB,
        zoneC: c?.zoneC || DEFAULT_COLORS.zoneC,
    };
    const hc = model.isHighContrast === true;
    const showZones = model.showZones !== false;
    const showZoneLabels = model.showZoneLabels !== false;

    // Target/phase flags are needed early (they gate the legend entries + the Y-domain expansion).
    const drawTarget = model.showTargetLine !== false && points.some(p => p.target != null);
    const hasPhaseChange = !limits.singlePhase && model.showPhaseChangeLine !== false;

    // Reference key (m16): build the conditional items, then reserve an edge strip for it (the
    // legend is drawn on `svg`, outside `g`, so its text color is passed directly — not via the
    // g-scoped HC sweep). Swatch colors arrive already resolved (theme/HC) in `colors`/annotations.
    const legendColors: ChartColorSet = {
        ...colors,
        phaseChange: model.phaseChangeColor || DEFAULT_PHASE_CHANGE_COLOR,
        target: model.targetColor || DEFAULT_TARGET_COLOR,
        dataLabel: model.dataLabelColor || DEFAULT_LABEL_COLOR,
    };
    const legendItems = buildLegendItems({
        colors: legendColors, showZones, hasTarget: drawTarget, hasPhaseChange, isHighContrast: hc,
        measureName: measureName || "Data line", labels: model.legendLabels,
    });
    const legendPos = model.legendPosition ?? "top";
    const legendHoriz = legendPos === "top" || legendPos === "bottom";
    // Horizontal legend wraps within the full plot width → reserve a strip sized to the row count,
    // so it stays responsive as the figure resizes (instead of clipping a fixed single row).
    const legendAvailW = width - MARGIN.left - MARGIN.right;
    const candLegendH = legendHoriz ? legendRowCount(legendItems, legendAvailW) * LEGEND_ROW_H + 10 : 0;
    const candLegendW = legendHoriz ? 0 : LEGEND_COL;
    const roomForLegend = (height - MARGIN.top - MARGIN.bottom - candLegendH) >= 60
        && (width - MARGIN.left - MARGIN.right - candLegendW) >= 80;
    const showLegend = model.showLegend !== false && legendItems.length > 0 && roomForLegend;
    const legendH = showLegend ? candLegendH : 0;
    const legendW = showLegend ? candLegendW : 0;

    // Rule-reference panel: reserve a strip on its side (it sits beside the chart, never over it).
    // Skipped if reserving it would leave the plot too narrow — same spirit as roomForLegend.
    const rrPos = model.ruleReferencePosition ?? "right";
    const rrItems = model.ruleReferenceItems ?? [];
    const roomForRuleRef = (width - MARGIN.left - MARGIN.right - candLegendW - RULE_PANEL_W) >= 120
        && (height - MARGIN.top - MARGIN.bottom) >= 80;
    const showRuleRef = model.showRuleReference === true && rrItems.length > 0 && roomForRuleRef;
    const panelW = showRuleRef ? RULE_PANEL_W : 0;

    // Side reservations stack legend + panel when both land on the same side (panel outermost).
    const leftReserve = (showLegend && legendPos === "left" ? legendW : 0) + (showRuleRef && rrPos === "left" ? panelW : 0);
    const rightReserve = (showLegend && legendPos === "right" ? legendW : 0) + (showRuleRef && rrPos === "right" ? panelW : 0);
    const gx = MARGIN.left + leftReserve;
    const gy = MARGIN.top + (showLegend && legendPos === "top" ? legendH : 0);

    const innerW = width - MARGIN.left - MARGIN.right - leftReserve - rightReserve;
    const innerH = height - MARGIN.top - MARGIN.bottom - legendH;
    if (innerW <= 0 || innerH <= 0) return;

    // Split the height into the individuals chart (top) + MR companion panel (bottom). The MR
    // panel auto-hides when there are no moving ranges (< 2 points). The shared X axis lives on
    // whichever panel is bottom-most.
    const MR_GAP = 36; // room for the individuals chart's own X-axis labels above the MR panel
    const mrRatio = Math.min(0.5, Math.max(0.1, model.mrHeightRatio ?? 0.25));
    // Provisional split; only enable the MR panel when both panels clear a usable minimum —
    // otherwise (tiny viewport) fall back to the single full-height chart (no inverted scale).
    const mainHFull = (innerH - MR_GAP) * (1 - mrRatio);
    const mrHFull = (innerH - MR_GAP) * mrRatio;
    const mrEnabled = model.showMrChart !== false && points.some(p => p.movingRange != null)
        && mainHFull >= 40 && mrHFull >= 16;
    const mainH = mrEnabled ? mainHFull : innerH;
    const mrTop = mainH + MR_GAP;
    const mrH = innerH - mrTop;

    const g = svg.append("g").attr("transform", `translate(${gx},${gy})`);

    const x = d3.scalePoint<number>()
        .domain(points.map(p => p.index))
        .range([0, innerW])
        .padding(0.5);
    const xPos = (p: DataPoint) => x(p.index) ?? 0;

    // Y domain spans the control limits (both phases), the data, and (if drawn) the target.
    // (drawTarget computed above — it also gates the legend's Target entry.)
    const dataMin = d3.min(points, p => p.value) ?? 0;
    const dataMax = d3.max(points, p => p.value) ?? 0;
    const targetMin = drawTarget ? d3.min(points, p => p.target ?? undefined) : undefined;
    const targetMax = drawTarget ? d3.max(points, p => p.target ?? undefined) : undefined;
    // Span every point's own limits (per-point — generalizes the old two-phase min/max, and is
    // correct for varying-limit charts where limits step per point).
    const limMin = d3.min(limits.perPoint, s => s.lcl) ?? 0;
    const limMax = d3.max(limits.perPoint, s => s.ucl) ?? 0;
    const lower = Math.min(limMin, dataMin, targetMin ?? Infinity);
    const upper = Math.max(limMax, dataMax, targetMax ?? -Infinity);
    // Relative pad; on a flat domain (upper === lower) scale the pad to the value's magnitude
    // (an absolute 1 crushes small-magnitude flat data — e.g. a constant 2.5% rate).
    const pad = upper > lower ? (upper - lower) * 0.05 : (Math.abs(upper) * 0.1 || 1);
    const y = d3.scaleLinear().domain([lower - pad, upper + pad]).range([mainH, 0]);

    // Phase segments → pixel x-ranges; adjacent phases meet at the boundary midpoint.
    const segments: PhaseSegment[] = limits.segments;
    const midX = (i1: number, i2: number) => ((x(i1) ?? 0) + (x(i2) ?? 0)) / 2;
    const segPixels: SegmentPixels[] = segments.map((seg, i) => ({
        s: seg.stats,
        x0: i === 0 ? 0 : midX(seg.startIndex - 1, seg.startIndex),
        x1: i === segments.length - 1 ? innerW : midX(seg.endIndex, seg.endIndex + 1),
        // Companion limits are constant within a phase → read the segment's first point.
        companion: limits.companion?.limits[seg.startIndex - 1],
    }));

    // Zone fills are translucent → illegible in high contrast; drop them (labels still drawn).
    // Varying-limit charts (p/u) step per point; constant charts use the per-segment path.
    if (limits.varyingLimits) {
        if (showZones && !hc) drawSteppedZones(g, points, limits.perPoint, xPos, y, colors);
        drawSteppedLimits(g, points, limits.perPoint, xPos, y, colors);
    } else {
        if (showZones && !hc) drawZones(g, segPixels, y, colors);
        drawLimitLines(g, segPixels, y, colors);
    }

    // Reference-layer annotations: behind the data line/markers they annotate.
    if (model.showPhaseChangeLine !== false && !limits.singlePhase && segPixels.length > 1) {
        drawPhaseChangeLine(g, segPixels[1].x0, mainH, model.phaseChangeColor || DEFAULT_PHASE_CHANGE_COLOR);
    }
    if (drawTarget) {
        drawTargetLine(g, points, xPos, y, model.targetColor || DEFAULT_TARGET_COLOR);
    }

    // Each chart shows its own labelled X axis (the MR panel draws the bottom one too).
    drawAxes(g, x, y, points, mainH, formatValue, true);

    // .defined breaks the line at gap slots (value === null); d3.line does not auto-break on null.
    const line = d3.line<DataPoint>().defined(p => p.value !== null).x(xPos).y(p => y(p.value as number));
    g.append("path").datum(points).attr("class", "spc-line").attr("d", line)
        .attr("fill", "none").attr("stroke", colors.line).attr("stroke-width", 2);

    const realPoints = points.filter(p => p.value !== null);
    const pointSymbol = d3.symbol().type(symbolFor(model.pointShape, d3.symbolCircle)).size(30);
    const pointSel = g.selectAll<SVGPathElement, DataPoint>("path.spc-point").data(realPoints).join("path")
        .attr("class", "spc-point")
        .attr("transform", p => `translate(${xPos(p)},${y(p.value as number)})`)
        .attr("d", pointSymbol).attr("fill", colors.line);

    const violSel = drawMarkers(g, points, results, xPos, y, colors, symbolFor(model.violationShape, d3.symbolCircle));

    if (services?.tooltip) {
        const cb = tooltipCallback(model, services);
        services.tooltip.addTooltip(pointSel, cb);
        services.tooltip.addTooltip(violSel, cb);
    }

    if (showZones && showZoneLabels) drawZoneLabels(g, segPixels, y);

    const labelMode = model.dataLabelMode ?? "off";
    if (labelMode !== "off") {
        drawDataLabels(g, points, results, limits, xPos, y, mainH, formatValue, labelMode,
            model.dataLabelColor || DEFAULT_LABEL_COLOR);
    }

    if (measureName) {
        g.append("text")
            .attr("class", "spc-axis-title")
            .attr("transform", "rotate(-90)")
            .attr("x", -mainH / 2)
            .attr("y", -MARGIN.left + 12)
            .attr("text-anchor", "middle")
            .text(measureName);
    }

    const markerSels: MarkerSel[] = [pointSel, violSel];
    if (mrEnabled && mrH > 0 && limits.companion) {
        const mr = drawMrChart(g, points, limits.companion, limits.singlePhase, segPixels, x, xPos, mrTop, mrH, colors,
            formatValue, model.showPhaseChangeLine !== false,
            model.phaseChangeColor || DEFAULT_PHASE_CHANGE_COLOR,
            model.pointShape, model.violationShape);
        markerSels.push(mr.pointSel, mr.violSel);
        if (services?.tooltip) {
            const axisName = services.axisName;
            const mrCb = (p: DataPoint) => buildMrTooltipItems(p, limits, tooltipNumber, axisName);
            services.tooltip.addTooltip(mr.pointSel, mrCb);
            services.tooltip.addTooltip(mr.violSel, mrCb);
        }
    }

    // Cross-filtering across BOTH charts: MR markers share each point's selection identity, so
    // clicking on either chart highlights the same observation everywhere.
    wireSelection(svg, markerSels, services);

    // High contrast: marks already arrive pre-resolved (foreground/foregroundSelected); only the
    // CSS-driven axis/title/zone-label text needs overriding to foreground.
    if (hc) applyHighContrastText(g, model.foreground || "#000000");

    if (showLegend) {
        // A same-side rule panel sits outermost, so a left/right legend shifts inboard by panelW.
        const rrLeft = showRuleRef && rrPos === "left" ? panelW : 0;
        const rrRight = showRuleRef && rrPos === "right" ? panelW : 0;
        const rect = {
            // Left legend sits just inboard of any left panel so it clears the Y-axis label band;
            // right legend hugs the far edge, shifted in by any right panel.
            x: legendPos === "right" ? width - LEGEND_COL - rrRight : (legendPos === "left" ? rrLeft : gx),
            y: legendPos === "bottom" ? height - legendH : (legendPos === "top" ? MARGIN.top : gy),
            w: legendHoriz ? innerW : LEGEND_COL,
            h: legendHoriz ? legendH : innerH,
            horizontal: legendHoriz,
        };
        const legendText = hc ? (model.foreground || "#000000") : (model.legendTextColor || DEFAULT_LABEL_COLOR);
        drawLegend(svg, legendItems, rect, legendText, model.violationShape);
    }

    if (showRuleRef) {
        drawRuleReferencePanel(svg, rrItems, {
            x: rrPos === "right" ? width - panelW : 0,
            y: gy, w: panelW, h: innerH, side: rrPos,
            textColor: hc ? (model.foreground || "#000000") : (model.ruleReferenceTextColor || DEFAULT_LABEL_COLOR),
            dividerColor: hc ? (model.foreground || "#000000") : "#cccccc",
            scrollTop: prevPanelScroll,
        });
    }
}

/** Reference key (m16): swatch + label per visible SPC element, in a reserved edge strip. */
function drawLegend(
    svg: Svg, items: LegendItem[],
    rect: { x: number; y: number; w: number; h: number; horizontal: boolean },
    textColor: string, violationShape?: string
): void {
    // Isolate the legend from the svg-root selection handler (m11) so clicking the key doesn't
    // clear the chart's selection.
    const lg = svg.append("g").attr("class", "spc-legend")
        .on("click", (e: MouseEvent) => e.stopPropagation());
    let x = rect.x;
    let y = rect.y + LEGEND_ROW_H / 2;
    for (const item of items) {
        const w = legendItemWidth(item.label);
        // Horizontal: wrap to the next row when this item would overflow the strip width.
        if (rect.horizontal && x > rect.x && x + w > rect.x + rect.w) {
            x = rect.x;
            y += LEGEND_ROW_H;
        }
        drawLegendGlyph(lg, item, x, y, LEGEND_GLYPH, violationShape);
        lg.append("text").attr("class", "spc-legend-label")
            .attr("x", x + LEGEND_GLYPH + LEGEND_GAP).attr("y", y)
            .attr("dominant-baseline", "middle").attr("fill", textColor)
            .text(item.label);
        if (rect.horizontal) x += w;
        else y += LEGEND_ROW_H;
    }
}

/** One legend glyph: line/dashed segment, zone band swatch, or violation marker. */
function drawLegendGlyph(
    lg: GSel, item: LegendItem, x: number, cy: number, w: number, violationShape?: string
): void {
    if (item.glyph === "line" || item.glyph === "dashed") {
        const ln = lg.append("line").attr("x1", x).attr("x2", x + w).attr("y1", cy).attr("y2", cy)
            .attr("stroke", item.color).attr("stroke-width", 2);
        if (item.glyph === "dashed") ln.attr("stroke-dasharray", "4 3");
    } else if (item.glyph === "band") {
        // The real bands are ~0.15 opacity; the swatch is more opaque so it reads as a key.
        lg.append("rect").attr("x", x).attr("y", cy - 5).attr("width", w).attr("height", 10)
            .attr("fill", item.color).attr("opacity", 0.5);
    } else {
        lg.append("path")
            .attr("transform", `translate(${x + w / 2},${cy})`)
            .attr("d", d3.symbol().type(symbolFor(violationShape, d3.symbolCircle)).size(60)())
            .attr("fill", item.color);
    }
}

/**
 * Recolor the CSS-styled text/axis elements to the HC foreground. Must use inline `style`
 * (not `attr`): presentation attributes lose to the `fill`/`stroke` rules in visual.less,
 * whereas inline styles outrank the stylesheet.
 */
function applyHighContrastText(g: GSel, fg: string): void {
    g.selectAll<SVGTextElement, unknown>(".spc-axis text").style("fill", fg);
    g.selectAll<SVGElement, unknown>(".spc-axis path, .spc-axis line").style("stroke", fg);
    g.selectAll<SVGTextElement, unknown>(".spc-axis-title").style("fill", fg);
    g.selectAll<SVGTextElement, unknown>(".spc-zone-label").style("fill", fg);
}

function drawZones(g: GSel, segs: SegmentPixels[], y: YScale, colors: ChartColors): void {
    const band = (seg: SegmentPixels, lo: number, hi: number, color: string, opacity: number) => {
        const top = y(hi);
        const bottom = y(lo);
        g.append("rect")
            .attr("x", seg.x0).attr("width", Math.max(0, seg.x1 - seg.x0))
            .attr("y", top).attr("height", Math.max(0, bottom - top))
            .attr("fill", color).attr("opacity", opacity);
    };
    // Higher opacities than the Deneb spec (0.04–0.06): those were tuned for Vega
    // compositing and read as nearly blank as raw SVG fills over white.
    for (const seg of segs) {
        const s = seg.s;
        band(seg, s.zoneBLower, s.zoneBUpper, colors.zoneC, 0.18);
        band(seg, s.zoneBUpper, s.zoneAUpper, colors.zoneB, 0.14);
        band(seg, s.zoneALower, s.zoneBLower, colors.zoneB, 0.14);
        band(seg, s.zoneAUpper, s.ucl, colors.zoneA, 0.12);
        band(seg, s.lcl, s.zoneALower, colors.zoneA, 0.12);
    }
}

function drawLimitLines(g: GSel, segs: SegmentPixels[], y: YScale, colors: ChartColors): void {
    const hline = (seg: SegmentPixels, val: number, color: string) => {
        g.append("line")
            .attr("x1", seg.x0).attr("x2", seg.x1)
            .attr("y1", y(val)).attr("y2", y(val))
            .attr("stroke", color).attr("stroke-width", 1.5).attr("stroke-dasharray", "6 4");
    };
    for (const seg of segs) {
        hline(seg, seg.s.xBar, colors.center);
        hline(seg, seg.s.ucl, colors.limit);
        hline(seg, seg.s.lcl, colors.limit);
    }
}

/**
 * Stepped center/UCL/LCL for varying-limit charts (p, u): each point's limit drawn as a step
 * centered on its marker (`d3.curveStep` steps at the inter-point midpoints, so a limit lines up
 * under its point). Breaks at gaps via `.defined`. Limits indexed by point (perPoint aligned 1-based).
 */
function drawSteppedLimits(
    g: GSel, points: DataPoint[], perPoint: SpcStatistics[],
    xPos: (p: DataPoint) => number, y: YScale, colors: ChartColors
): void {
    const stepped = (pick: (s: SpcStatistics) => number, color: string) => {
        const line = d3.line<DataPoint>().defined(p => p.value !== null).curve(d3.curveStep)
            .x(xPos).y(p => y(pick(perPoint[p.index - 1])));
        g.append("path").datum(points).attr("d", line)
            .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5).attr("stroke-dasharray", "6 4");
    };
    stepped(s => s.xBar, colors.center);
    stepped(s => s.ucl, colors.limit);
    stepped(s => s.lcl, colors.limit);
}

/** Stepped zone bands for varying-limit charts — `d3.area` step-curves between per-point boundaries. */
function drawSteppedZones(
    g: GSel, points: DataPoint[], perPoint: SpcStatistics[],
    xPos: (p: DataPoint) => number, y: YScale, colors: ChartColors
): void {
    const band = (lo: (s: SpcStatistics) => number, hi: (s: SpcStatistics) => number, color: string, opacity: number) => {
        const area = d3.area<DataPoint>().defined(p => p.value !== null).curve(d3.curveStep)
            .x(xPos)
            .y0(p => y(lo(perPoint[p.index - 1])))
            .y1(p => y(hi(perPoint[p.index - 1])));
        g.append("path").datum(points).attr("d", area).attr("fill", color).attr("opacity", opacity);
    };
    band(s => s.zoneBLower, s => s.zoneBUpper, colors.zoneC, 0.18);
    band(s => s.zoneBUpper, s => s.zoneAUpper, colors.zoneB, 0.14);
    band(s => s.zoneALower, s => s.zoneBLower, colors.zoneB, 0.14);
    band(s => s.zoneAUpper, s => s.ucl, colors.zoneA, 0.12);
    band(s => s.lcl, s => s.zoneALower, colors.zoneA, 0.12);
}

/** Stepped target reference line; breaks across points with no target (`.defined`). */
function drawTargetLine(
    g: GSel, points: DataPoint[], xPos: (p: DataPoint) => number, y: YScale, color: string
): void {
    const line = d3.line<DataPoint>()
        .defined(p => p.target != null)
        .curve(d3.curveStepAfter)
        .x(xPos)
        .y(p => y(p.target as number));
    g.append("path").datum(points).attr("class", "spc-target-line").attr("d", line)
        .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "2 3");
}

/** Vertical indicator at the phase boundary (x already in pixels). */
function drawPhaseChangeLine(g: GSel, xBoundary: number, innerH: number, color: string): void {
    g.append("line")
        .attr("class", "spc-phase-change")
        .attr("x1", xBoundary).attr("x2", xBoundary)
        .attr("y1", 0).attr("y2", innerH)
        .attr("stroke", color).attr("stroke-width", 1.5).attr("stroke-dasharray", "4 4");
}

/**
 * Per-point value labels. Mode "all" → every point; "violations" → only flagged points.
 * Placement is best-effort (no collision solver): the label sits on the outer side of the
 * marker (above when above center, below when below) and the y is clamped in-bounds.
 */
function drawDataLabels(
    g: GSel, points: DataPoint[], results: PointRuleResult[], limits: LimitModel,
    xPos: (p: DataPoint) => number, y: YScale, innerH: number,
    formatValue: (n: number) => string, mode: DataLabelMode, color: string
): void {
    // Gap slots (value === null) never get a label (and never violate, so the "violations" branch
    // already excludes them); the "all" branch filters them out explicitly.
    const selected = (mode === "violations"
        ? points.filter((_, i) => results[i]?.violation)
        : points).filter(p => p.value !== null);
    const clamp = (v: number) => Math.max(10, Math.min(innerH - 4, v));
    g.selectAll("text.spc-data-label").data(selected).join("text")
        .attr("class", "spc-data-label")
        .attr("x", p => xPos(p))
        .attr("y", p => {
            // Place the label on the OUTER side (away from the center line, where the data
            // line and neighbouring points cluster): above-center → above, below-center → below.
            const aboveCenter = (p.value as number) >= limits.perPoint[p.index - 1].xBar;
            return clamp(y(p.value as number) + (aboveCenter ? -8 : 14));
        })
        .attr("text-anchor", "middle")
        .attr("fill", color)
        .text(p => formatValue(p.value as number));
}

/**
 * Rule-reference side panel: an opt-in strip beside the plot (never over it) listing every enabled
 * rule with its name and a fuller description. Rendered as an HTML layer inside an SVG foreignObject
 * so it scrolls natively (real scrollbar; wheel/drag/touch) when the rules don't fit the height, and
 * CSS wraps the text. A thin inboard border separates it from the chart. No filled background, so it
 * reads on any report theme (HC uses the foreground for text + border).
 */
function drawRuleReferencePanel(
    svg: Svg,
    items: { name: string; description: string }[],
    opts: {
        x: number; y: number; w: number; h: number;
        side: "left" | "right"; textColor: string; dividerColor: string; scrollTop?: number;
    }
): void {
    const fo = svg.append("foreignObject")
        .attr("x", opts.x).attr("y", opts.y).attr("width", opts.w).attr("height", opts.h);

    // overflow-y:auto → native scrollbar when the content exceeds the strip height. stopPropagation
    // on click so interacting with the panel doesn't clear the chart's cross-filter selection (m11).
    const div = fo.append("xhtml:div").attr("class", "spc-rule-panel")
        .style("box-sizing", "border-box")
        .style("width", "100%").style("height", "100%")
        .style("overflow-y", "auto").style("overflow-x", "hidden")
        .style("padding", `${RR_PAD}px`)
        .style("color", opts.textColor)
        .style(opts.side === "right" ? "border-left" : "border-right", `1px solid ${opts.dividerColor}`)
        .on("click", (e: MouseEvent) => e.stopPropagation());

    div.append("xhtml:div").attr("class", "spc-rule-panel-title").text("SPC rules");
    for (const r of items) {
        const item = div.append("xhtml:div").attr("class", "spc-rule-panel-item");
        item.append("xhtml:div").attr("class", "spc-rule-panel-name").text(r.name);
        item.append("xhtml:div").attr("class", "spc-rule-panel-desc").text(r.description);
    }

    // Restore the pre-render scroll position (the browser clamps to the new content height).
    if (opts.scrollTop) {
        const node = div.node() as HTMLElement | null;
        if (node) node.scrollTop = opts.scrollTop;
    }
}

function drawMarkers(
    g: GSel, points: DataPoint[], results: PointRuleResult[],
    xPos: (p: DataPoint) => number, y: YScale, colors: ChartColors, shape: d3.SymbolType
): d3.Selection<SVGPathElement, DataPoint, SVGGElement, unknown> {
    const marker = d3.symbol().type(shape).size(100);
    // Violations only fire on real points (rule 1 guards null; gap windows are rejected), so
    // p.value is non-null here.
    const violating = points.filter((_, i) => results[i]?.violation);
    return g.selectAll<SVGPathElement, DataPoint>("path.spc-violation").data(violating).join("path")
        .attr("class", "spc-violation")
        .attr("transform", p => `translate(${xPos(p)},${y(p.value as number)})`)
        .attr("d", marker)
        .attr("fill", colors.violation);
}

/**
 * Tooltip number formatter: the built-in SPC rows (value/center/UCL/LCL/target/MR) are rounded
 * to 2 decimal places — uniform, overriding the measure's format string — so they don't show
 * long floats. The Y axis and the user's "Tooltip measures" extras keep their own formatting.
 */
const tooltipNumber = (n: number) => Number.isFinite(n) ? n.toFixed(2) : "";

/** Tooltip delegate: built-in SPC items plus the user's "Tooltip measures" extras. */
function tooltipCallback(
    model: ChartModel, services: ChartServices
): (p: DataPoint) => VisualTooltipDataItem[] {
    const { formatExtra, axisName, measureName, targetName } = services;
    return (p: DataPoint) => [
        ...buildTooltipItems(p, model.results, model.limits, tooltipNumber, axisName, measureName, targetName),
        ...(p.tooltips ?? []).map(t => ({ displayName: t.displayName, value: formatExtra(t.value, t.format) })),
    ];
}

type MarkerSel = d3.Selection<SVGPathElement, DataPoint, SVGGElement, unknown>;
type ISelectionId = powerbi.extensibility.ISelectionId;

/**
 * Wire cross-filtering (m11/m13): click selects (Ctrl/⌘ multi-selects), background clears,
 * right-click opens the context menu, and on selection the unselected markers + both data lines
 * (individuals + MR) dim (limits, zones, center, and annotations stay full so the SPC frame stays
 * readable). `markers` spans BOTH charts — MR markers share each point's identity, so a click on
 * either chart cross-filters the same observation. No-op when not interactive. Selection persists
 * across re-renders via getSelectionIds().
 *
 * Clear/context-menu are attached to the SVG ROOT and rely on bubbling: any click NOT on a point
 * bubbles up to the svg and clears. Points call stopPropagation so they select (and right-click
 * shows the point menu) without also triggering the background handler. A sibling background rect
 * would NOT work — clicks on the zone rects / line never reach a sibling, only an ancestor.
 */
function wireSelection(svg: Svg, markers: MarkerSel[], services?: ChartServices): void {
    const sm = services?.selectionManager;
    if (!sm || !services?.allowInteractions) return;

    const applySelectionDim = (ids: ISelectionId[]) => {
        const active = ids.length > 0;
        for (const sel of markers) {
            sel.attr("opacity", (d: DataPoint) =>
                !active || (d.identity && ids.some(id =>
                    d.identity!.equals(id as powerbi.visuals.ISelectionId))) ? 1 : 0.3);
        }
        // Each data line is a single path → dim the whole line when a selection is active
        // (the selected marker stays solid on top). Limits/zones/center are left untouched.
        svg.selectAll(".spc-line, .spc-mr-line").attr("opacity", active ? 0.3 : 1);
    };

    for (const sel of markers) {
        sel.style("cursor", "pointer")
            .on("click", (e: MouseEvent, d: DataPoint) => {
                if (!d.identity) return;
                e.stopPropagation();
                sm.select(d.identity, e.ctrlKey || e.metaKey).then(ids => applySelectionDim(ids));
            })
            .on("contextmenu", (e: MouseEvent, d: DataPoint) => {
                if (!d.identity) return;
                e.preventDefault();
                e.stopPropagation(); // else the svg-root handler overwrites with the empty menu
                sm.showContextMenu(d.identity, { x: e.clientX, y: e.clientY });
            });
    }

    svg.on("click", () => { sm.clear().then(() => applySelectionDim([])); })
        .on("contextmenu", (e: MouseEvent) => {
            e.preventDefault();
            sm.showContextMenu({} as ISelectionId, { x: e.clientX, y: e.clientY });
        });

    // Reflect any selection persisted across this re-render (e.g. after a format-pane change).
    applySelectionDim(sm.getSelectionIds());
}

/** Three "A"/"B"/"C" labels at the right edge of the last phase's upper bands. */
function drawZoneLabels(g: GSel, segs: SegmentPixels[], y: YScale): void {
    const seg = segs[segs.length - 1];
    const s = seg.s;
    const xr = seg.x1 - 4;
    const put = (lo: number, hi: number, text: string) => {
        g.append("text")
            .attr("class", "spc-zone-label")
            .attr("x", xr).attr("y", y((lo + hi) / 2))
            .attr("text-anchor", "end").attr("dominant-baseline", "middle")
            .text(text);
    };
    put(s.xBar, s.zoneBUpper, "C");
    put(s.zoneBUpper, s.zoneAUpper, "B");
    put(s.zoneAUpper, s.ucl, "A");
}

function drawAxes(
    g: GSel, x: d3.ScalePoint<number>, y: YScale, points: DataPoint[], innerH: number,
    formatValue: (n: number) => string, showXAxis = true, yTickCount?: number
): void {
    if (showXAxis) {
        const step = Math.max(1, Math.ceil(points.length / MAX_X_TICKS));
        const tickIndices = points.filter((_, i) => i % step === 0).map(p => p.index);
        const labelByIndex = new Map(points.map(p => [p.index, p.label]));
        g.append("g")
            .attr("class", "spc-axis spc-axis-x")
            .attr("transform", `translate(0,${innerH})`)
            .call(d3.axisBottom(x)
                .tickValues(tickIndices)
                .tickFormat(i => labelByIndex.get(i as number) ?? ""));
    }
    const yAxis = d3.axisLeft(y).tickFormat(d => formatValue(d as number));
    if (yTickCount != null) yAxis.ticks(yTickCount);
    g.append("g").attr("class", "spc-axis spc-axis-y").call(yAxis);
}

/**
 * Moving-range companion panel (m13): a connected line + points of the moving range, with the
 * phase-aware stepped MR center / UCL lines (LCL = 0 is the baseline) and beyond-UCL violation
 * markers. Drawn in a sub-group offset to (0, mrTop); shares the individuals X scale and owns the
 * bottom labelled X axis. Marks use the already-resolved palette (theme/HC apply).
 */
function drawMrChart(
    g: GSel, points: DataPoint[], companion: CompanionModel, singlePhase: boolean, segPixels: SegmentPixels[],
    x: d3.ScalePoint<number>, xPos: (p: DataPoint) => number, mrTop: number, mrH: number,
    colors: ChartColors, formatValue: (n: number) => string,
    showPhaseChange: boolean, phaseChangeColor: string,
    pointShape?: string, violationShape?: string
): { pointSel: MarkerSel; violSel: MarkerSel } {
    const mrG = g.append("g").attr("transform", `translate(0,${mrTop})`);

    // Y domain: 0 .. max(companion UCL across phases, max companion value) + pad (so violations
    // don't clip). All limits come from the CompanionModel — no reach into the primary phase stats.
    const maxUcl = d3.max(segPixels, s => s.companion?.ucl ?? 0) ?? 0;
    const maxMr = d3.max(companion.value, v => v ?? undefined) ?? 0;
    const upper = Math.max(maxUcl, maxMr);
    const pad = upper > 0 ? upper * 0.05 : 1; // all-zero MR (flat data) has no magnitude → 1
    const mrY = d3.scaleLinear().domain([0, upper + pad]).range([mrH, 0]);

    // Stepped companion center + UCL per phase segment (reusing the shared x-ranges; LCL = 0 baseline).
    for (const seg of segPixels) {
        const lines: [number, string][] = [[seg.companion?.center ?? 0, colors.center], [seg.companion?.ucl ?? 0, colors.limit]];
        for (const [val, color] of lines) {
            mrG.append("line")
                .attr("x1", seg.x0).attr("x2", seg.x1)
                .attr("y1", mrY(val)).attr("y2", mrY(val))
                .attr("stroke", color).attr("stroke-width", 1.5).attr("stroke-dasharray", "6 4");
        }
    }

    // Phase-change indicator, mirroring the individuals chart (the MR limits step here too).
    if (showPhaseChange && !singlePhase && segPixels.length > 1) {
        drawPhaseChangeLine(mrG, segPixels[1].x0, mrH, phaseChangeColor);
    }

    drawAxes(mrG, x, mrY, points, mrH, formatValue, true, 3);

    // MR line breaks at the null first point; markers only where a moving range exists.
    const withMr = points.filter(p => p.movingRange != null);
    const line = d3.line<DataPoint>().defined(p => p.movingRange != null)
        .x(xPos).y(p => mrY(p.movingRange as number));
    mrG.append("path").datum(points).attr("class", "spc-mr-line").attr("d", line)
        .attr("fill", "none").attr("stroke", colors.line).attr("stroke-width", 2);

    const pointSymbol = d3.symbol().type(symbolFor(pointShape, d3.symbolCircle)).size(30);
    const pointSel = mrG.selectAll<SVGPathElement, DataPoint>("path.spc-mr-point").data(withMr).join("path")
        .attr("class", "spc-mr-point")
        .attr("transform", p => `translate(${xPos(p)},${mrY(p.movingRange as number)})`)
        .attr("d", pointSymbol).attr("fill", colors.line);

    const viol = companionViolations(companion);
    const violating = points.filter((_, i) => viol[i]);
    const marker = d3.symbol().type(symbolFor(violationShape, d3.symbolCircle)).size(100);
    const violSel = mrG.selectAll<SVGPathElement, DataPoint>("path.spc-mr-violation").data(violating).join("path")
        .attr("class", "spc-mr-violation")
        .attr("transform", p => `translate(${xPos(p)},${mrY(p.movingRange as number)})`)
        .attr("d", marker).attr("fill", colors.violation);

    mrG.append("text")
        .attr("class", "spc-axis-title")
        .attr("transform", "rotate(-90)")
        .attr("x", -mrH / 2)
        .attr("y", -MARGIN.left + 12)
        .attr("text-anchor", "middle")
        .text("Moving Range");

    return { pointSel, violSel };
}

/** Centered empty-state / prompt message (e.g. when no fields are bound). */
export function renderMessage(svg: Svg, text: string, width: number, height: number): void {
    svg.selectAll("*").remove();
    if (width <= 0 || height <= 0) return;
    svg.append("text")
        .attr("class", "spc-message")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .text(text);
}
