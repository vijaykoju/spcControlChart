# SPC rule reference (Western Electric / Nelson)

The visual evaluates eight rules at every point. A point is a **violation** (red marker) when *any*
enabled rule fires on it. Each rule can be toggled in the **Rules** card of the format pane. The
logic lives in `src/spc/rules.ts`; this document explains what each rule detects, why it matters,
and the specifics of how it's implemented here.

> **In the visual:** hovering a flagged point lists the rules that tripped *it*, each with a short
> reason — so you usually don't need this doc to read a single point. For an always-on catalogue of
> the enabled rules, turn on **Rule Reference** in the format pane (off by default); it shows as a
> side panel (Right or Left) that reserves space beside the chart rather than covering it, and
> scrolls when the visual is too short to show every rule. This document remains the deeper
> reference (zone math, edge cases, implementation notes).

## Zones and the control band

The chart is an X-mR (individuals & moving-range) control chart. Around the center line (x̄) the
band up to the control limits is split into three zones, each a third of the band:

| Zone | Distance from x̄ (default) | Meaning |
|------|---------------------------|---------|
| **C** | 0 – 1σ | normal scatter, nearest the center line |
| **B** | 1σ – 2σ | |
| **A** | 2σ – 3σ | nearest the control limits |
| beyond | > 3σ | outside the control limits (UCL / LCL) |

> The "default" column assumes the **Control limits ▸ Sigma multiplier** of **3**. The zones always
> scale as thirds of the band, so at multiplier *m* the boundaries are at *m*/3·σ, 2*m*/3·σ, and *m*·σ.
> σ is estimated from the average moving range (σ = MR̄ / 1.128), the standard X-mR method.

## Reading the chart: bands vs. violation markers

The colored **Zone A / Zone B / Zone C bands** are *reference shading* — they show *where* each zone
sits, nothing more. The red **Violation** dot is separate: it marks points that trip one of the eight
rules below. Two consequences that surprise people:

- **A point landing in the Zone A or Zone B band is not, by itself, a violation.** The zone rules
  fire on *clusters* (2 of 3 in Zone A; 4 of 5 in Zone B), not on a single point drifting into the
  band — a lone excursion into Zone A/B is normal scatter. So an unflagged point sitting in the
  orange or red band is expected, not a missed violation.
- **Markers track the rules, not the bands.** A point near the center line (Zone C) *can* be flagged
  — e.g. as part of a 7-in-a-row run on one side (Rule 4) — while a point further out in Zone B
  *isn't*, because no 4-of-5 cluster formed around it. Read a red dot as "this point completes one of
  the eight patterns," never as "this point is in a bad zone."

A related effect: a rule fires on the point that **completes** its count, so the **leading points of a
qualifying cluster go unmarked**. A rising group that climbs into Zone B only starts flagging once 4
of the last 5 are in Zone B — the climb into it isn't flagged, just as the Run rule fires on the 7th
consecutive point, not the 1st.

## Conventions shared by all rules

- **The flagged point participates in the pattern.** The violation always lands on a point that is
  itself part of what triggered the rule — never on an in-control point that merely follows extremes.
- **Phase-aware.** Each point is compared against *its own phase's* statistics. When changepoint
  detection splits the series, the center line, zones, and run/trend logic reset at the boundary.
- **Gaps break windows.** A blank-measure row is kept as an empty slot. Any windowed rule that would
  span a gap cannot fire across it (there is no run of *N* consecutive real observations), and the
  moving range is not bridged.
- **Flat-data guard.** If a phase has zero variation (σ = 0 — every value identical), the zone/run
  rules (2, 3, 4, 7) are suppressed so a perfectly flat line isn't flagged. (Rules 1, 5, 6, 8 are
  naturally unaffected.)
- **Near the start of the series**, a rule needing *N* points can't fire until *N* points exist.

---

## Rule 1 — Beyond Limits

**Detects:** a single point beyond the control limits (above UCL or below LCL).

**Why it matters:** a point past 3σ is the classic out-of-control signal — a large, sudden
deviation that's very unlikely from normal process variation alone.

