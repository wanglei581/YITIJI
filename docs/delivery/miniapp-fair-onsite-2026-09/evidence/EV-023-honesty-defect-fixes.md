# 建包后修掉的两处「诚实性防线静默失效」（EV-023）

**修订 `eff92ac9c063` · 2026-09-02 · local · 只读源码走查（非运行时验证）**

建包时 G2-04（无实现级缺陷 / 无遗弃占位）判的是 PASS，依据是 EV-007 的三模型评审。
建包之后又查出两处**同一类**缺陷：代码里写着「必须向用户披露」，注释也写着，
但判定条件是错的，于是那条披露**从来没有出现过**。两处都已修复。

共同点：门禁抓不到。静态门禁能检查「有没有写伪造文案」，检查不了
「该出现的提示因为类型判断错误而永远不出现」。

## 1. 小青把 mock 降级话术当成真实 AI 回答展示

- 位置：`apps/miniapp/pages/assistant/assistant.js`
- 修复：`7ec0577f7`
- 问题：服务端专门透出 `aiGenerated` / `providerLabel` 用来区分「真实模型」与
  「mock/stub 预置话术」，前端只取了 `res.reply`，把 `aiGenerated` 丢了。
  AI 服务不可用时回落的预置话术，在界面上和真实模型回答长得一模一样。
- 修复后：`const aiGenerated = res.aiGenerated === true`；非 AI 生成时挂
  `fallbackNote: '本条不是模型生成的回答，是系统预置话术（AI 服务当前不可用）。'`
- 违反的口径：CLAUDE.md §9「不伪造能力」。

## 2. 简历诊断的 OCR 低置信度提示从未渲染

- 位置：`apps/miniapp/utils/normalize.js` + `pages/resume-diagnose/resume-diagnose.wxml`
- 修复：`75752bdb3f98`
- 问题：`normalize.js` 按 `typeof notice.confidence === 'number'` 判定，而后端
  `packages/shared` `ai.ts` `extractionNotice.confidence` 声明的是字符串枚举
  `'high' | 'medium' | 'low'`。于是 `noticeConfidence` **恒为 null**，
  wxml 里 `noticeConfidence !== null && < 0.8` 恒为 false ——
  紧挨着的注释写着「低置信度时页面必须提醒人工复核」，意图明确，实现静默失效。
- 后果：扫描件 / OCR 识别的简历拿到一份看起来很确定的评分，却没有任何可靠性提示，
  用户可能照着被错误识别的文本去改简历。
- 修复后：按字符串枚举判定，`noticeNeedsReview` 在 `low` 与 `medium` 时都为 true
  （不是 high 就提醒），并显示「较低 / 中等」等级。

## 对 G2-04 的影响

这两处说明 G2-04 的 PASS **只覆盖已被检出的缺陷，不构成穷尽性保证**——
两次都是在另一路审计里顺带发现的，不是任何门禁报出来的。
在真机与真后端跑过之前，同类「该出现的东西不出现」的缺陷无法系统性排除。

## 本条不能证明什么

- 两处修复都**只经源码走查确认**，没有在微信开发者工具或真机上看过实际渲染。
- 第 2 条的正确性依赖后端真的返回 `'high' | 'medium' | 'low'`；
  该字段的真实响应从未见过（生产探测 EV-009 未覆盖认证后的简历诊断链路）。
