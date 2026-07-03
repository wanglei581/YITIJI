# AI 简历优化 Wave 4 语音生成简历设计

> 状态：设计稿。本文只定义 Wave 4 的代码范围与验收口径，不代表功能已实现、已合并或已部署。

## 目标

Wave 4 要解决“用户没有电子简历，也能通过说话生成简历草稿”的入口问题：用户在 Kiosk 简历生成页通过分段语音输入经历，系统把语音转写成文字，用户确认/编辑后反填到现有简历生成表单，再复用现有 `/resume/generate`、预览、PDF/Word/TXT/Markdown 导出、模板 PDF、我的文档和 PDF 打印确认链路。

本轮不是新建第二套简历生成系统，而是在现有 `ResumeGeneratePage` 上增加语音辅助输入能力。

## 非目标

- 不做长时间“一段独白直接生成整份简历”。现有 ASR 是短语音能力，长语音会触发 60 秒 / 4MB 边界。
- 不做离线 ASR，不在前端直连腾讯 / 百度云。
- 不自动把语音结果写入姓名、电话、邮箱、证件号等高敏字段。
- 不长期保存音频，不把音频写入 FileObject / COS / 数据库 / 日志。
- 不新增首页入口，不新增重复简历生成页。
- 不做收费、套餐、优惠券、支付。
- 不做岗位 URL / JD 抓取。
- 不做 Windows 一体机 + 奔图真机出纸验收。

## 现状依据

当前代码已经有可复用底座：

- `apps/kiosk/src/utils/wavRecorder.ts`：前端 `getUserMedia` 录音并产出 16k 单声道 WAV Blob。
- `services/api/src/mock-interview/asr/asr.service.ts`：`AsrService` 支持 `ASR_PROVIDER=disabled|tencent|baidu`，失败诚实返回，音频只在内存中转发。
- `services/api/src/mock-interview/mock-interview.controller.ts`：已有 multipart 音频上传转写范式。
- `apps/kiosk/src/services/api/interview.ts`：已有前端上传 WAV 并处理 ASR 错误的范式。
- `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx`：已有结构化简历生成表单和 `/resume/generate` 提交流程。
- `services/api/src/ai/resume/llm-resume-generate.service.ts`：现有简历生成只基于结构化输入润色，不应被改成自由编造。

双模型分析结论一致：ASR provider 决策已不是主要阻塞，真正的设计边界是“短语音、分段、确认、隐私、防编造”。

## 推荐方案

采用“分段语音辅助填表”方案：

1. 用户进入现有 `/resume/generate`。
2. 页面提供一个“口述生成草稿”入口，但不是一段长独白，而是按模块分段：
   - 求职意向；
   - 教育经历；
   - 工作 / 实习经历；
   - 项目经历；
   - 技能证书；
   - 自我介绍。
3. 每段录音最多 58 秒，前端超时自动停止；后端保留 4MB 文件上限。
4. 每段录音先走 `POST /api/v1/resume/voice/transcribe`，只返回转写文本。
5. 页面显示转写文本，用户可编辑、重录、丢弃。
6. 用户确认后，文本才反填当前模块的表单字段。
7. 用户检查完整表单后，再点击既有“生成简历”按钮，走现有 `/resume/generate`。

局部字段也可使用同一个录音弹窗，服务长文本字段：经历描述、项目描述、技能总结、自我介绍。

## 后端设计

### 通用 ASR 模块

把 `AsrService` 从 `mock-interview` 子域提升为通用模块：

- 新增 `services/api/src/asr/asr.module.ts`
- 新增 `services/api/src/asr/asr.service.ts`
- `MockInterviewModule` 改为导入 `AsrModule`

移动后保留既有 provider 行为：

- `ASR_PROVIDER=disabled`：返回 `ASR_NOT_CONFIGURED`
- `ASR_PROVIDER=tencent`：腾讯一句话识别
- `ASR_PROVIDER=baidu`：百度短语音识别
- `ASR_MAX_AUDIO_BYTES=4MB`
- 日志只记录 provider、耗时、字数、字节数、错误类型，不记录音频和转写正文

