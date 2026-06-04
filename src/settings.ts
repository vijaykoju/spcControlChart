/*
 *  SPC Control Chart — format-pane settings model.
 */
"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { RULES } from "./spc/rules";

import Card = formattingSettings.SimpleCard;
import Model = formattingSettings.Model;
import NumUpDown = formattingSettings.NumUpDown;
import ToggleSwitch = formattingSettings.ToggleSwitch;
import ColorPicker = formattingSettings.ColorPicker;
import ItemDropdown = formattingSettings.ItemDropdown;
import TextInput = formattingSettings.TextInput;

const Min = powerbi.visuals.ValidatorType.Min;

/** Chart-type options (values must match ChartType / toChartType). */
const CHART_TYPE_ITEMS: powerbi.IEnumMember[] = [
    { value: "individuals", displayName: "Individuals (X-mR)" },
    { value: "p", displayName: "p (proportion defective)" },
    { value: "np", displayName: "np (number defective)" },
    { value: "c", displayName: "c (count of defects)" },
    { value: "u", displayName: "u (defects per unit)" },
    { value: "xbar-r", displayName: "X̄-R (mean & range)" },
    { value: "xbar-s", displayName: "X̄-s (mean & std dev)" },
];

/** Marker shape options (keys must match the SYMBOLS map in chart.ts). */
const SHAPE_ITEMS: powerbi.IEnumMember[] = [
    { value: "circle", displayName: "Circle" },
    { value: "diamond", displayName: "Diamond" },
    { value: "square", displayName: "Square" },
    { value: "triangle", displayName: "Triangle" },
    { value: "cross", displayName: "Cross" },
    { value: "star", displayName: "Star" },
];

/** Data-label modes (values must match toDataLabelMode / DataLabelMode in chart.ts). */
const DATA_LABEL_ITEMS: powerbi.IEnumMember[] = [
    { value: "off", displayName: "Off" },
    { value: "all", displayName: "All points" },
    { value: "violations", displayName: "Violations only" },
];

/** Legend positions (values must match toLegendPosition in settingsMap.ts). */
const LEGEND_POSITION_ITEMS: powerbi.IEnumMember[] = [
    { value: "top", displayName: "Top" },
    { value: "bottom", displayName: "Bottom" },
    { value: "left", displayName: "Left" },
    { value: "right", displayName: "Right" },
];

/** Side positions for the rule-reference panel (values must match toSidePosition). */
const SIDE_POSITION_ITEMS: powerbi.IEnumMember[] = [
    { value: "right", displayName: "Right" },
    { value: "left", displayName: "Left" },
];

class ChartCard extends Card {
    chartType = new ItemDropdown({
        name: "chartType", displayName: "Chart type",
        description: "Which SPC control chart to draw.",
        items: CHART_TYPE_ITEMS, value: { value: "individuals", displayName: "Individuals (X-mR)" },
    });
    name = "chart";
    displayName = "Chart";
    slices = [this.chartType];
}

class ControlLimitsCard extends Card {
    sigmaMultiplier = new NumUpDown({
        name: "sigmaMultiplier",
        displayName: "Sigma multiplier",
        description: "Control-limit width in sigmas. Also scales the A/B/C zones (thirds of the limit) that the rules test against.",
        value: 3,
        options: { minValue: { type: Min, value: 0.5 } },
    });
    floorLcl = new ToggleSwitch({
        name: "floorLcl",
        displayName: "Floor LCL at zero",
        value: true,
    });
    name = "controlLimits";
    displayName = "Control Limits";
    slices = [this.sigmaMultiplier, this.floorLcl];
}

