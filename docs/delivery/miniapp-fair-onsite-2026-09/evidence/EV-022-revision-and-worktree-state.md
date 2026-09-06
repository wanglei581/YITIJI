# 修订与工作区状态（EV-022）

**2026-09-02T20:55+08:00 · 分支 `claude/miniapp-lane` · 只读 git 检查**

## 本包钉住的修订

```
$ git rev-parse HEAD
eff92ac9c06392091f5b0fb18b14bf5bbeb4433d
```

建包时的修订是 `8176c1ee2004`，之后落了 11 个提交。

## 这条分支正在被并发提交

**本包只是一个时间点快照。** 采证期间（20:44–20:53）HEAD 连续前进了三次：

| 时刻 | HEAD | 内容 |
|---|---|---|
| 20:44 | `ec552bb8111a` | 契约快照补三个简历生成端点 |
| 20:49 | `75752bdb3f98` | AI 简历从零生成落地 + OCR 低置信度提示修复 |
| 20:52 | `eff92ac9c063` | 修 CI 门禁覆盖率（本分支原本会在 Repository integrity gate 转红） |

同一分支上还有另一位作者在提交。任何「HEAD 通过」的结论都只对上表最后一行成立，
**读到本包时 HEAD 可能已经不是这个值**，请先 `git rev-parse HEAD` 比对再引用。

## 工作区状态（按时间戳分两段说，因为它在采证过程中变了）

**门禁执行窗口 20:52:50 – 20:54:31**：`apps/miniapp/**` 与 `services/api/**` 工作区干净，
唯一未提交的内容是本交付包自身（`docs/delivery/miniapp-fair-onsite-2026-09/**`），
不参与任何门禁断言。因此 EV-017 ~ EV-021、EV-024 的结果
**确实对修订 `eff92ac9c063` 成立**。

**20:56:40 起不再干净**：另一位作者在 `apps/miniapp/utils/normalize.js` 上开了一处
未提交改动（在 DEF-002 的 OCR 修复之上继续去重一条重复的置信度 warning）。
文件 mtime 20:56:40，晚于全部门禁执行时间——所以它**没有污染**上面的结果，
但意味着：

> **现在照着这个工作区重跑门禁，跑的已经不是 `eff92ac9c063`。**
> 要复现本包的结论，必须在干净检出上跑，或至少先 `git status --porcelain` 确认为空。

这是共享 worktree 的常态，不是异常。本包无法保证读到它时工作区仍然干净（RISK-003）。

## 建包后一度不成立（现已修复，记录机制）

在修订 `ec552bb8111a`（20:44）时存在过一个**从干净检出复现不了门禁结果**的窗口：

```
$ git show ec552bb8111a:apps/miniapp/app.json | grep -n resume-build
26:    "pages/resume-build/resume-build",

$ git ls-files apps/miniapp/pages/resume-build/    # 当时输出为空
```

即：`app.json` 注册了页面、`ai-records.js` 的 `generate` 记录也已指向
`/pages/resume-build/resume-build`，但**页面六个源文件当时还没进版本库**。
`verify-miniapp-static.mjs` 三处断言依赖磁盘上的文件而不是版本库：

- 第 56–57 行「app.json pages 均有四件套」按 `fs.existsSync` 判定
- 第 160 行 `missingPageDirs`（注册目录必须有物理目录）
- 第 285–295 行「AI 记录路由表已注册」

所以当时那次 `109 PASS / 0 FAIL` 是靠未提交文件成立的；同一修订被干净检出后
静态门禁会转红。`75752bdb3f98` 提交了页面源码，窗口关闭（DEF-003）。

**机制而非偶然**：为了让静态门禁不报「跳转目标未注册」，路由与注册会先于页面本体
落地。下次再出现「先注册后实现」的分工，同一个洞会重开。真正的防线是
**在干净检出上跑门禁**，而不是在开发工作区上跑——本包不具备这个条件，如实记下。
