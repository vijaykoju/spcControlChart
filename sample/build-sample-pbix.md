# Building the sample `.pbix`

A `.pbix` is a packaged binary that only **Power BI Desktop** can author, so this is a short manual
build. Everything around it is prepared here: the dataset (`spc_mortality_data.csv`) and a Target
measure. The result is a one-page report that exercises every headline feature of the visual.

## What this sample demonstrates
`spc_mortality_data.csv` is 48 months of a (synthetic) mortality rate, with patterns injected to
trip specific SPC rules:

| Period | Pattern | Expected rule |
|--------|---------|---------------|
| ~Month 10 | Spike to ~4.5% | **Rule 1** — beyond limits |
| Months 20–27 | Sustained shift up (~3.0%) | **Rule 4** — run on one side; drives the **changepoint** |
| Months 35–42 | Deterministic ramp (~2.6 → 3.5) | **Rule 5** — trend |

So the chart shows a **two-phase split** (auto-detected around the shift), violation markers, the
MR panel, and — with the measure below — a **target line**.

## Prerequisites
- Power BI Desktop (the project was built against the May 2026 build).
- The visual installed: build it once (`npm run package` → `dist/*.pbiviz`) or use a `dist` you
  already have.

## Steps

1. **Import the visual.** Desktop → *Visualizations* pane → `...` → **Import a visual from a file**
   → pick `dist/spcControlChart....pbiviz`.

2. **Load the data.** *Home* → **Get data** → **Text/CSV** → select
   `sample/spc_mortality_data.csv` → **Load**. Confirm `Month` is typed as **Date** and
   `MortalityRate` as **Decimal number** (fix in Power Query if needed).

3. **Add the SPC visual** to the canvas and bind the field wells:
   - **Axis (date or category)** ← `Month`
   - **Measurement** ← `MortalityRate`
     *(One row per month, so the default `Sum` aggregation equals the monthly value — leave it.)*

   The chart should render with zones, control limits, a phase split near the shift, and red
   violation markers at the spike / run / trend.

4. *(Optional but recommended for the listing)* **Add a target line.** Create a measure and drag it
   to the **Target** well:
   ```DAX
   Target = 2.75
   ```
   For a *stepped* target that changes at the phase boundary (shows off time-varying targets), see
   [`../docs/target-measures.md`](../docs/target-measures.md) for ready-to-paste patterns.

5. *(Optional)* **Tooltip extras** — drag any measure (e.g. a count) into **Tooltip measures** to
   show it appears in the hover tooltip.

6. **Tour the format pane** (so the screenshot shows the range): toggle **Legend** position,
   **MR Chart** on/off, individual **Rules**, **Phase Detection** (try a manual changepoint), and
   **Appearance** colors / marker shapes.

7. **Save As** → `spc-control-chart-sample.pbix`.

## Where the `.pbix` goes
The `.pbix` is a **listing asset for Partner Center**, not a source file — **don't commit the binary
to this repo**. Keep it alongside your submission materials. (This `sample/` folder holds only the
*source* dataset + this guide, which double as the certification "test dataset.")
