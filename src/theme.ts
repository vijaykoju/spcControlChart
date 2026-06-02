/**
 * Resolve the final chart colors from the format-pane values and the host palette.
 * Pure (no d3/powerbi runtime) so it's harness-testable.
 *
 * - High contrast: render entirely with the HC palette — every mark + text in `foreground`,
 *   violations in `foregroundSelected` (kept distinct). Zone fills are dropped by the renderer.
 * - Normal: passthrough — the report-theme default for the line is already baked into
 *   `format.line` by visual.ts (so the format pane and the chart stay in sync).
 */

export interface ChartColorSet {
    line: string;
    violation: string;
    limit: string;
    center: string;
    zoneA: string;
    zoneB: string;
    zoneC: string;
    phaseChange: string;
    target: string;
    dataLabel: string;
}

export interface ResolveColorsInput {
    isHighContrast: boolean;
    foreground: string;
    foregroundSelected: string;
    format: ChartColorSet;
}

export function resolveChartColors(input: ResolveColorsInput): ChartColorSet {
    const { format } = input;
    if (!input.isHighContrast) return { ...format };

    const fg = input.foreground;
    return {
        line: fg,
        violation: input.foregroundSelected,
        limit: fg,
        center: fg,
        zoneA: fg,
        zoneB: fg,
        zoneC: fg,
        phaseChange: fg,
        target: fg,
        dataLabel: fg,
    };
}
