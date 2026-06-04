# Support — SPC Control Chart

## Getting help
- **Report a bug or request a feature:** open an issue →
  <https://github.com/vijaykoju/spcControlChart/issues>
- **Email:** vjk8736@gmail.com

## When reporting a problem, please include
- What you expected vs. what happened (a screenshot helps)
- Your **Power BI version** (Desktop build or Service)
- The **shape of your data** — the axis field type (date/category) and a rough row count
- Steps to reproduce, and any error shown in the visual

## Usage notes
- Bind an **Axis (date or category)** and a **Measurement**; the visual computes all SPC statistics
  internally — no DAX required.
- Pick the **chart type** in **Format → Chart** (individuals, attribute p/np/c/u, subgroup X̄-R/X̄-s,
  or time-weighted EWMA/MA/CUSUM). Attribute and subgroup charts also need a **Sample size** field,
  and X̄-R/X̄-s need a **Subgroup range or std dev** field.
- To show gaps for missing periods, enable **"Show items with no data"** on the Axis field so Power
  BI delivers the blank rows.
- See the project [README](README.md) and [`docs/`](docs/) for feature details, target-measure
  patterns, and edge-case notes.

Support is provided on a best-effort basis.