class PhaseDetectionCard extends Card {
    enableDetection = new ToggleSwitch({
        name: "enableDetection",
        displayName: "Enable auto-detection",
        value: true,
    });
    significanceThreshold = new NumUpDown({
        name: "significanceThreshold",
        displayName: "Significance threshold",
        value: 3,
        options: { minValue: { type: Min, value: 0 } },
    });
    minSegment = new NumUpDown({
        name: "minSegment",
        displayName: "Minimum segment size",
        value: 10,
        options: { minValue: { type: Min, value: 10 } },
    });
    useManualChangepoint = new ToggleSwitch({
        name: "useManualChangepoint",
        displayName: "Use manual changepoint",
        value: false,
    });
    manualChangepoint = new NumUpDown({
        name: "manualChangepoint",
        displayName: "Manual changepoint",
        value: 2,
        options: { minValue: { type: Min, value: 2 } },
    });
    name = "phaseDetection";
    displayName = "Phase Detection";
    slices = [
        this.enableDetection, this.significanceThreshold, this.minSegment,
        this.useManualChangepoint, this.manualChangepoint,
    ];
}

class RulesCard extends Card {
    // One toggle per rule, labelled by its name (single source: RULES). name = "ruleN".
    ruleToggles = RULES.map(r => new ToggleSwitch({
        name: `rule${r.id}`,
        displayName: r.name,
        value: true,
    }));
    name = "rules";
    displayName = "Rules";
    slices = this.ruleToggles;
}

class RuleReferenceCard extends Card {
    show = new ToggleSwitch({
        name: "show",
        displayName: "Show rule reference",
        description: "Show a side panel listing the enabled rules. It reserves space beside the chart (it does not cover it). The per-point tooltip always explains a flagged point regardless of this setting.",
        value: false,
    });
    position = new ItemDropdown({
        name: "position", displayName: "Position",
        items: SIDE_POSITION_ITEMS, value: { value: "right", displayName: "Right" },
    });
    textColor = new ColorPicker({ name: "textColor", displayName: "Text", value: { value: "#333333" } });
    name = "ruleReference";
    displayName = "Rule Reference";
    // `show` is the card's enable toggle → the host hides the rest when the panel is off.
    topLevelSlice = this.show;
    slices = [this.position, this.textColor];
}

class AppearanceCard extends Card {
    lineColor = new ColorPicker({ name: "lineColor", displayName: "Data line", value: { value: "#1976D2" } });
    violationColor = new ColorPicker({ name: "violationColor", displayName: "Violation marker", value: { value: "#D32F2F" } });
    limitColor = new ColorPicker({ name: "limitColor", displayName: "Control limits", value: { value: "#D32F2F" } });
    centerColor = new ColorPicker({ name: "centerColor", displayName: "Center line", value: { value: "#388E3C" } });
    zoneAColor = new ColorPicker({ name: "zoneAColor", displayName: "Zone A", value: { value: "#F44336" } });
    zoneBColor = new ColorPicker({ name: "zoneBColor", displayName: "Zone B", value: { value: "#FF9800" } });
    zoneCColor = new ColorPicker({ name: "zoneCColor", displayName: "Zone C", value: { value: "#4CAF50" } });
    violationShape = new ItemDropdown({
        name: "violationShape", displayName: "Violation marker shape",
        items: SHAPE_ITEMS, value: { value: "circle", displayName: "Circle" },
    });
    pointShape = new ItemDropdown({
        name: "pointShape", displayName: "Data point shape",
        items: SHAPE_ITEMS, value: { value: "circle", displayName: "Circle" },
    });
    showZones = new ToggleSwitch({ name: "showZones", displayName: "Show zone shading", value: true });
    showZoneLabels = new ToggleSwitch({ name: "showZoneLabels", displayName: "Show zone labels", value: false });
    name = "appearance";
    displayName = "Appearance";
    slices = [
        this.lineColor, this.violationColor, this.limitColor, this.centerColor,
        this.zoneAColor, this.zoneBColor, this.zoneCColor,
        this.violationShape, this.pointShape, this.showZones, this.showZoneLabels,
    ];
}

