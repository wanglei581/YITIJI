# Kiosk 8177 / 5299 Fusion Source Manifest

This directory preserves the immutable source evidence for the 8177 / 5299 fusion baseline.

## Provenance

- **5299 source:** worktree branch `claude/funny-margulis-e3a639` at base commit `1d9060c5`. The three recorded working-tree files below are authoritative, including the uncommitted working-tree bytes.
- **8177 source:** worktree branch `claude/keen-merkle-ebec7f` at corrective commit `4d667463dd3f1353394bdaa7286c3d1b693d1e58`. The twelve committed Git blobs below are authoritative; no live 8177 worktree bytes are used.
- **Design decision:** commit `75a76aca`.

## Frozen sources

| Frozen path | Authoritative source | SHA-256 |
| --- | --- | --- |
| `sources/5299/index.html` | `/Users/wanglei/AI求职打印服务终端/.claude/worktrees/funny-margulis-e3a639/docs/design/kiosk-proto-2026-07/index.html` | `b3626b4c9d104244e962015a2d395e74331b6c2a101801ef545f6b0abd20e092` |
| `sources/5299/14-profile.html` | `/Users/wanglei/AI求职打印服务终端/.claude/worktrees/funny-margulis-e3a639/docs/design/kiosk-proto-2026-07/14-profile.html` | `8ae855db6f2e5e96bb58043fb52b82e41b419797b0a5a39f9064ff17b9802994` |
| `sources/5299/77-print-upload.html` | `/Users/wanglei/AI求职打印服务终端/.claude/worktrees/funny-margulis-e3a639/docs/design/kiosk-proto-2026-07/77-print-upload.html` | `21feb843118d7c401e36b5dc0b0ddb5c8af8e1d2ef0d798895a2f7380bab8348` |
| `sources/8177/index.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/index.html` | `4978c0a9eaa21f063d3635b2e383bc590ea5570b669108fd02d236023590ebf9` |
| `sources/8177/14-profile.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/14-profile.html` | `363b9d369facd6807a382f28d731f373b578c6e91c5e5c2c0ae143651041444e` |
| `sources/8177/77-print-upload.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/77-print-upload.html` | `8167069684a77bfe4df4dae44f87901abfd155f842f2c4c97a36c9545633919f` |
| `sources/8177/15A-login-error.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/15A-login-error.html` | `8e6494e43b374adb8ca076ce4890db29c84d805e5b469c901c765e8b0093cc34` |
| `sources/8177/22B-me-feedback.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/22B-me-feedback.html` | `895f186906db07a8bc2900924f70af65e56d669653c5d4315694ecd8d24e774d` |
| `sources/8177/32A-cashier-failed.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/32A-cashier-failed.html` | `a47d4549e19494db6be9b91d9478793c16fa6b9ef61631f75c89bd86c2d4c700` |
| `sources/8177/34A-scan-offline.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/34A-scan-offline.html` | `8b0d6abfbe2b5ec36317a0615c5e98943f55f22c906f600cded556ecc85db976` |
| `sources/8177/76-toolbox-zone.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/76-toolbox-zone.html` | `450ecdc03483178d5e615824ad59717e9f4a11a71bc7607910662f7ca275f3ed` |
| `sources/8177/76A-toolbox-empty.html` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/76A-toolbox-empty.html` | `9b00b902feed6004a1d4c778ebdf5a5d7144db57db5b9c8c726776fa6ea814d1` |
| `sources/8177/FREEZE.md` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/FREEZE.md` | `cb4990a6309c593f06340a0af949aee69aeffa66a74cb605ebf8acfe943d8c33` |
| `sources/8177/WAVE-P-CLOSURE.md` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/WAVE-P-CLOSURE.md` | `44601f45e00edf6b72d51e71d3f26f708334f8d29952224ea1d650ee30ed2397` |
| `sources/8177/WAVE-P2-FLOWS.md` | `4d667463dd3f1353394bdaa7286c3d1b693d1e58:docs/design/kiosk-proto-2026-07/WAVE-P2-FLOWS.md` | `dc26dd2625c407faf87fae2267cdad5229c63291c24f9e4d16a9bcf2239ac4b5` |

## Comparison and authority

The two prototype sets contain **82 shared files: 79 are byte-identical and three shared files differ**: `index.html`, `14-profile.html`, and `77-print-upload.html`.

The frozen set contains **15 source files**. `76-toolbox-zone.html` is one of the 79 byte-identical shared files; its stable snapshot is recovered from the fixed 8177 commit because the volatile live 5299 worktree copy drifted or was missing. The live 5299 bytes are not substituted for this evidence.

- **5299 is authoritative for layout and information architecture.**
- **8177 is authoritative for loading, empty, error, offline, failure, and legal states.**
- For `14-profile.html`, the 5299 “我的资产” composition wins.
- For `77-print-upload.html`, the 5299 2×2 composition wins, while scan is represented as a standalone navigation CTA.
- For `76-toolbox-zone.html`, the shared byte-identical main state is the `/toolbox` visual baseline.
- `15A-login-error.html`, `22B-me-feedback.html`, `32A-cashier-failed.html`, `34A-scan-offline.html`, and `76A-toolbox-empty.html` are state references, not new production routes.

## Isolation rule

`docs/design/kiosk-proto-2026-07-fusion/**` is design evidence only. It must never be imported by `apps/kiosk/src/**` or enter the production Kiosk bundle.
