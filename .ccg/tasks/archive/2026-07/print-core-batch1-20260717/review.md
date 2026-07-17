# Review

## Local review

- Scope is limited to Kiosk home and print presentation modules; no routes, backend, shared contracts, Terminal Agent, or compliance text changed.
- Existing file upload, USB, QR upload, material inspection, payment attempt, payment status, pickup-code, and print-job status calls remain in place.
- Print job polling interval is now 3 seconds as required.
- Home device status keeps the existing terminal printer-status request and 30-second refresh; optional paper-level output is rendered without fabricating a value when the API omits it.
- `git diff --check`, Kiosk TypeScript, lint, and production build are required before commit.

## External review limitation

- Antigravity reviewer was invoked but returned no report because the local account/authorization was unavailable.
- Claude reviewer produced no usable stdout report in this run.
- No external-model approval is claimed.
