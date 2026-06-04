/*
 *  SPC Control Chart — Power BI custom visual.
 */
"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { createTooltipServiceWrapper, ITooltipServiceWrapper } from "powerbi-visuals-utils-tooltiputils";
import { valueFormatter } from "powerbi-visuals-utils-formattingutils";
import * as d3 from "d3";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;

import { VisualFormattingSettingsModel } from "./settings";
import { buildDataPoints } from "./spc/statistics";
import { evaluateRules, RULES } from "./spc/rules";
import { STRATEGIES } from "./spc/strategies";
import { limitsFromModel } from "./spc/chartType";
import { extractSeries, hasMeasureColumn } from "./extractData";
import { renderChart, renderMessage, ChartServices } from "./rendering/chart";
import { toStatsOpts, toChangepointOptions, toEnabledRules, applicableEnabledRules, toDataLabelMode, toMrChartOptions, toLegendPosition, toSidePosition, toChartType } from "./settingsMap";
import { resolveChartColors } from "./theme";

/** Stable palette key for the themed data-line default (so it doesn't shift with the measure name). */
const THEME_LINE_KEY = "spcLine";

/** Message for the empty state, naming what's missing where possible. A leading line nudges users
 *  to pick the chart type (in Format) first; the `\n` renders as a second line. */
function emptyMessage(dataView: DataView | undefined): string {
    const hasAxis = !!dataView?.categorical?.categories?.length;
    const hasMeasure = hasMeasureColumn(dataView);
    const lead = "SPC Chart\nPick a Chart type in the Format panel,\nthen add ";
    if (!hasAxis && !hasMeasure) return `${lead}an axis field and a measurement`;
    if (!hasAxis) return `${lead}an axis field`;
    if (!hasMeasure) return `${lead}a measurement`;
    return "No valid data points";
}

/** True when a values column is bound to the given role (for required-role validation). */
function roleBound(dataView: DataView | undefined, role: string): boolean {
    return !!dataView?.categorical?.values?.some(v => v.source?.roles?.[role]);
}

const CHART_TYPE_LABELS: Record<string, string> = {
    individuals: "Individuals chart", p: "p-chart", np: "np-chart", c: "c-chart", u: "u-chart",
    "xbar-r": "X̄-R chart", "xbar-s": "X̄-s chart", ewma: "EWMA chart", ma: "Moving-average chart",
    cusum: "CUSUM chart",
};
const chartTypeLabel = (id: string) => CHART_TYPE_LABELS[id] ?? "This chart";
const ROLE_LABELS: Record<string, string> = {
    sampleSize: "Sample size", spread: "Subgroup range or std dev",
};
const roleLabel = (role: string) => ROLE_LABELS[role] ?? role;

