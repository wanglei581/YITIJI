# AI 简历优化 Wave 3 模板库自动填充设计

> 状态：设计稿。本文只定义 Wave 3 的代码范围与验收口径，不代表功能已实现、已合并或已部署。

## 目标

Wave 3 要把“简历素材库 / 模板库”的简历模板从版式参考升级为可套用模板：用户在 AI 简历优化页拿到结构化简历后，可以选择一个简历模板，系统按模板的区域定义把姓名、求职意向、教育经历、工作经历、项目经历、技能证书等字段填入对应区域，并导出 PDF、进入 FileObject / 我的文档、继续走 PDF 打印确认。

该功能仍服务于“用户本人自用、下载、打印”的求职准备场景，不提供平台投递、向企业发送简历、候选人推荐或企业筛选闭环。

## 非目标

- 不做 Admin 模板 CRUD。
- 不做拖拽式模板编辑器。
- 不做复杂坐标级高还原模板引擎。
- 不做 docx / txt / md 的模板排版承诺；非 PDF 仍只做内容导出。
- 不做 docx / txt / md 直接打印。
- 不做收费、套餐、优惠券或支付。
- 不做岗位 URL 抓取或 JD 解析。
- 不引入新的 PDF / Canvas / 浏览器渲染依赖。

## 现状依据

现有代码已经具备以下基础：

- `packages/shared/src/types/jobMaterials.ts` 区分 `ResumeTemplate` 和普通 `JobMaterialDocumentTemplate`。
- `services/api/src/job-materials/job-material-templates.ts` 已有 `resume-template-clean`，但目前没有结构区域定义。
- `services/api/src/job-materials/job-materials.service.ts` 明确禁止 `resume_template` 走普通 `/job-materials/generate`，提示“简历模板请先进入简历诊断或优化链路”。这个边界保留。
- `services/api/src/ai/resume/resume-pdf.service.ts` 是 AI 简历 PDF 的真实渲染器，Wave 2 已支持 `ResumeLayoutSettings`。
- `POST /api/v1/resume/generate/export` 已支持 `format=pdf|docx|txt|md`，PDF 返回 `printFileUrl`，四格式进入 FileObject / 我的文档。
- Kiosk `ResumeOptimizePage.tsx` 已拥有结构化简历编辑、排版参数、AI 一键调整和导出入口。

Wave 3 不重建材料库或简历生成链路，而是在现有 AI 简历导出链路上增加 `templateId` 和模板渲染预设。

## 推荐方案

采用“静态模板定义 + PDF renderer preset”的方案。

模板定义放在共享类型和后端模板常量中。每个 `resume_template` 增加 `resumeLayoutPreset`，描述：

- 模板风格：`clean`、`compact`、`formal`。
- 默认排版参数：字号、行距、页边距、主色、单双栏。
- 区域顺序：`header`、`summary`、`education`、`experience`、`projects`、`skills`、`certificates`。
- 可选隐藏策略：某个区域为空时自动跳过。

导出接口增加 `templateId?: string`。当 `format=pdf` 且 `templateId` 指向已发布的 `resume_template` 时，`ResumePdfService.render()` 使用模板 preset 合并用户当前 layout；用户显式选择的 layout 优先级高于模板默认值。未知模板、非发布模板或非 `resume_template` 必须返回明确错误。`docx/txt/md` 接收 `templateId` 时不伪造模板排版，按既有文本导出逻辑处理，并在 verify 中固定该边界。

## 数据流

1. 用户完成诊断 / 优化，进入 `ResumeOptimizePage`。
2. 页面加载已发布的 `ResumeTemplate[]`。
3. 用户选择模板，例如“清爽通用”“紧凑一页”“正式双栏”。
4. 页面将 `templateId` 与当前 `layout`、当前结构化简历一起传给 `/resume/generate/export`。
5. API 校验 `templateId`：
   - 存在；
   - `status=published`；
   - `type=resume_template`。
6. API 把模板 preset 和 layout 传给 `ResumePdfService`。
7. `ResumePdfService` 根据模板区域顺序和 layout 渲染 PDF。
8. 导出结果继续走现有 FileObject、短时签名 URL、`printFileUrl`、我的文档和 PDF 打印确认链路。

