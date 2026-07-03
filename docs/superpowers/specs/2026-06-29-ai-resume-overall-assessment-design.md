# AI 简历诊断「AI综合评估」设计说明

## 结论

新增「AI综合评估」能力，但不把它加入固定 6 个评分维度。

当前 `ResumeReport.sections` 已被定义为固定 6 维评分结构：基础信息完整度、求职目标清晰度、经历表达清晰度、成果量化程度、岗位关键词覆盖、版式与可读性。用户在上传页选择的重点维度只影响大模型分析侧重点，不改变报告 schema。因此「AI综合评估」应作为独立结果模块，而不是第 7 个评分项。

## 产品定位

「AI综合评估」解决的是用户对“AI到底怎么看我这份简历”的直观感知问题。它不重复评分维度，而是把 6 维评分、目标方向、风险提醒和修改优先级合并成一段结构化结论。

建议前端展示名称：

- 上传页开关：`生成 AI 综合评估`
- 报告页模块标题：`AI综合评估`
- 模块副标题：`基于简历内容、目标方向和 6 维评分生成，仅作求职材料优化参考`

## 不做什么

- 不新增第 7 个 `sections` 评分维度。
- 不输出“录用概率”“超过多少人”“企业匹配度”“面试通过率”等招聘结果暗示。
- 不把 AI 综合评估作为平台岗位推荐或企业筛选能力。
- 不记录简历原文、目标岗位原文到审计日志。
- 不改变扫码上传、U 盘 Agent、扫描真机、Word/图片导出范围。

## 数据结构建议

在 `ResumeReport` 中新增可选字段：

```ts
export interface ResumeOverallAssessment {
  headline: string
  summary: string
  strengths: string[]
  weaknesses: string[]
  nextActions: string[]
}

export interface ResumeReport {
  sections: ResumeSection[]
  suggestions: string[]
  riskNotes?: string[]
  priorities?: ResumePriority[]
  overallAssessment?: ResumeOverallAssessment
  requestContext?: ResumeDiagnosisRequestContext
}
```

字段约束：

- `headline`：一句话总结，最长 40 字。
- `summary`：综合判断，最长 180 字。
- `strengths`：1-3 条，描述简历中已有优势。
- `weaknesses`：1-3 条，描述最影响阅读和筛选的问题。
- `nextActions`：2-4 条，描述下一步可执行动作。

所有数组项都必须经过敏感词过滤和长度截断。旧报告没有 `overallAssessment` 时前端隐藏该模块，不影响历史数据读取。

## 上传页操作逻辑

在 `ResumeDiagnosisSettings` 中新增一个默认开启的开关：

- 标签：`生成 AI 综合评估`
- 说明：`基于 6 维评分和目标方向生成综合结论，不改变评分维度`

提交到 `/resume/parse` 时随 state/API request 传：

```ts
assessmentOptions: {
  includeOverallAssessment: true
}
```

若未来要极简化，也可以不做开关，直接默认生成。当前建议保留开关，便于用户理解“AI综合评估”是附加输出，不是新评分维度。

## 后端与大模型逻辑

LLM prompt 增加可选输出要求：

- 当 `includeOverallAssessment !== false` 时，要求返回 `overallAssessment`。
- 仍要求 `sections` 必须且只能是固定 6 维。
- `overallAssessment` 只能基于简历文本、6 维评分和用户目标方向表达，不得推断候选人的受保护属性，不得预测录用结果。

解析逻辑：

- `sections` 继续使用现有强校验。
- `overallAssessment` 作为 additive 字段清洗；非法或缺失时丢弃，不影响报告主体完成。
- 如果模型返回第 7 个 section，应继续判定为 schema 漂移并重试或失败。

审计逻辑：

- 只记录 `overallAssessmentRequested: boolean`。
- 不记录 `headline` / `summary` / `strengths` / `weaknesses` / `nextActions` 原文。

## 报告页展示逻辑

推荐位置：总分/目标方向摘要之后，分项评分之前。

模块内容：

1. 一句话结论 `headline`
2. 综合说明 `summary`
3. 三列或三段：
   - `已有优势`
   - `主要短板`
   - `下一步动作`

模块底部保留合规提示：

`AI综合评估仅用于简历材料优化参考，不代表岗位匹配、录用概率或面试结果。`

闭环按钮仍放在报告页已有行动区：

- `去优化简历`
- `保存 PDF`
- `导出 Word`
- `保存图片`

本设计只新增综合评估内容，不在本阶段实现 Word/图片导出。

## 验证要求

实现时至少补充以下验证：

- `verify-real-resume-diagnosis`：合法 LLM 响应包含 `overallAssessment` 时报告可读回。
- `verify-real-resume-diagnosis`：LLM 返回第 7 个 section 仍被拒绝。
- `verify-real-resume-diagnosis`：`overallAssessment` 中含合规禁词的条目被过滤。
- Kiosk 静态验证：上传页存在 `生成 AI 综合评估` 控件，parse 请求转发 `assessmentOptions`。
- Kiosk 静态验证：报告页存在 `AI综合评估` 模块，旧报告缺失字段时不崩溃。
- Typecheck / lint / `git diff --check`。

## 推荐实施顺序

1. 先扩展 shared 类型和 API DTO，可选字段必须兼容旧请求。
2. 扩展 LLM prompt 和 report parser，保持 6 维 sections 强校验不变。
3. 扩展 API 离线验证脚本。
4. 在上传页设置组件增加开关。
5. 在解析页转发 `assessmentOptions`。
6. 在报告页增加综合评估展示模块。
7. 同步进度文档并做 Claude + Antigravity 双模型审查。