### 简历语音转写端点

新增：

`POST /api/v1/resume/voice/transcribe`

请求：

- `multipart/form-data`
- 字段 `audio`
- 文件名建议 `resume-voice.wav`

响应：

```json
{
  "text": "我在学校做过校园社团宣传项目..."
}
```

错误：

- `AUDIO_MISSING`
- `ASR_NOT_CONFIGURED`
- `ASR_FAILED`
- `ASR_AUDIO_TOO_LARGE`

端点必须：

- 使用内存文件拦截器；
- 不持久化音频；
- 不写 FileObject；
- 不写 COS；
- 不把转写全文写入日志；
- 加限流，优先沿用简历 / 公共终端已有 throttle 风格。

### 是否新增 LLM 草稿结构化端点

本轮首版不做自由文本到整份结构化简历的 LLM 自动拆分端点。原因：

- 长语音不适配现有 ASR；
- 自由文本结构化容易把 ASR 错误放大成简历事实错误；
- 现有 `/resume/generate` 的安全契约是“结构化输入只润色”，不应把自由文本解析和润色混在一起。

如果后续确实要做“整段转写 -> 结构化草稿”，必须单独立项并加事实字段确认门禁，不并入 Wave 4 首版。

## 前端设计

在 `ResumeGeneratePage` 内新增两个小组件：

- `ResumeVoiceInputButton`：字段旁麦克风按钮，负责打开录音弹窗。
- `ResumeTranscriptConfirmDialog`：录音、停止、转写、编辑确认、重录、丢弃。

UI 规则：

- 只在长文本字段旁显示麦克风按钮。
- 姓名、电话、邮箱默认不显示语音按钮。
- 弹窗文案提醒公共场所隐私：请不要大声说出手机号、身份证号、银行卡号等敏感信息。
- ASR 未启用时，隐藏语音入口或显示“语音识别暂不可用，请使用文字输入”。
- 转写文本只存在 React state；不写 `localStorage` / `sessionStorage`。
- 页面卸载、返回首页、待机清理时必须释放录音资源并清掉转写中间态。

## 隐私与合规

- 音频只在浏览器内存和 API multipart 内存中短暂存在。
- 音频不落库、不入 COS、不进 FileObject。
- 转写文本进入表单前必须用户确认。
- 高敏字段不自动语音填充。
- 生成结果仍只用于用户本人自用、下载和打印，不提供平台投递、企业收取简历、候选人推荐或面试邀约。
- ASR 失败不能 mock 成功，必须回退文字输入。

## 验收口径

本轮完成后可以宣称：

- “支持在简历生成页用分段语音辅助填写简历草稿。”
- “语音识别结果可编辑确认后再生成简历。”
- “生成后的简历继续支持现有 PDF / Word / TXT / Markdown 导出。”

本轮不能宣称：

- “长语音一键自动生成完整简历。”
- “语音识别 100% 准确。”
- “离线语音识别。”
- “自动识别并填写所有个人敏感信息。”
- “Windows 真机出纸已完成。”
- “正式生产商用闭环已完成。”

## 验证门禁

新增或扩展：

- `verify:resume-voice-generate`：后端静态 / 单元门禁，覆盖音频不落库、ASR disabled 诚实失败、文件大小限制、日志不含正文。
- `verify:resume-diagnosis-flow-ui` 或新增 Kiosk voice UI verify：覆盖语音入口只在生成页和长文本字段出现、PII 字段无语音按钮、转写确认后才填表、无价格文案。
- API / Kiosk typecheck。
- API / Kiosk lint。
- Kiosk 生产 build。

预生产验收：

- `ASR_PROVIDER` 真实配置时，用合成短 WAV 跑公网转写。
- `ASR_PROVIDER=disabled` 或凭证缺失时，确认页面诚实回退文字输入。
- 用语音转写文本填入表单后，继续跑 `/resume/generate`、导出 PDF、`printFileUrl` 安全探针。

