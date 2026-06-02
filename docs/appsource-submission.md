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
  console calls.")*

### File / tooling gates
- ✅ `package.json` has `typescript`, `eslint`, `eslint-plugin-powerbi-visuals`; real `description`
  + `repository`; an `eslint` lint script.
- ✅ Project `.gitignore` excludes `node_modules`, `.tmp`, `dist`.
- ✅ **Latest API + latest `powerbi-visuals-tools`.** Cert requires the *latest*, not a minimum.
  Bumped `powerbi-visuals-api` → `~5.11.0` (was `~5.3.0`) and `pbiviz.json` `apiVersion` → `5.11.0`;
  pbiviz tools already at the latest 7.1.0. Re-verified clean: dedup, standalone `tsc`, `npm test`
  (70), `pbiviz package`. **Re-check "latest" again at submission** (the floor moves over time).
- ⬜ **`npm audit`** returns no **high/moderate** advisories.
- ⬜ `pbiviz package --certification-audit` (pbiviz ≥6.1.0) reports clean. *(Only use
  `--certification-fix` for forbidden calls inside third-party libs you don't control, then update
  the `package` script to avoid a hash mismatch — never to mask our own code.)*
- ⬜ **ESLint script form under ESLint 9.** The doc's example is `"eslint": "npx eslint . --ext
  .js,.jsx,.ts,.tsx"`, but we're on ESLint ^9 (flat config), where `--ext` was removed and globs
  live in `eslint.config.*`. Confirm the form reviewers expect before submitting.

### Repo structure (cert prerequisite)
- ✅ **Single-visual repository.** This repo (`spcControlChart`) contains code for *one visual only* —
  split out of the larger `spc-control-chart` dashboard project (which held the Power Query / DAX /
  CSV). Verified self-contained: `npm install`, `npm test` (70), and `pbiviz package` all pass here.
- ⬜ **Push to a hosting provider** (e.g. GitHub) so the Power BI team can review it.
- ⬜ **`certification` branch** (lowercase) whose source exactly matches the submitted `.pbiviz`
  (create it from the commit you build the submitted package from).
- ⬜ If private, create a review account with 2FA + recovery codes and grant **read-only** access to
  [`pbicvsupport`](https://github.com/pbicvsupport).

---

## Listing assets & account (user provides)
- ⬜ **Partner Center** publisher account.
- ⬜ **Support URL** — a real, working `https` page. *(Currently a placeholder in `pbiviz.json`:
  `https://example.com/spc-control-chart`.)*
- ⬜ **Privacy policy URL** — a Partner Center *listing* field (not in the package).
- ⬜ **Icons / screenshots** — 20×20 package icon (present and verified: `assets/icon.png`, 20×20 px),
  plus a marketing icon and screenshots for the listing.
- ⬜ **Long description** for the AppSource listing.
- ⬜ **Sample `.pbix`** demonstrating the visual (use the project's sample data; the cert team also
  references the official SPC sample dataset).

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
