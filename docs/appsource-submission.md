# AppSource submission & certification checklist

How to get this visual onto **AppSource** and (optionally) **certified**. Two separate tracks:

- **Listing** (AppSource via Partner Center) — makes the visual installable from the marketplace.
- **Certification** — a stricter Microsoft source review. Certified visuals can be **exported to
  PowerPoint/PDF**, shown in subscription emails, and used in tenants locked to "certified only."
  Certification is optional and is requested *after* (or alongside) a Partner Center listing.

Requirements below are from Microsoft Learn, *"Get your Power BI visuals certified"* (the page is
updated periodically — **re-verify at submission time**, along with the API changelog).

---

## Repo-side readiness (what m18 covers)

These are the gates we control in source. ✅ = done in-repo; ⬜ = open.

### Runtime / source-code gates (cert "Not allowed" list)
- ✅ No external services/resources — `externalJS: null`, no `fetch`/CDN/`http(s)` in `src/`.
- ✅ No `XMLHttpRequest` / `fetch`.
- ✅ No `eval()` / `Function()` / unsafe `setTimeout`/`setInterval`/`requestAnimationFrame`.
- ✅ No `innerHTML` / `D3.html(user data)` — DOM text set via D3 `.text()` only.
- ✅ `privileges: []` in `capabilities.json` (no Web Access).
- ✅ Supports the **Rendering Events API** (`renderingStarted` / `renderingFinished` /
  `renderingFailed` in `visual.ts`).
- ✅ No `console` output from our code (removed in m18).
- ⬜ **No JS errors/exceptions in the console for *any* input data** — verify by running every
  input class in [`edge-cases.md`](edge-cases.md) (empty, all-null, single point, large, wrong
  type) with the browser console open. *(This is the actual cert wording, broader than "no
  console calls." `--certification-audit` checks source patterns, not runtime over all inputs, so this
  stays a manual Desktop pass.)*

### File / tooling gates
- ✅ `package.json` has `typescript`, `eslint`, `eslint-plugin-powerbi-visuals`; real `description`
  + `repository`; an `eslint` lint script.
- ✅ Project `.gitignore` excludes `node_modules`, `.tmp`, `dist`.
- ✅ **Latest API + latest `powerbi-visuals-tools`.** Cert requires the *latest*, not a minimum.
  Bumped `powerbi-visuals-api` → `~5.11.0` (was `~5.3.0`) and `pbiviz.json` `apiVersion` → `5.11.0`;
  pbiviz tools already at the latest 7.1.0. Re-verified clean: dedup, standalone `tsc`, `npm test`
  (124), `pbiviz package`. **Re-check "latest" again at submission** (the floor moves over time).
- ✅ **`npm audit`** — 0 vulnerabilities (verified 2026-06).
- ✅ `pbiviz package --certification-audit` (pbiviz ≥6.1.0) — clean: "Certificate is valid", "No
  external requests found", build OK (verified 2026-06). *(Only use `--certification-fix` for
  forbidden calls inside third-party libs you don't control, then update the `package` script to avoid
  a hash mismatch — never to mask our own code.)*
- ✅ **ESLint script under ESLint 9.** Use `npm run lint` (`npx eslint .` — flat-config form; globs
  live in `eslint.config.*`). Passes clean. The old `--ext` script (removed in v9) was deleted.

### Repo structure (cert prerequisite)
- ✅ **Single-visual repository.** This repo (`spcControlChart`) contains code for *one visual only* —
  split out of the larger `spc-control-chart` dashboard project (which held the Power Query / DAX /
  CSV). Verified self-contained: `npm install`, `npm test` (124), and `pbiviz package` all pass here.
- ✅ **Pushed to a hosting provider** — public at <https://github.com/vijaykoju/spcControlChart>.
- ⬜ **`certification` branch** (lowercase) whose source exactly matches the submitted `.pbiviz`
  (create it from the commit you build the submitted package from).