class AnnotationsCard extends Card {
    showPhaseChangeLine = new ToggleSwitch({ name: "showPhaseChangeLine", displayName: "Show phase-change line", value: true });
    phaseChangeColor = new ColorPicker({ name: "phaseChangeColor", displayName: "Phase-change line", value: { value: "#616161" } });
    showTargetLine = new ToggleSwitch({ name: "showTargetLine", displayName: "Show target line", value: true });
    targetColor = new ColorPicker({ name: "targetColor", displayName: "Target line", value: { value: "#7B1FA2" } });
    dataLabels = new ItemDropdown({
        name: "dataLabels", displayName: "Data labels",
        items: DATA_LABEL_ITEMS, value: { value: "off", displayName: "Off" },
    });
    dataLabelColor = new ColorPicker({ name: "dataLabelColor", displayName: "Data label text", value: { value: "#333333" } });
    name = "annotations";
    displayName = "Annotations";
    slices = [
        this.showPhaseChangeLine, this.phaseChangeColor, this.showTargetLine, this.targetColor,
        this.dataLabels, this.dataLabelColor,
    ];
}

class MrChartCard extends Card {
    showMrChart = new ToggleSwitch({ name: "showMrChart", displayName: "Show moving range chart", value: true });
    heightRatio = new NumUpDown({
        name: "heightRatio",
        displayName: "MR chart height ratio",
        description: "Fraction of the plot height given to the moving-range panel (clamped 0.1–0.5).",
        value: 0.25,
        options: { minValue: { type: Min, value: 0.1 } },
    });
    name = "mrChart";
    displayName = "MR Chart";
    // `showMrChart` is the card's enable toggle → the host hides heightRatio when the MR chart is off.
    topLevelSlice = this.showMrChart;
    slices = [this.heightRatio];
}

/** One renameable legend entry. Empty value → the default (placeholder hint); see buildLegendItems. */
function legendLabel(name: string, displayName: string, placeholder: string): formattingSettings.TextInput {
    return new TextInput({ name, displayName, value: "", placeholder });
}

class LegendCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show legend", value: true });
    position = new ItemDropdown({
        name: "position", displayName: "Position",
        items: LEGEND_POSITION_ITEMS, value: { value: "top", displayName: "Top" },
    });
    textColor = new ColorPicker({ name: "textColor", displayName: "Legend text", value: { value: "#333333" } });
    // Per-entry label overrides (m17). The data-line default is the measure name (resolved at
    // render), so its placeholder is generic.
    labelDataLine = legendLabel("labelDataLine", "Data line label", "Measure name");
    labelCenter = legendLabel("labelCenter", "Center label", "Center (x̄)");
    labelLimits = legendLabel("labelLimits", "Control limits label", "Control limits");
    labelZoneA = legendLabel("labelZoneA", "Zone A label", "Zone A");
    labelZoneB = legendLabel("labelZoneB", "Zone B label", "Zone B");
    labelZoneC = legendLabel("labelZoneC", "Zone C label", "Zone C");
    labelViolation = legendLabel("labelViolation", "Violation label", "Violation");
    labelTarget = legendLabel("labelTarget", "Target label", "Target");
    labelPhaseChange = legendLabel("labelPhaseChange", "Phase change label", "Phase change");
    name = "legend";
    displayName = "Legend";
    // `show` is the card's enable toggle → the host hides the rest when the legend is off.
    topLevelSlice = this.show;
    slices = [
        this.position, this.textColor,
        this.labelDataLine, this.labelCenter, this.labelLimits,
        this.labelZoneA, this.labelZoneB, this.labelZoneC,
        this.labelViolation, this.labelTarget, this.labelPhaseChange,
    ];
}

export class VisualFormattingSettingsModel extends Model {
    chart = new ChartCard();
    controlLimits = new ControlLimitsCard();
    phaseDetection = new PhaseDetectionCard();
    rules = new RulesCard();
    ruleReference = new RuleReferenceCard();
    annotations = new AnnotationsCard();
    mrChart = new MrChartCard();
    legend = new LegendCard();
    appearance = new AppearanceCard();
    cards = [this.chart, this.controlLimits, this.phaseDetection, this.rules, this.ruleReference, this.annotations, this.mrChart, this.legend, this.appearance];
}
