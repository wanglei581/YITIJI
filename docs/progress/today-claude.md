# 2026-06-02 Claude 今日动手清单(W2 Day 4)

## 角色

P0 冲刺 **W2 Day 4**。Job 侧审计补齐 + AI 服务审计接入 + 写 handoff 给 Mavis 做校企合作主题 UI。

**范围调整**:原计划"校企合作主题 banner"位于 `apps/kiosk/src/pages/job-fairs/`,
按 owners.md §1 是 **Mavis 独占目录**,我不直接动。改为写 handoff,让 Mavis 接。

## 分支

`feat/p0-w2-claude-jobfair-be7`(延续 W2)

## 将编辑/新建的文件

**后端 audit 回填**(我独占):
- `services/api/src/jobs/jobs.service.ts`(`reviewJobSource` / `publishJobSource` / `importJobs` 3 处加 audit 写入,与 fair 侧 audit 对齐)

**AI 服务审计接入**(我独占 services/api/src/ai):
- `services/api/src/ai/ai.service.ts`(parse / optimize / chat 3 个方法加 AuditService 调用)
- `services/api/src/ai/ai.module.ts`(确认 AuditModule 已是 @Global,无需 import)

**handoff 给 Mavis**:
- `docs/progress/handoff-to-mavis.md`(新建,详细描述校企合作主题 banner 的实现)

## audit 动作清单(Day 4 新增 6 处写入)

| Action | 触发处 | actorRole | 关键 payload |
|---|---|---|---|
| job.review | Admin 审核岗位 | admin | action / reason / from-to status |
| job.publish | Admin 发布/下架岗位 | admin | action / from-to status |
| job.import | Partner 导入岗位 | partner | count / externalIds[:20] |
| resume.parse_submitted | AI parse 提交 | kiosk | fileId / source / providerName |
| resume.optimize_requested | AI optimize 请求 | kiosk | taskId / providerName |
| assistant.chat_message | AI 助手对话 | kiosk | sessionId / intent(若有) / providerName |

**合规收益**:demo 时点 Admin 审计页就能看到完整的"谁审核了谁发布了岗位 / 谁让 AI 解析了简历"全链路,无任何动作遗漏。

## 阻塞 Mavis 的事项

- Day 4 全天:Mavis 不要碰 `services/api/src/jobs/` 和 `services/api/src/ai/`
- 完成的 handoff-to-mavis.md 是给 Mavis 异步消费的,**不强制 Mavis 立刻做**

## Mavis 今天可以并行做的事

1. **接 handoff-to-mavis.md** 的校企合作主题 banner(任选时间做)
2. **Kiosk fair 7 页接真 API**(后端 W2 Day 1-3 已就绪,Day 5 视觉做完后可一气呵成)
3. **A3 Admin 文件管理 UI**(消费 W1 BE-1 接口)
4. **A5 Admin 审计日志 UI**(W2 Day 4 后,审计数据更丰富,UI 接出来更有戏)

## 预计完成时间

UTC+8 EOD。

## 完成清单(下班前更新)

- [ ] Job 侧 audit 回填 3 处
- [ ] AI 服务 audit 接入 3 处
- [ ] handoff-to-mavis.md 写完
- [ ] typecheck + lint + boot 验证 audit 路由仍正常
- [ ] commit