- ✅ **Repo is public** → no review-account / `pbicvsupport` access needed (that's only for private repos).

---

## Listing assets & account (user provides)
- ⬜ **Partner Center** publisher account.
- ✅ **Support URL** — set in `pbiviz.json` to the repo's [`SUPPORT.md`](../SUPPORT.md)
  (`https://github.com/vijaykoju/spcControlChart/blob/main/SUPPORT.md`); `gitHubUrl` also set.
- ⬜ **Privacy policy URL** — a Partner Center *listing* field (not in the package). `PRIVACY.md`
  exists in-repo; use its blob URL: `https://github.com/vijaykoju/spcControlChart/blob/main/PRIVACY.md`.
- ⬜ **Icons / screenshots** — 20×20 package icon (present and verified: `assets/icon.png`, 20×20 px),
  plus a marketing icon (300×300 PNG) and 1–5 screenshots (1280×720). See the shot-list below.
- ⬜ **Long description** for the AppSource listing — draft below.
- ⬜ **Sample `.pbix`** demonstrating the visual — build it from
  [`test-data/demo-sample.csv`](test-data/demo-sample.csv) following [`demo-guide.md`](demo-guide.md)
  (chart list + field bindings). The cert team also references the official SPC sample dataset.

---

## Listing copy (draft — review before submitting)

**Suggested listing name:** SPC Control Charts *(plural — it's now a multi-family visual; a branding
call, not required)*.

**Summary (short):** Statistical process control charts for Power BI — individuals, attribute,
subgroup, and time-weighted — with Western Electric rules. No DAX required.

**Long description:**

> **SPC Control Charts** brings rigorous statistical process control to Power BI — no DAX required.
> Bind an axis and a measurement, pick a chart type in the Format pane, and the visual computes the
> control limits, detects the signals, and flags out-of-control points for you.
>
> One visual, the full control-chart family:
> - **Individuals (X-mR)** — with a moving-range companion panel and automatic phase / changepoint detection.
> - **Attribute charts** — p, np, c, u — for defect proportions and counts, with per-point limits for varying sample sizes.
> - **Subgroup charts** — X̄-R and X̄-s — each with a range / standard-deviation companion panel.
> - **Time-weighted charts** — EWMA, moving average, and CUSUM — to catch the small, sustained shifts an individuals chart misses.
>
> Signal detection uses the eight **Western Electric / Nelson rules**, applied correctly per chart type
> and individually toggleable, with an on-chart **rule reference** that explains each signal in plain
> language. Plus zone shading, a bound target line, native tooltips, click cross-filtering, report-theme
> color, and high-contrast support.
>
> Whether you're monitoring manufacturing quality, healthcare outcomes, service-level metrics, or any
> repeated measurement over time, it turns a column of numbers into a decision-ready control chart.

**Screenshot shot-list (1280×720; pick 3–5):**
1. **Hero** — Individuals (X-mR) with the MR panel, a flagged violation, and a tooltip showing the rule reason. (The core value in one frame.)
2. **Rule reference** — the on-chart panel open, listing enabled rules + plain-language reasons. (The differentiator.)
3. **Breadth** — a p-chart (stepped per-point limits) or an X̄-R with its companion panel. (Shows it's multi-family.)
4. **Advanced** — CUSUM (two arms about ±H) or EWMA with the faint raw-reading overlay. (Small-shift detection.)
5. **Configurable / no-DAX** — the Format pane showing the chart-type selector + Chart Parameters. (Ease of use.)

---

## Submission steps
1. `npm install` → no errors.
2. `pbiviz package` (and `pbiviz package --certification-audit`) → no errors / clean audit.
3. `npm audit` → no high/moderate.
4. Partner Center → create a **"Power BI visual"** offer → upload the `.pbiviz` + listing assets →
   submit for validation → publish to AppSource.
5. (Optional) Request certification: Partner Center → Product setup → **Request Power BI
   certification**; in "Notes for certification" provide the **source repo link**, the
   `certification` branch, and access credentials.

> **Timeline:** AppSource availability within hours, but ~10–14 days to reach Desktop/Service
> production; the certification badge appears within ~3 weeks of approval.

## Caveats
- Microsoft's exact requirements, steps, and the "latest" API version **change over time** —
  re-verify against the current cert doc + API changelog when you submit.
- Certification is **optional**; the `.pbiviz` already works via "Import a visual from a file"
  today (uncertified).
