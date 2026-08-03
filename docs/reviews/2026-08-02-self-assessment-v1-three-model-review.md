# Self-Assessment v1 三模型审查汇总报告(2026-08-02)

> 本文件汇总 team-reviewer / team-qa / team-architect 三个 Cursor 子代理对 self-assessment v1 / 3 PR(#473、#475、#476)的联合审查结论。**不修复,只分级与建议授权下一步**。

仓库根: `/Users/wanglei/AI求职打印服务终端`
基线: `feature/staged-pr3-self-assessment-frontend` 本地 HEAD `0a2d9672`(已合 main + 自己分支)
三 PR 状态:
- #473 → squash 合入 `main@348aefac`
- #475 → squash 合入 `main@5ca7ce0a`
- #476 → squash 合入 `main@5a2c086c`
- 自分支 CI run `30734247747` 三 job success

---

## 1. 阻塞级别(上线前必须修)

> 三个子代理独立给出 Critical,经人为去重 + 分级得出:

### 1.1 审计类型重复 + 上下文全 null(reviewer+architect 双报)
- `services/api/src/audit/audit.types.ts:36-39 vs :56-59` — `AuditAction` 重复声明 `resume.self_assessment_*` 四字面量 → SSOT 原则破坏
- `services/api/src/ai/resume/self-assessment.service.ts:186, 227, 262, 299` 与 `appended-self-assessment.service.ts:117` — `audit.write` 把 `ipAddress/userAgent/requestId` 硬编码 `null` → 公共一体机匿名 session 下无法追溯
- **影响**:合规审计断链,匿名滥用无法回溯
- **阻塞**:是(必须修)

### 1.2 PDF 错挂 `print_doc` 用途(reviewer 报)
- `services/api/src/ai/resume/self-assessment.service.ts:288` 与 `appended-self-assessment.service.ts:98` — 把 self-assessment 报告 PDF 与合并 PDF 用 `purpose: 'print_doc'`(敏感等级 `normal`)写入;而 `services/api/src/files/file.types.ts:35` 已新增 `'self_assessment_report'`(`sensitive`)
- 同时 `file-validation.ts:92` 的 `{ mimes: [], maxBytes: 0 }` 仍为占位,会拒上传
- **影响**:绕过 retention policy / 敏感标签,审计与清理 Cron 误聚合
- **阻塞**:是(必须修)

### 1.3 MyAiRecords 数据流断点(architect 报)
- `SelfAssessmentService.submit()` 仅在 `!isAnonymous && !overallRejectReason` 时落 `aiResumeResult`,匿名用户 AI 调用在 `AiLogService.record()` 有记录,但 `MemberAssetsService.getAiRecords()` 按 `aiResumeResult.kind` 查不到
- `MyAiRecordsPage.tsx:465` 文案「会员本人历史可在 MyAiRecords 查看」与行为不一致
- **影响**:已登录会员走完 self-assessment → 在「我的 → AI 服务记录」中看不到记录
- **阻塞**:是(必须修)

### 1.4 taskId 三方不一致(reviewer 报)
- `self-assessment.service.ts:136` `aiLog.record` 时用 `\`sa-${Date.now()}-${randomBytes(4)...}\``,145 行才计算最终 `\`sa-${randomBytes(12)...}\``
- **影响**:`ai_service_log` / `audit_log` / `ai_resume_result` taskId 断链,Admin 关联失败
- **阻塞**:是(必须修)

### 1.5 strength 二次 clamp 暴露注入风险(reviewer 报)
- `appended-self-assessment.service.ts:158` 二次 `clamp(0..5)` 而上游 `self-assessment-scoring.ts:86-90` 已 clamp → 下游不信任上游
- 上游类型为 `number`,下游强转 `0|1|2|3|4|5`,strength=7.5 仍能写库
- **阻塞**:是(必须修)

### 1.6 PDF verification 真机覆盖缺失(qa 报)
- Playwright W6 spec 覆盖 91 路由含 4 条 self-assessment,但**仅做 marker/landmark/touch,未注册 API mock,真假无网络成功**
- 真实集成 G1(后端真实接入)/ 真实真机 G5 未做
- **影响**:`kiosk-browser-smoke`「成功」不等同于自评估真闭环
- **阻塞**:是(上线前必须补 Kiosk 自助全链路 Playwright + 真实 LLM/合并 PDF 真机回归)

### 1.7 Summary 跨轮 context 污染风险(reviewer 报)
- `career-plan.service.ts:127-149` — 把上一次 self-assessment 的 LLM `summary` 注入下一轮 prompt,跨轮反复送 `summary` 上下文
- **影响**:LLM 拒答回填的降级文本含「不要按行业排名」之类拒答体征会污染下游
- **阻塞**:是(应一并修)

---

## 2. 非阻塞级别(择期)

### 2.1 `SelfAssessmentFlow.tsx:479` 单文件临界(W-1)
- 内部含 4 个 page + 3 个子组件 + 全屏框架 + session 工具函数
- §8 阈值「500 拆」已临门一脚
- 建议拆 `SelfAssessmentCards.tsx` + 提取 `KioskFullscreenShell`
- 择期

### 2.2 闲置 60 秒监听器跨页泄漏(W-2)
- `SelfAssessmentFlow.tsx:180-197` 仅监听 `pointerdown/keydown` 触发 resetIdle,PDF 同源监听器在多 page 路由间不卸载
- 建议显式 `useLocation` + `clearTimeout`
- 择期

### 2.3 LLM provider 锁定单一实现(W-3,architect 报)
- `llm-self-assessment.service.ts:107` hardcode `resume_optimize` 能力槽位
- 加 qwen/doubao 要改 5 个文件
- 择期

### 2.4 PDF service 重复字体逻辑(W-4)
- `self-assessment-pdf.service.ts` 与 `career-plan-pdf.service.ts` 字体候选逻辑 30 行复制
- 择期

### 2.5 路由入口合规性待对齐(W-5)
- `apps/kiosk/src/routes/index.tsx:97-100` 新增 4 条 self-assessment 路由,需对照 `docs/product/user-data-flow-matrix.md` 入口稳定规则确认
- 择期(不是 PR #476 自己新增,已沿用既有入口)

### 2.6 Kiosk `?from=...` 上下文缺(W-6)
- `ResumeReportPage.tsx:421` / `CareerPlanPage.tsx:240` 跳 `/resume/self-assessment/intro` 没携带 `from`,audit log 无法分析入口转化
- 择期

### 2.7 拒答行未落库(W-7)
- `self-assessment.service.ts:189-198` `overallRejectReason` 时返回 `status: 'rejected'` 但未 INSERT `aiResumeResult`,会员无法追溯
- 择期(可与 1.3 MyAiRecords 同步修)

### 2.8 SOFT_REJECT 误命中(W-8)
- `llm-self-assessment.service.ts:57-59` `SOFT_REJECT` 包含「排名」单字,与 `verify-compliance.ts` 的 `FORBIDDEN_PHRASES` 未严格对齐,否定上下文会误命中
- 择期

---

## 3. 信息级(可选优化)

- 注释密度高 → 抽到 `docs/compliance/self-assessment-contract.md`
- token 长度 `randomBytes(20)` vs `randomBytes(12)` 不一致
- session key 集中在 `apps/kiosk/src/session/keys.ts`
- `DISCLAIMER_TEXT` 与 PDF 默认值重合 → 抽 `SELF_ASSESSMENT_DISCLAIMER`
- LLM system prompt 重复边界要求 → 抽 `LLM_SYSTEM_PROMPTS`
- `appended-self-assessment.service.ts` 文件名语义不清,改为 `resume-merge-self-assessment.service.ts`

---

## 4. 分级裁决

| 级别 | 项数 | 修复责任 |
|------|------|----------|
| 上线前阻塞(Critical §1) | 7 | **必须修,本任务继续前清零** |
| 择期(Warning §2) | 8 | 进 stacked 分支 cleanup,或单开 fix 分支 |
| 可选(Info §3) | 6 | 不进分支,沉淀到当前文档 |

---

## 5. 建议下一步(需要授权)

按 CLAUDE.md §8.1「禁止事项:不擅自新增功能 / 不大范围重写 / 不以降低代码量为理由删已验证闭环」,我**只列选项**:

| 路径 | 描述 | 影响 |
|------|------|------|
| **A** | 单开 `fix/self-assessment-staged-cleanup` 分支,从 main 起,只覆盖 §1.1–§1.7(7 项 Critical),跑三 PR 同三 verify + 双 CI,合 main | 推荐:不破坏 stacked 已合入 commit,独立可回滚 |
| **B** | 在 `feature/staged-pr3-self-assessment-frontend` 上直接 amend 7 项 Critical,跑三 verify + 双 CI,然后 FF merge → main | 短期快,但会改写 commit 影响 blame |
| **C** | 暂不修,直接清 stacked 分支,§1.1–§1.7 留作 v1.1 后续 | 不推荐:CI 表象绿与合规审计断链并存,违反 CLAUDE.md §15 上线前收口 |
| **D** | 暂停收口,转去修 main 上的 PR #482 G1 TypeError | 不动 self-assessment,只关心 main 修绿 |

**推荐 A 路径**(独立分支 + 仅修 Critical + 不动 stacked)。

---

## 6. stacked 分支清理窗口

按 §8.1 治理分支启动规则:
- §1.1–§1.7 全部修完且双 CI 绿后才可清 stacked
- 未授权前不删 `feature/staged-pr3-self-assessment-frontend` 本地分支

---

## 7. 报告归口

| 子代理 | 报告 |
|--------|------|
| team-reviewer(reviewer) | 本文件 §1.1、§1.2、§1.4、§1.5、§1.7 + §2.1–§2.8 + §3 |
| team-qa(qa) | 本文件 §1.6 + verify 自检结论(三个 verify 真跑,无软脚本) |
| team-architect(architect) | 本文件 §1.1、§1.3 + §2.3、§2.4 + §3 |

---

## 8. 严禁事项

- 本文档不动代码
- 任何修复必须先开新分支(参考 §5 A 路径)
- 不删 `feature/staged-pr3-self-assessment-frontend` 本地分支
- 不擅自 push
