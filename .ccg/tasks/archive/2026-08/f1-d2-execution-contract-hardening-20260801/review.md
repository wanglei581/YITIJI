# 双模型终审记录

## 第一轮

- Antigravity：`APPROVE`，Critical 0 / Warning 0。
- Claude：Critical 0；提出 3 个 Major：批准 PATH 专属错误码可退化、`run.sh` 未强制显式 evidence 参数、仓库边界未解析符号链接。

处置：继续 RED→GREEN，给批准 PATH block 增加专属错误码 mutation；由 `run.sh` 在 pre-nonce 强制 `D2_EVIDENCE_DIR` / `D2_EVIDENCE_OUT` 并移除 fallback；使用 `cd -P` / `pwd -P` 同时校验字符串与物理仓库边界；补 `/..` 尾段拒绝。canonical command 的外层 PATH 也改为固定批准目录，避免 `pnpm` 继承 caller PATH。

## 第二轮

- Antigravity：`APPROVE`，Critical 0 / Warning 0 / Info 0。
- Claude：`APPROVE`，Critical 0 / Warning 0；独立验证 missing directory 拒绝、symlink into repository 拒绝、`/usr/bin` 接受，并确认三项 mutation 均会 RED。

## 结论

可本地提交。没有运行 `drill:d2-same-host`，没有启动 Colima，没有生成 nonce/evidence，没有连接 production；代码候选不等于 D2′ PASS，`productionF1` 继续 NO-GO。
