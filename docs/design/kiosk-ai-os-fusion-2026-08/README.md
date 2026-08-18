# kiosk-ai-os-fusion-2026-08（原型已移除）

2026-08-18：产品负责人裁定本目录的融合版原型**不再作为任何判断输入**，
原型内容（`index.html` / `scripts/` / `styles/`）已删除，避免与当前口径混淆。

当前口径见 [docs/README.md](../../README.md) §二：

- **目标设计**：`kiosk-ai-os-v3-2026-08/`（首页真值 `01-home-v6.html`）
- **待替换的现状**：`kiosk-proto-2026-07/`（Gen 1，线上实现照它做）

`assets/` **保留**：`kiosk-visual-directions-2026-08/direction-{a,b,c,d}-home.html`
四个页面通过 `../kiosk-ai-os-fusion-2026-08/assets/kiosk-home-hero-job-fair.png`
引用其中的图片，一并删除会让那四页的图挂掉。

删除前已核验：无 verify / CI 依赖，无 `apps/` 代码引用；其余 4 处引用均为
README 中的文字提及，且都已标注「历史候选，不再作为输入」。