**Implementation:** tests the current point only, with a **strict** comparison (`value > UCL` or
`value < LCL`); a point sitting exactly on a limit does not fire. Phase-aware. Not subject to the
flat-data guard (a strict comparison can't trip on flat data).

---

## Rule 2 — Zone A (2 of 3)

**Detects:** **2 out of 3** consecutive points in **Zone A or beyond**, on the **same side** of the
center line.

**Why it matters:** catches a moderate shift that hasn't produced a single beyond-limit point but
has pushed several recent points far toward one limit.

**Implementation:** window of 3 ending at the current point. The current point must **itself** be in
Zone A (or beyond) on the side that reaches the count of 2 — so the marker lands on the genuinely
extreme point, not on an in-control point that happens to follow two extremes. Phase-aware;
suppressed on flat data.

---

## Rule 3 — Zone B (4 of 5)

**Detects:** **4 out of 5** consecutive points in **Zone B or beyond**, on the **same side**.

**Why it matters:** a smaller, more sustained shift than Rule 2 — many recent points clustered
beyond 1σ on one side, even if none reach Zone A.

**Implementation:** window of 5 ending at the current point, same "current point must be in the
signaling zone" requirement as Rule 2 (here, in Zone B or beyond on the counting side). Phase-aware;
suppressed on flat data.

---

## Rule 4 — Run Above/Below

**Detects:** **7 consecutive** points all on the **same side** of the center line (all above, or all
below x̄).

**Why it matters:** in a stable process, points scatter randomly above and below the center line —
roughly 50/50. A run of 7 on one side is unlikely by chance (≈ 1.6%) and signals the process **mean
has shifted**, even when no point is near a limit.

**Implementation:** window of exactly 7, requiring *all 7* on one side. A point exactly on the
center line (`value >= x̄`) counts as **above**. Phase-aware; suppressed on flat data. (The
Western Electric / Nelson family has 8- and 9-point variants; this visual uses **7**, matching the
DAX measures it was ported from.)

---

## Rule 5 — Trend

**Detects:** **7 consecutive** points **strictly trending** in one direction (each higher than the
last, or each lower than the last).

**Why it matters:** a steady drift — tool wear, gradual fatigue, creeping calibration error —
that a static shift rule wouldn't catch.

**Implementation:** requires a genuine **monotonic run** — the 6 step-to-step transitions ending at
the current point must all share one nonzero direction. A single reversal inside the window (a
zig-zag) does **not** count, even if most steps point the same way. Direction-only, so it's
phase-independent (a trend is a trend regardless of where the limits are).

---

## Rule 6 — Mixture

**Detects:** **8 consecutive** points with **none in Zone C** (all beyond ±1σ, on either side).

**Why it matters:** "mixture" / over-dispersion — points avoid the center line and pile up near both
limits, often a sign of two different processes or populations mixed together (e.g. two machines,
two shifts).

**Implementation:** window of 8; fires when *zero* of the 8 fall inside Zone C. Because every point
in the window is outside Zone C, the flagged point participates by definition. Phase-aware. (Not
suppressed by the flat-data guard — on flat data every point *is* in Zone C, so it can't fire.)

---

## Rule 7 — Stratification

**Detects:** **15 consecutive** points **all in Zone C** (all within ±1σ of the center line).

**Why it matters:** the opposite of mixture — points hug the center line too tightly. This usually
means the control limits are too wide for the real variation: stratified sampling, an over-estimated
σ, or data that's been smoothed/averaged.

**Implementation:** window of 15; fires when *all 15* fall inside Zone C. Phase-aware; suppressed on
flat data.

---

## Rule 8 — Over-Control

**Detects:** **14 consecutive** points **strictly alternating** up and down (up, down, up, down, …).

**Why it matters:** systematic oscillation — typically over-adjustment ("tampering"): an operator or
controller reacting to every point and pushing the process the other way each time.

**Implementation:** requires the 13 step-to-step transitions across the 14-point window to **all**
be nonzero and each opposite the previous — strict alternation, with no allowance for a single
non-alternating step. Direction-only, so phase-independent.

---

## Notes

- **Rule selection:** all eight default to enabled. Disabling a rule in the format pane removes its
  contribution to the violation flag (and from the tooltip and Rule Reference panel).
- **Multiple rules** can fire on the same point; the tooltip shows one row per fired rule (its name
  and reason).
- **Rules vary by chart type.** The individuals (X-mR) chart and the **X̄ subgroup charts (X̄-R,
  X̄-s)** use all 8 — subgroup means are ~normal (CLT). **Attribute charts (p, np, c, u) use only
  {1 Beyond, 4 Run}** by default: their binomial/Poisson spread is skewed, so the Zone A/B rules'
  ±1σ/±2σ probability interpretation (which assumes normality) doesn't hold. **Time-weighted charts
  (EWMA, moving average) use only {1 Beyond}** — their points are autocorrelated by construction, so
  the run/zone rules are invalid. **CUSUM uses no Western Electric rules at all:** it has its own
  two-arm signal — the cumulative sums C⁺/C⁻ crossing the decision interval ±H — computed directly
  rather than through the rule engine. The dispersion companions (MR, R, s) flag beyond-limit only (on
  both bounds — a range below its LCL is a signal).
- **Divergence from the source dashboard:** Rules 2, 3, 5, and 8 were tightened from the original DAX
  measures so the violation lands on the point that actually breaks the pattern (and so a single
  reversal/non-alternating step no longer trips the trend/over-control rules). On data with these
  patterns, counts here will differ from — and are more correct than — the original DAX behavior.
