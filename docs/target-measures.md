# Authoring Target measures

The SPC Control Chart visual has a **Target** field well. Drop a measure into it and the
visual draws a dashed reference line at the target. Because the visual evaluates the measure
**once per axis point**, the target can change over time: when the returned value differs
between points, the line is drawn as a **step** (it holds flat across a period and jumps at the
boundary). Periods where the measure returns `BLANK()` leave a gap (no interpolation) — by design.

This means a single measure can express **different targets for different time frames**
(per calendar year, per fiscal year, or arbitrary date ranges). The visual just displays
whatever the measure returns; you own the target logic.

> Replace `'spc_mortality_data'[Month]` below with your own date table/column. CSV import
> usually keeps the file name as the table name and `Month` as the date column — check the
> Fields pane.

---

## Option A — inline `SWITCH` (a few fixed periods)

No extra table. Good for 2–4 hard-coded years:

```DAX
Target =
SWITCH (
    YEAR ( MAX ( 'spc_mortality_data'[Month] ) ),
    2023, 2.8,
    2024, 2.7,
    2025, 2.6,
    2026, 2.5,
    BLANK ()          -- periods with no target → line breaks (gap)
)
```

For a **fiscal** year that doesn't match the calendar year, switch on a fiscal-year column
instead. If you don't have one, derive it — e.g. an FY starting in October:

```DAX
FiscalYear = YEAR ( 'Calendar'[Date] ) + IF ( MONTH ( 'Calendar'[Date] ) >= 10, 1, 0 )
```

---

## Option B — a Targets table + lookup (recommended)

A small table anyone can edit; no measure rewrite when targets change. This is the intended
pattern — the user defines the time points and target values, the visual displays them.

1. **Home → Enter data**, name the table `Targets`, paste (grid accepts comma/tab paste):

   ```
   Year,TargetValue
   2023,2.8
   2024,2.7
   2025,2.6
   2026,2.5
   ```

   Set `TargetValue` to **Decimal number** (Enter Data sometimes guesses text).

2. Measure (no relationship required — it derives the year from the axis date per point):

   ```DAX
   Target =
   LOOKUPVALUE (
       Targets[TargetValue],
       Targets[Year], YEAR ( MAX ( 'spc_mortality_data'[Month] ) )
   )
   ```

---

## Option C — arbitrary date ranges (targets that change mid-year)

When breakpoints aren't whole years, store start/end dates and match the point's date.
`Targets` table with `StartDate`, `EndDate`, `TargetValue`:

```DAX
Target =
VAR _d = MAX ( 'spc_mortality_data'[Month] )   -- the current axis point's date
RETURN
    CALCULATE (
        MAX ( Targets[TargetValue] ),
        FILTER ( Targets, Targets[StartDate] <= _d && _d <= Targets[EndDate] )
    )
```

---

## Two things to get right

- **Same date context.** The field in the **Axis** well and the column the measure reads
  (`[Year]` / `[Date]` / `[FiscalYear]`) must come from the same calendar, so each point
  resolves to the correct period. `MAX`/`SELECTEDVALUE` work because each axis point is one
  observation (e.g. one month).
- **Gaps are intentional.** Return `BLANK()` for periods with no target — the visual breaks the
  stepped line there rather than interpolating across the gap.

## Sample (matches `spc_mortality_data.csv`)

The sample spans 2023–2026 with rates ~2.2–3.5. The Option B table above (2.8 → 2.7 → 2.6 →
2.5) gives a visible year-over-year improvement goal that steps down each January without
distorting the Y axis.