## UI 设计

优化页在“排版参数”和“导出格式”附近新增模板选择区域，避免新增重复入口。控件表现为一组模板按钮或紧凑列表：

- 展示模板名称、标签、推荐场景。
- 默认选中“清爽通用”。
- 选择模板后清除 stale export，与 Wave 2 的 layout/content change 行为一致。
- PDF 导出时显示“套用模板”；非 PDF 导出时不承诺模板排版。
- 保留现有 `printFileUrl` 打印路径，禁止回退使用 COS `signedUrl` 打印。

材料库页面仍展示求职信、感谢信、作品集、材料清单。简历模板可以作为模板来源被 API 返回给优化页，但不应通过普通材料库表单生成简历。

## 后端契约

新增类型建议：

```ts
export type ResumeTemplateSectionKey =
  | 'header'
  | 'summary'
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'certificates'

export interface ResumeTemplateLayoutPreset {
  style: 'clean' | 'compact' | 'formal'
  defaultLayout: ResumeLayoutSettings
  sectionOrder: ResumeTemplateSectionKey[]
}

export type ResumeTemplate = JobMaterialTemplate & {
  type: ResumeTemplateType
  resumeLayoutPreset: ResumeTemplateLayoutPreset
}
```

后端 `JobMaterialTemplateView` 镜像同步增加同名字段。因为当前后端和 shared 各有一份模板常量，本轮必须保持两边模板 id、type、status、preset 一致，并用 verify 防止 drift。

`ResumeGenerateExportDto` 增加：

```ts
@IsOptional() @IsString() @MaxLength(80)
templateId?: string
```

服务层只在 `format === 'pdf'` 时消费 `templateId`。若 `format` 非 PDF，`templateId` 不影响输出，且不返回 `printFileUrl` 的既有边界保持不变。

## 错误处理

- 未知模板：`AI_RESUME_TEMPLATE_NOT_FOUND`。
- 模板未发布或不是 `resume_template`：`AI_RESUME_TEMPLATE_UNSUPPORTED`。
- 模板区域定义为空或含未知 section：代码侧 verify 拦截，不允许进入运行时。
- PDF 字体缺失：沿用 `RESUME_PDF_FONT_NOT_FOUND`。
- 非 PDF 导出传 `templateId`：不报错，但不声称模板排版已应用。

## 隐私与合规

- 不新增简历原文落库。
- 不新增企业端或投递端能力。
- 模板只改变用户确认后的结构化简历排版，不新增事实。
- 审计记录只允许记录 `templateId`、`format`、`pageCount`、是否会员绑定等摘要，不记录简历正文。
- 预生产验收材料必须使用合成简历，token、signedUrl、简历正文不得写入仓库。

## 验证策略

新增 `verify:resume-template-fill`，覆盖：

- shared 和 API 模板定义一致。
- 每个 `resume_template` 都有合法 `resumeLayoutPreset`。
- PDF 导出传 `templateId` 成功，返回 `%PDF`、`pageCount`、`printFileUrl`。
- 未知模板被拒绝。
- 普通求职材料模板不能作为简历模板使用。
- docx/txt/md 传 `templateId` 不报错，但不返回 `printFileUrl`，且不宣称模板排版。
- 现有 Wave 1 / Wave 2 verify 继续通过：`verify:resume-export-formats`、`verify:resume-layout-export`、`verify:resume-layout-adjust`、Kiosk UI verify。

Kiosk 前端 verify 扩展：

- 优化页加载 / 展示简历模板。
- 导出调用传入 `templateId` 和 `layout`。
- 选择模板后清除 stale export。
- 打印仍只使用 `printFileUrl`。
- 无收费、录用承诺或平台投递文案。

## 验收口径

代码侧完成不等于商用完成。Wave 3 完整收口需要：

1. PR 合入 main。
2. CI 全绿。
3. 预生产部署到最新候选。
4. 公网真实链路跑通：诊断 -> 优化 -> 选择模板 -> 带模板 PDF 导出 -> 我的文档 -> PDF 打印确认前置校验。
5. 确认 docx/txt/md 仍只导出 / 下载，不宣称模板排版或直接打印。

