# S0-C 简历解析阶段真值收口

## 目标

审查并纠正 `ResumeParsePage` 的阶段表达：不得用前端固定延时冒充 OCR、结构提取、AI 诊断的真实后端阶段。保留既有真实提交、成功报告、失败和 OCR 来源披露。

## 初始范围

- `apps/kiosk/src/pages/resume/ResumeParsePage.tsx`
- `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs`
- `apps/kiosk/tests/visual/fusion-w3.spec.ts`
- `apps/kiosk/tests/visual/fixtures/fusion-w6-route-cases.ts`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- 本 CCG 任务目录

## 禁止事项

- 不改 AI/OCR 后端、provider、数据库、密钥、模型选择或 API 契约。
- 不新增伪造的任务阶段、成功分数、解析结果或进度百分比。
- 不推翻现有上传→真实提交→报告链路，不新增重复页面或入口。
- 不部署生产，不触碰真实用户简历。

## 验收原则

先证明 API 实际返回能力，再决定“接真实状态”或“明确等待动画/非实时阶段”；TDD 后运行简历静态门禁、typecheck/lint/build 和 W3 真实 HTTP fixture 浏览器用例，最后由 Cursor Grok 4.5 High Fast、Claude、Antigravity 只读复核。
