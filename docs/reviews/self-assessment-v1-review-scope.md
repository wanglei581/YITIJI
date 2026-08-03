# Self-Assessment v1 / 3 PR 收口审查范围定义

> 本文件是三模型审查的统一输入。审查范围基于 CLAUDE.md §8.1「标准化执行口径」,仅在三 PR 已合入的代码上做语义/合规/性能/可观测性 review,不重写实现,不重构,只列 Critical / Warning / Info。

仓库根: `/Users/wanglei/AI求职打印服务终端`
分支基线: `feature/staged-pr3-self-assessment-frontend`(本地 HEAD `0a2d9672`,与 `origin/main` 已合并)
已合入 main 的 commit:
- PR #473 squash → `main@348aefac`(共享类型 + 评分 + seed)
- PR #475 squash → `main@5ca7ce0a`(服务端 controller / LLM / PDF / 审计 / 会员资产)
- PR #476 squash → `main@5a2c086c`(Kiosk 4 页 + 6 CTA + PrintConfirm 勾选 + Admin 操作入口 + verify)

---

## 1. 审查对象(总览)

| PR | 关注层 | 文件数 | 关键文件 |
|-----|--------|--------|----------|
| #473 | 共享类型 + 评分引擎纯函数 + 5×5 题目 seed | 9 | `packages/shared/src/types/selfAssessment.ts`, `v1.questions.json`, `self-assessment-scoring.ts`, `verify-self-assessment.ts` |
| #475 | 服务端 controller / LLM 调用 / PDF / 会员资产 / 审计 | 28+ | `services/api/src/ai/self-assessment.controller.ts`, `appended-self-assessment.service.ts`, `career-plan.pdf.service.ts`, `llm-self-assessment.service.ts`, `self-assessment.service.ts`, `audit.types.ts`, `verify-self-assessment.ts` |
| #476 | Kiosk 4 页 + 路由 + 6 CTA + PrintConfirm 勾选 + Admin 操作 + verify | 23+ | `apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx`, `ResumeReportPage.tsx`, `CareerPlanPage.tsx`, `PrintConfirmPage.tsx`, `services/api/selfAssessment.ts`, `scripts/verify-assess-isolation.ts`, `scripts/verify-compliance.ts`, `docs/acceptance/self-assessment-acceptance-package.md` |

---

## 2. 审查重点(强制维度)

### 2.1 合规边界(必检,Critical 优先级最高)

来自 CLAUDE.md §2「不能做的功能」:

1. 不能做平台内一键投递
2. 不能做平台内收简历给企业
3. 不能做企业端候选人筛选 / 邀约 / Offer
4. 不能做候选人推荐给企业
5. 不能做企业自主发布岗位并直接收简历
6. 按钮文案必须用「去来源平台投递 / 扫码投递 / 去来源平台预约 / 扫码预约」,不能用「一键投递 / 立即投递 / 平台投递」
7. 不伪造能力:没有真实保存/真实模型/真实打印时不得展示"已完成"等结论

针对 self-assessment 重点查:
- 「去投递」 / 「立即投递」 任何字样
- 是否把 self-assessment 结果推送给企业
- 审计是否记录"分享给企业"之类调用
- 是否在 AI 结果里夹带"自动投递"动作

### 2.2 评分与 LLM 边界(纯函数 vs LLM)

PR #473 强制要求评分引擎是**纯函数**(给定同一组答案必须可重现),PR #475 LLM 部分只用于「文字解读」,不得改变分值。

查:
- `self-assessment-scoring.ts` 是否真的纯函数(无 Date.now / 随机数 / 全局状态)
- `appended-self-assessment.service.ts` 是否分离了「客观分值」和「文字解读」
- LLM 输入里是不是混入了 PII
- LLM 失败时是否降级到模板文本(而不是报 500)

### 2.3 数据最小化与存储

来自 CLAUDE.md §11「文件安全要求」:
- 用户文件临时签名 URL,过期
- 敏感文件不长期保存
- 删除保留日志

查:
- PDF / 报告存哪里?多久清?
- 谁能读?日志是否记录读取行为?
- `audit.types.ts` 里是否记录 admin 读报告

### 2.4 上线门禁(CI / verify)

CLAUDE.md §14「每次开发后必须运行 lint」,CLAUDE.md §15「CI 3/3 ✅」是基线。

PR #476 的 `verify-assess-isolation.ts` + `verify-compliance.ts` 必须实跑出 PASS:
- 不能是「写个 .skip / expect(true).toBe(true) 假 PASS」
- 必须真的加载真 schema 跑端到端

### 2.5 触控与可访问性(CLAUDE.md §9 硬约束)

- 主要按钮 ≥ 56px,所有可点击区域 ≥ 48px
- 不在打印流程中弹浏览器原生文件选择框
- Kiosk 27 寸竖屏 Touch UI 不依赖 hover

### 2.6 工程规模控制(CLAUDE.md §8 / §8.1)

- 单文件行数:300 理想 / 500 拆 / 800 不加新功能 / 1000 重构
- `SelfAssessmentFlow.tsx` 479 行 + 多职责 — 是否需要拆?

---

## 3. 审查分工(三个 Cursor 子代理等价三模型)

| 子代理 | 视角 | 重点输出 |
|--------|------|----------|
| **team-reviewer** | 静态 code review(类 Codex / Antigravity 那种语义 + 边界审查) | Critical / Warning / Info 三档 + 行号 + 修复建议 + 建议 commit 是否阻塞 |
| **team-qa** | 测试 / verify / CI 门禁视角 | 哪些 verify 没真跑 / 哪些是软脚本 / Playwright fixture 是否覆盖 Kiosk 真路径 |
| **team-architect** | 架构 / 模块边界 / Monorepo 视角 | `SelfAssessmentFlow.tsx` 是否要拆 / 服务-前端 DTO 是否一致 / 模块边界是否破坏 |

---

## 4. 不在审查范围

- 不重写实现
- 不重构
- 不新增功能
- 不动 wx-miniapp-login 那个未提交改动(stash@{0} 之后再说)
- 不动 main 上的 PR #482(`a3f78e81` G1 Kiosk TypeError)— 那是别人的工作

---

## 5. 报告输出格式

每个子代理用同一格式返回:

```
## Self-Assessment v1 Review — <代理名>

### Critical(必须修,上线前阻塞)
1. <文件:行号> <问题> <建议>

### Warning(应该修,择期)
1. ...

### Info(可选优化)
1. ...

### Verdict
- 阻塞 / 不阻塞
- 建议合入 stacked 分支清理:是 / 否
```

---

## 6. 完成后落盘

- 汇总报告 → `docs/reviews/2026-08-02-self-assessment-v1-three-model-review.md`
- 同步 `docs/progress/current-progress.md` 一条收口记录
- 不擅自删 stacked 分支(等用户授权)
