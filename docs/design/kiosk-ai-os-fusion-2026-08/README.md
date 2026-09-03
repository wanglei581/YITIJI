# kiosk-ai-os-fusion-2026-08（原型已移除）

2026-08-18：产品负责人裁定本目录的融合版原型**不再作为任何判断输入**，
原型内容（`index.html` / `scripts/` / `styles/`）已删除，避免与当前口径混淆。

当前口径见 [docs/README.md](../../README.md) §二：

- **目标设计**：~~`kiosk-ai-os-v3-2026-08/`~~ —— **2026-09-03 起不再是目标**。当前真值为 `kiosk-redesign-2026-08/`（青序流光）。V6 的 `01-home-v6.html` 仍被运行时代码/CI 引用（5 处），但那是**尚未迁移的现状**，不是设计口径。
- **待替换的现状**：`kiosk-proto-2026-07/`（Gen 1，线上实现照它做）

`assets/` 已于 2026-08-22 删除：两张 PNG 与 `apps/kiosk/public/assets/` 下同名文件 SHA256 完全相同，引用它们的 `kiosk-visual-directions-2026-08/` 也已删除。生产页面继续用 `apps/kiosk/public/assets/`。本目录只留本说明，不再作为设计输入。

删除前已核验：无 verify / CI 依赖，无 `apps/` 代码引用；其余 4 处引用均为
README 中的文字提及，且都已标注「历史候选，不再作为输入」。