export class Visual implements IVisual {
    private events: IVisualEventService;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private tooltip: ITooltipServiceWrapper;
    private host: IVisualHost;
    private selectionManager: ISelectionManager;
    private allowInteractions: boolean;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.events = options.host.eventService;
        this.formattingSettingsService = new FormattingSettingsService();
        this.formattingSettings = new VisualFormattingSettingsModel();
        this.tooltip = createTooltipServiceWrapper(options.host.tooltipService, options.element);
        this.selectionManager = options.host.createSelectionManager();
        this.allowInteractions = options.host.hostCapabilities.allowInteractions !== false;
        this.svg = d3.select(options.element).append("svg");
    }

    public update(options: VisualUpdateOptions) {
        this.events.renderingStarted(options);
        const dataView = options.dataViews?.[0];

        // Settings drive rendering, so parse them FIRST — but fall back to a default
        // model on error so a settings problem can never blank the chart.
        try {
            this.formattingSettings = dataView
                ? this.formattingSettingsService.populateFormattingSettingsModel(
                      VisualFormattingSettingsModel, dataView)
                : new VisualFormattingSettingsModel();
        } catch {
            // A settings problem must never blank the chart — fall back to defaults.
            this.formattingSettings = new VisualFormattingSettingsModel();
        }

        try {
            const { width, height } = options.viewport;
            this.svg.attr("width", width).attr("height", height);

            const rawPoints = dataView ? buildDataPoints(extractSeries(dataView)) : [];
            const s = this.formattingSettings;
            const strategy = STRATEGIES[toChartType(String(s.chart.chartType.value.value))];
            // The full context (stats + changepoint + time-weighted params) is built up front because
            // build and validate all consume it.
            const ctx = {
                opts: toStatsOpts(s.controlLimits.sigmaMultiplier.value, s.controlLimits.floorLcl.value),
                changepoint: toChangepointOptions(
                    s.phaseDetection.enableDetection.value,
                    s.phaseDetection.significanceThreshold.value,
                    s.phaseDetection.minSegment.value,
                    s.phaseDetection.useManualChangepoint.value,
                    s.phaseDetection.manualChangepoint.value,
                ),
                ewmaLambda: s.chartParameters.ewmaLambda.value,
                maWindow: s.chartParameters.maWindow.value,
                cusumK: s.chartParameters.cusumK.value,
                cusumH: s.chartParameters.cusumH.value,
            };
            // Attribute charts need a Sample size (p/np/u) — prompt rather than render wrong limits.
            const missingRole = (strategy.requiredRoles ?? []).find(r => !roleBound(dataView, r));
            // Gaps (blank-measure rows) are kept as slots, so length > 0 no longer implies drawable
            // data — require at least one real (non-null) value, else show the empty state.
            const hasData = rawPoints.some(p => p.value !== null);
            // The strategy derives the plotted series AND its limits in one pass — but only once there
            // is data and the required roles are bound, so build never runs on empty input.
            const built = hasData && !missingRole ? strategy.build(rawPoints, ctx) : null;
            const points = built?.points ?? [];
            if (!hasData) {
                renderMessage(this.svg, emptyMessage(dataView), width, height);
            } else if (missingRole) {
                renderMessage(this.svg, `${chartTypeLabel(strategy.id)} needs a ${roleLabel(missingRole)} field`, width, height);
            } else if (!points.some(p => p.value !== null)) {
                // e.g. a p/u chart whose sample sizes are all ≤ 0 / blank → every point gapped.
                renderMessage(this.svg, "No valid sample sizes", width, height);
            } else if (strategy.validate?.(points, ctx)) {
                // Per-type validation: subgroup size out of range, bad EWMA λ / MA window, etc.
                renderMessage(this.svg, strategy.validate(points, ctx)!, width, height);
            } else {
                const limits = built!.limits; // non-null here (hasData && !missingRole)
                // A chart type can only fire rules that apply to it.
                const enabledRules = applicableEnabledRules(
                    toEnabledRules(s.rules.ruleToggles.map(t => t.value)), strategy.applicableRules);
                const results = evaluateRules(points, limitsFromModel(limits), enabledRules);
                const a = s.appearance;

                // Axis/tooltip name + number-format for the PLOTTED statistic: p/u plot a
                // proportion/rate, so they override the count measure's name + (integer) format.
                const values = dataView?.categorical?.values;
                const measureCol = values?.find(v => v.source?.roles?.measure) ?? values?.[0];
                const measureName = strategy.valueLabel ?? measureCol?.source?.displayName ?? "Value";
                const valueFormat = strategy.valueFormat ?? measureCol?.source?.format;
                const axisName = dataView?.categorical?.categories?.[0]?.source?.displayName ?? "Axis";
                const targetName = values?.find(v => v.source?.roles?.target)?.source?.displayName ?? "Target";
                const services = this.buildServices(valueFormat, axisName, measureName, targetName);
                const an = s.annotations;
                const mr = toMrChartOptions(s.mrChart.showMrChart.value, s.mrChart.heightRatio.value);
                const lg = s.legend;
                const rr = s.ruleReference;
                // The panel lists only the rules that can actually fire (enabled), in id order.
                const ruleReferenceItems = RULES
                    .filter(r => enabledRules.has(r.id))
                    .map(r => ({ name: r.name, description: r.description }));

                // Theming (m12): theme the line default (synced to the pane), then resolve the
                // final palette — high-contrast overrides everything; normal is a passthrough.
                const palette = this.host.colorPalette;
                const isHC = palette.isHighContrast;
                const lineUserSet = !!dataView?.metadata?.objects?.appearance?.lineColor;
                if (!isHC && !lineUserSet) {
                    a.lineColor.value.value = palette.getColor(THEME_LINE_KEY).value;
                }
                // Default the rule-reference + legend text to the theme foreground so they're legible
                // on light AND dark report backgrounds (both draw on the bare background). Honors a
                // user-picked color; HC supplies its own foreground in the renderer.
                const rrTextUserSet = !!dataView?.metadata?.objects?.ruleReference?.textColor;
                if (!isHC && !rrTextUserSet) {
                    rr.textColor.value.value = palette.foreground.value;
                }
                const legendTextUserSet = !!dataView?.metadata?.objects?.legend?.textColor;
                if (!isHC && !legendTextUserSet) {
                    lg.textColor.value.value = palette.foreground.value;
                }
                const colors = resolveChartColors({
                    isHighContrast: isHC,
                    foreground: palette.foreground.value,
                    foregroundSelected: palette.foregroundSelected.value,
                    format: {
                        line: a.lineColor.value.value,
                        violation: a.violationColor.value.value,
                        limit: a.limitColor.value.value,
                        center: a.centerColor.value.value,
                        zoneA: a.zoneAColor.value.value,
                        zoneB: a.zoneBColor.value.value,
                        zoneC: a.zoneCColor.value.value,
                        phaseChange: an.phaseChangeColor.value.value,
                        target: an.targetColor.value.value,
                        dataLabel: an.dataLabelColor.value.value,
                    },
                });

                // Attach a selection id to each point (keyed on its ORIGINAL category row).
                const categories = dataView?.categorical?.categories;
                if (categories && categories.length > 0) {
                    for (const p of points) p.identity = this.buildIdentity(categories, p.categoryIndex);
                }

                renderChart(this.svg, {
                    points, limits, results,
                    measureName,
                    colors: {
                        line: colors.line,
                        violation: colors.violation,
                        limit: colors.limit,
                        center: colors.center,
                        zoneA: colors.zoneA,
                        zoneB: colors.zoneB,
                        zoneC: colors.zoneC,
                    },
                    showZones: a.showZones.value,
                    zonesMeaningful: strategy.zonesMeaningful,
                    showRawReadings: s.chartParameters.showRaw.value,
                    // Raw overlay (dots + Y-domain) applies only to charts that overlay raw on a
                    // smoothed line; CUSUM also sets baseValue but on a cumulative scale, so gate it out.
                    allowRawOverlay: strategy.id === "ewma" || strategy.id === "ma",
                    rawColor: s.chartParameters.rawColor.value.value,
                    rawOpacity: s.chartParameters.rawOpacity.value / 100,
                    rawSize: s.chartParameters.rawSize.value,
                    showZoneLabels: a.showZoneLabels.value,
                    violationShape: String(a.violationShape.value.value),
                    pointShape: String(a.pointShape.value.value),
                    pointSize: a.pointSize.value,
                    pointOpacity: a.pointOpacity.value / 100,
                    showPhaseChangeLine: an.showPhaseChangeLine.value,
                    phaseChangeColor: colors.phaseChange,
                    showTargetLine: an.showTargetLine.value,
                    targetColor: colors.target,
                    dataLabelMode: toDataLabelMode(String(an.dataLabels.value.value)),
                    dataLabelColor: colors.dataLabel,
                    isHighContrast: isHC,
                    foreground: palette.foreground.value,
                    showMrChart: mr.show,
                    mrHeightRatio: mr.ratio,
                    showLegend: lg.show.value,
                    legendPosition: toLegendPosition(String(lg.position.value.value)),
                    legendTextColor: lg.textColor.value.value,
                    legendLabels: {
                        dataLine: lg.labelDataLine.value,
                        center: lg.labelCenter.value,
                        limits: lg.labelLimits.value,
                        zoneA: lg.labelZoneA.value,
                        zoneB: lg.labelZoneB.value,
                        zoneC: lg.labelZoneC.value,
                        violation: lg.labelViolation.value,
                        target: lg.labelTarget.value,
                        phaseChange: lg.labelPhaseChange.value,
                    },
                    showRuleReference: rr.show.value,
                    ruleReferencePosition: toSidePosition(String(rr.position.value.value)),
                    ruleReferenceTextColor: rr.textColor.value.value,
                    ruleReferenceItems,
                }, width, height, services);
            }
            this.events.renderingFinished(options);
        } catch (error) {
            this.events.renderingFailed(options, String(error));
        }
    }

    /**
     * Build the render-time services: the tooltip wrapper plus value formatters that
     * honor the measure's format string (Y axis + tooltip) and each tooltip field's own
     * format. The formatter is NOT seeded with a `value` — that would activate display-unit
     * rounding (K/M/B), which can collapse distinct SPC values (value/center/UCL/LCL) into
     * identical strings. Full precision matters more than compactness on a control chart.
     */
    private buildServices(
        measureFormat: string | undefined, axisName: string, measureName: string, targetName: string
    ): ChartServices {
        const measureFmt = valueFormatter.create({ format: measureFormat });
        const formatValue = (n: number) => measureFmt.format(n);

        // Memoize a formatter per distinct tooltip-field format string (built lazily on hover).
        const extraFmts = new Map<string, ReturnType<typeof valueFormatter.create>>();
        const formatExtra = (value: powerbi.PrimitiveValue, format?: string): string => {
            if (value === null || value === undefined) return "";
            if (typeof value !== "number") return String(value);
            const key = format ?? "";
            let f = extraFmts.get(key);
            if (!f) { f = valueFormatter.create({ format }); extraFmts.set(key, f); }
            return f.format(value);
        };

        return {
            tooltip: this.tooltip, formatValue, formatExtra, axisName, measureName, targetName,
            selectionManager: this.selectionManager, allowInteractions: this.allowInteractions,
        };
    }

    /** Composite selection id over every category level at the point's original row index. */
    private buildIdentity(
        categories: DataViewCategoryColumn[], categoryIndex: number
    ): powerbi.visuals.ISelectionId {
        let builder = this.host.createSelectionIdBuilder();
        for (const cat of categories) builder = builder.withCategory(cat, categoryIndex);
        return builder.createSelectionId();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
