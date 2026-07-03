# AI 简历优化 Wave 2 排版编辑与 AI 一键排版设计规格

## 目标

在 Wave 1 已完成「诊断 -> 优化 -> 四格式导出 -> 我的文档 -> PDF 打印确认」预生产 RW1 验收的基础上，补齐优化后简历的排版控制能力：

`优化版简历 -> 在线调整排版参数 -> PDF 导出读取参数 -> 必要时 AI 一键精简/排版 -> 继续四格式导出/打印`

本轮只服务求职者本人编辑自己的简历，不做招聘平台投递、企业候选人筛选、企业收简历、录用预测或简历代投。

## 本轮范围

### In Scope

1. 优化预览页新增排版参数控制：
   - 字号档位：紧凑 / 标准 / 放大。
   - 行距档位：紧凑 / 标准 / 舒展。
   - 页边距档位：窄 / 标准 / 宽。
   - 主色：受控白名单色，不提供任意取色器。
   - 栏数：单栏 / 双栏。
2. PDF 渲染读取排版参数。
   - 缺省参数必须等价于 Wave 1 当前 PDF。
   - 仅 PDF 消费 layout；docx / txt / md 保持 Wave 1 导出行为，不伪造排版效果。
3. 优化页实时预览排版参数。
   - 前端预览使用 CSS 近似表达字号、行距、主色和栏数。
   - 最终以服务端 PDF 渲染为准。
4. AI 一键排版 / 精简。
   - 输入为当前结构化 `GeneratedResume`、原始诊断任务和当前 layout。
   - 输出仍是 `GeneratedResume` 同构体。
   - 只允许精简、合并、改写表达，不允许新增学校、公司、证书、时间段、联系方式、数字、项目名等事实。
5. 新增 verify 防回退：
   - layout DTO 白名单和范围。
   - 默认 layout 兼容旧导出。
   - PDF 主色 / 页边距 / 字号参数实际进入渲染。
   - AI 一键精简不新增事实、不输出承诺类词。
   - Kiosk 页面不直连 adapter，不出现价格/付费文案。

### Out of Scope

- 支付、套餐、优惠券、权益核销。
- 语音生成简历。
- 岗位 URL 抓取或任意第三方招聘页解析。
- 模板库自动填充、模板市场、自定义模板 CRUD。
- 字体上传、头像图片、图标、任意拖拽布局、所见即所得设计器。
- docx / txt / md 直接打印或格式转换。
- Windows 一体机 + 奔图真实出纸验收。

## 推荐架构

### 共享类型

新增 `ResumeLayoutSettings`，作为跨端 SSOT：

```ts
export type ResumeLayoutFontScale = 'compact' | 'standard' | 'large'
export type ResumeLayoutLineSpacing = 'compact' | 'standard' | 'relaxed'
export type ResumeLayoutMargin = 'narrow' | 'normal' | 'wide'
export type ResumeLayoutColumns = 1 | 2
export type ResumeLayoutAccent = 'blue' | 'green' | 'slate'

export interface ResumeLayoutSettings {
  fontScale?: ResumeLayoutFontScale
  lineSpacing?: ResumeLayoutLineSpacing
  margin?: ResumeLayoutMargin
  columns?: ResumeLayoutColumns
  accent?: ResumeLayoutAccent
}
```

所有字段 additive optional。缺省等价于：

```ts
{
  fontScale: 'standard',
  lineSpacing: 'standard',
  margin: 'normal',
  columns: 1,
  accent: 'blue',
}
```

### 后端 PDF 渲染

`ResumePdfService.render(resume, layout?)` 将当前硬编码常量改为内部派生配置：

- `margin` -> A4 页边距。
- `fontScale` -> 标题、正文、栏目标题字号倍率。
- `lineSpacing` -> `lineGap`。
- `accent` -> 分割线和栏目标题色。
- `columns` -> 单栏或双栏。

双栏只做受控 MVP，不做复杂设计器：

- 页眉仍全宽。
- 正文 section 进入列流。
- 当前列不足时切换到右列；右列不足时分页。
- 所有文字仍使用 PDFKit 文本流，不引入新排版引擎。
- 正文起始 Y 必须由真实页眉高度派生；双栏左右列和分页后的正文使用同一个起始 Y，禁止硬编码固定页眉偏移。
- 默认 layout 必须从 Wave 1 当前 PDF 常量迁移，缺省导出不得改变已验收的 PDF 外观。
- 内容块高度超过单栏可用高度时必须就地渲染或交给 PDFKit 文本流拆段，禁止因换栏/换页反复循环导致无限加页。

### AI 一键排版 / 精简

新增独立 action，不复用原 optimize endpoint 的语义：

- `POST /api/v1/resume/records/:taskId/layout-adjust`
- 输入：
  - 当前 `GeneratedResume`
  - `action: 'reformat' | 'condense'`
  - 当前 `layout`
- 输出：
  - `resume: GeneratedResume`
  - `warnings: string[]`

安全规则：

- 服务端用 taskId 复用既有优化链路的 source file 解析路径重新提取原始简历文本作为事实基线；如果 source file 不存在或 extraction 失败，硬拒绝，不降级为仅当前编辑稿基线。
- 同时允许用户当前 `GeneratedResume` 中已存在的事实作为人工编辑基线。
- AI 输出的学校、公司、证书、电话、邮箱、时间段、项目名、数字必须出现在「原文 + 当前编辑稿字段值」归一化文本里；当前编辑稿只能提取字段值，不能用 `JSON.stringify` 的 key 或结构字段名污染事实基线。
- 命中录用、保面试、平台投递、内推承诺、通过率等词，直接拒绝。
- 失败时返回明确错误，不 fallback mock，不覆盖用户当前编辑稿。
- 成功时返回 `{ resume, warnings }`；前端应用前必须保留上一版编辑稿，并提供撤销 AI 调整能力。

### Kiosk 前端

`ResumeOptimizePage.tsx` 已接近 550 行，Wave 2 不继续堆功能。执行时拆为：

- `ResumeOptimizePage.tsx`：页面编排、任务上下文、导出/打印入口。
- `components/ResumeLayoutControls.tsx`：排版控制面板。
- `components/OptimizedResumeEditor.tsx`：结构化简历编辑区。
- `hooks/useResumeLayout.ts`：layout state、默认值、可选 session/local 记忆。
- `services/api/ai.ts` / adapter：新增 layout adjust 调用。

排版参数变更后：

- 标记 dirty。
- 清空已导出的旧文件。
- PDF 导出时把 layout 传给后端。
- 非 PDF 导出不展示“排版已生效”的暗示文案。

## 验收边界

本轮完成后可宣称：

- 优化版简历支持受控排版参数编辑。
- PDF 导出会读取受控排版参数。
- AI 一键精简/排版在防编造和合规拦截下工作。
- AI 不新增超出原始简历或用户当前编辑稿字段值的事实；但用户手动输入的事实真实性仍由用户负责，不能宣称平台保证简历绝对真实。

不得宣称：

- 已完成模板库自动填充。
- docx/txt/md 直接打印或高还原格式转换已完成。
- 已完成收费闭环。
- 已完成 Windows 真机出纸。
- 已替代专业简历设计器。

## 主要风险

1. 双栏跨页导致重叠：需要 verify 覆盖长文本、页数、PDF 非空和关键布局参数。
2. AI 精简引入新事实：必须用服务端事实基线校验。
3. 任意颜色导致低对比或 PDF 注入：只允许白名单主题色。
4. 页面继续膨胀：必须先拆组件，再接新 UI。
5. 旧导出调用回归：layout 全部 optional，缺省应兼容 Wave 1。
