/**
 * Extract the (axis, measure, tooltips) series from a Power BI categorical dataView.
 * Pure — no d3, no powerbi runtime — so it unit-tests in the Node harness.
 */

import type powerbi from "powerbi-visuals-api";
import { TooltipField } from "./spc/types";

type PrimitiveValue = powerbi.PrimitiveValue;

export interface SeriesPoint {
    label: string;
    value: number | null;
    tooltips?: TooltipField[];
    /** Bound target for this point; null = no target (kept; never drops the row). */
    target?: number | null;
    /** Bound sample size (nᵢ) for attribute charts; null = blank/invalid; undefined = unbound. */
    sampleSize?: number | null;
    /** Bound subgroup range/std dev for X̄-R/X̄-s; null = blank; undefined = unbound. */
    spread?: number | null;
    /** Original categorical row index (pre-sort) — for building the selection id. */
    categoryIndex: number;
}

/** True if a measure is bound (by role; or, for a no-roles dataView, any value column). */
export function hasMeasureColumn(dataView: powerbi.DataView | undefined): boolean {
    const values = dataView?.categorical?.values;
    if (!values || values.length === 0) return false;
    if (Array.from(values).some(c => c.source?.roles?.measure)) return true;
    return !Array.from(values).some(c => c.source?.roles); // no roles at all → first column is the measure
}

/**
 * Returns the series in observation order, or [] when the axis or a measure is unbound.
 * - The measure column is selected BY ROLE (the `values` group now also holds tooltip
 *   columns); falls back to values[0] only for a no-roles dataView.
 * - Tooltip-field values are extracted WITH each row so they stay aligned through the sort.
 * - Value coercion is explicit (null/blank/non-number → NaN, dropped downstream; never 0).
 * - Date/number single-column axes are sorted ascending; text or hierarchy axes keep order.
 */
export function extractSeries(dataView: powerbi.DataView): SeriesPoint[] {
    const categories = dataView?.categorical?.categories;
    const valueCols = dataView?.categorical?.values;
    if (!categories || categories.length === 0 || !valueCols || !hasMeasureColumn(dataView)) return [];

    const cols = Array.from(valueCols);
    const measure = cols.find(c => c.source?.roles?.measure) ?? cols[0];
    const tooltipCols = cols.filter(c => c.source?.roles?.tooltips);
    const targetCol = cols.find(c => c.source?.roles?.target);
    const sampleSizeCol = cols.find(c => c.source?.roles?.sampleSize);
    const spreadCol = cols.find(c => c.source?.roles?.spread);

    const primary = categories[0];
    const meas = measure.values ?? [];
    const n = Math.min(primary.values?.length ?? 0, meas.length);

    const type = primary.source?.type;
    const isDate = !!type?.dateTime;
    const isNumeric = !!(type?.numeric || type?.integer);
    const orderable = categories.length === 1 && (isDate || isNumeric);

    const pairs: { key: number; label: string; value: number | null; tooltips?: TooltipField[]; target?: number | null; sampleSize?: number | null; spread?: number | null; categoryIndex: number }[] = [];
    for (let i = 0; i < n; i++) {
        const m = meas[i];
        // Blank/non-numeric measure → null (a gap slot kept on the axis), NOT dropped.
        const value = typeof m === "number" && Number.isFinite(m) ? m : null;
        const label = categories.length === 1
            ? formatValue(primary.values[i], isDate)
            : categories.map(c => formatValue(c.values?.[i], false)).join(" / ");
        const tooltips = tooltipCols.length
            ? tooltipCols.map(c => ({
                displayName: c.source?.displayName ?? "",
                value: c.values?.[i] ?? null,
                format: c.source?.format,
            }))
            : undefined;
        // Target null = "no target here" (point kept, line breaks); not a row drop.
        const t = targetCol?.values?.[i];
        const target = targetCol ? (typeof t === "number" && Number.isFinite(t) ? t : null) : undefined;
        // Sample size (attribute charts); blank/non-numeric → null (the strategy treats ≤0/null as a gap).
        const ss = sampleSizeCol?.values?.[i];
        const sampleSize = sampleSizeCol ? (typeof ss === "number" && Number.isFinite(ss) ? ss : null) : undefined;
        const sp = spreadCol?.values?.[i];
        const spread = spreadCol ? (typeof sp === "number" && Number.isFinite(sp) ? sp : null) : undefined;
        pairs.push({ key: orderable ? orderKey(primary.values[i], isDate) : i, value, label, tooltips, target, sampleSize, spread, categoryIndex: i });
    }

    if (orderable) pairs.sort((a, b) => a.key - b.key);

    return pairs.map(p => ({ label: p.label, value: p.value, tooltips: p.tooltips, target: p.target, sampleSize: p.sampleSize, spread: p.spread, categoryIndex: p.categoryIndex }));
}

/** Numeric sort key; unparseable values sort last (stable, deterministic). */
function orderKey(raw: PrimitiveValue, isDate: boolean): number {
    if (isDate) {
        const t = raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime();
        return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
    }
    const num = typeof raw === "number" ? raw : Number(raw);
    return Number.isNaN(num) ? Number.POSITIVE_INFINITY : num;
}

/** Distinguishing label: dates as LOCAL YYYY-MM-DD (no UTC shift), else String(). */
function formatValue(raw: PrimitiveValue, isDate: boolean): string {
    if (raw === null || raw === undefined) return "";
    const asDate = raw instanceof Date ? raw : isDate ? new Date(raw as string | number) : null;
    if (asDate && !Number.isNaN(asDate.getTime())) {
        const y = asDate.getFullYear();
        const m = String(asDate.getMonth() + 1).padStart(2, "0");
        const d = String(asDate.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }
    return String(raw);
}
