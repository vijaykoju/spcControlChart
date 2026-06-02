# Privacy Policy — SPC Control Chart

_Last updated: June 2, 2026_

The **SPC Control Chart** Power BI custom visual is designed to process data entirely within your
Power BI session. It does **not** collect, store, transmit, or share any data.

## What the visual does
- All computation (control limits, the 8 SPC rules, changepoint detection, the moving-range panel,
  rendering) happens **locally** inside Power BI Desktop or the Power BI service.
- The visual reads only the fields you bind to it (axis, measurement, optional target and tooltip
  measures) and uses them solely to render the chart in your report.

## What the visual does *not* do
- **No external network requests.** The visual makes no HTTP/S or WebSocket calls; it has no web
  access privileges (`privileges: []` in its capabilities) and contains no external/remote code.
- **No data collection or telemetry.** No usage analytics, tracking, cookies, or fingerprinting.
- **No personal data processing.** The visual has no concept of users or identities; it never
  reads, stores, or sends personal information.
- **No data leaves Power BI.** Your data stays within the report and the Power BI environment that
  hosts it, governed by your own Power BI/Microsoft data policies.

## Contact
Questions about this policy? Open an issue at
<https://github.com/vijaykoju/spcControlChart/issues> or email **vjk8736@gmail.com**.
