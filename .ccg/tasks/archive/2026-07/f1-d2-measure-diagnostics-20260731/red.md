# RED evidence

- Command: `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`
- Result: exit `2`
- Existing contract groups passed through `evidence schema`; execution then stopped at the newly added drill diagnostic contract because the implementation does not yet export the fixed `MEASURE_STEPS` contract.
- No runtime drill, Colima, PM2, Nginx, systemd, API process, or evidence path was touched.
