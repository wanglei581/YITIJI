# AI 标识、合规文案与提示词审计（2026-09-26）

> 来源：2026-09-26 全面审查，Grok 对候选 `aad9a7a39` 只读审计（不改代码），Claude 抽查。口径见 [compliance-boundary.md](../compliance/compliance-boundary.md) §1.2 A、E 与 [feature-scope.md](../product/feature-scope.md) §0.5。
> 用途：给 next-tasks 3.5c（AI 标识）、3.14（简历对照去档位、托管 a 撤入口）与提示词公平就业约束的施工清单。一体机与小程序页面由 Claude 改，服务端提示词与 PDF 由 Grok 分路改；改完按文末建议补门禁。
> 行号是 `aad9a7a39` 时的位置，施工前以当时代码为准。

**表一「AI 标识覆盖」**

| 功能 | 展示或导出位置（文件:行） | 显式标识 | 隐式标识 | 建议 |
|---|---|---|---|---|
| 简历诊断（屏） | `apps/kiosk/src/pages/resume/ResumeReportPage.tsx:72`、`:75`；文案源 `packages/shared/src/types/complianceCopy.ts:40` | 部分。真实结果写「供本人修改简历时参考」「诊断报告仅供求职准备参考」，句中没有「AI 生成」。演示态 `:69` 才写「演示用 AI 生成」 | 无 | 真实报告说明改为「AI 生成，仅供参考，请对照原文核对」 |
| 简历诊断 PDF | `services/api/src/ai/resume/diagnosis-report-pdf.service.ts:34`、`:142`、`:101` | 有。页眉「AI 生成，仅供参考，请自行核对」 | 有。`Subject` 写明 AI 生成 | 保持页眉；屏显与 PDF 用同一句 |
| 简历优化对照（屏） | `apps/kiosk/src/pages/resume/components/resume-compare/ResumeCompareCard.tsx:55`；`apps/kiosk/src/pages/resume/components/resume-deliver/ResumeAigcBadge.tsx:7` | 部分。「AI 生成，仅供本人核对」「请自行核对后再带走」，没有「仅供参考」 | 无 | 改成「AI 生成，仅供参考，请自行核对」 |
| 简历优化（小程序，已上传） | `apps/miniapp/pages/resume-optimize/resume-optimize.wxml:68`；失败态 `:33` | 部分。成功区是「优化结果仅供参考」；「AI 生成」只出现在校验失败 | 无 | 成功区改为「AI 生成，仅供参考，请核实后再使用」 |
| 简历生成/优化 PDF | `services/api/src/ai/resume/resume-pdf.service.ts:122-135` | 无。注释写明不加页眉页脚 | 有。非草稿路径 `AIGenerated=true` | 在页脚加「AI 生成，仅供参考，请自行核对」。草稿路径保持 `AIGenerated=false` |
| 简历优化 DOCX | `services/api/src/ai/resume/resume-docx.service.ts:137-148` | 无。正文 `children` 只有简历段落 | 有。`subject`/`description`/`AIGenerated` | 在文档末段加同一句显式标识 |
| 简历对照（一体机结果） | `apps/kiosk/src/pages/resume/jobFit/jobFitQxKit.tsx:267-276`；`DecisionSummaryBar.tsx:26-31` | 无。展示的是「准备程度 / 较高·中等·偏低」 | 无 | 去掉档位；页顶写「AI 生成，仅供参考」，只列已写到、未体现和改进建议 |
| 简历对照行动清单 | `apps/kiosk/src/pages/resume/JobFitActionsPage.tsx:565`、`:623` | 有。正文加 `AigcMark`（`apps/kiosk/src/ai/AiEvidence.tsx:40` 为「AI 生成内容（AIGC）· 仅供参考」） | 无 | 结果主屏与这一页用同一句 |
| 简历对照（小程序，已上传） | `apps/miniapp/pages/job-fit/job-fit.wxml:77`、`:94` | 部分。进行中只有「分析结果仅供参考」；结果区写「由 AI 根据……整理，仅供你本人……参考」 | 无 | 两处都改成「AI 生成，仅供参考」 |
| 简历对照 PDF | `services/api/src/ai/resume/job-fit-pdf.service.ts:53`、`:59`、`:63`、`:30` | 部分。可见句是「本报告仅供本人参考」，没有「AI 生成」，并印出「参考等级」 | 有。`Subject` | 可见页眉改为「AI 生成，仅供参考」；删掉参考等级和「决策报告」 |
| 职业规划（屏） | `apps/kiosk/src/pages/resume/CareerPlanPage.tsx:586`；`components/career-plan/CareerPlanSection.tsx:139`；`apps/miniapp/pages/career-plan/career-plan.wxml:81`（`:61` 进行中较弱） | 有。小程序进行中 `:61` 只有「建议仅供参考」 | 无 | 进行中与结果用同一句「AI 生成，仅供参考」 |
| 职业规划 PDF | `services/api/src/ai/resume/career-plan-pdf.service.ts:66`、`:42` | 无。「本建议单仅供本人职业发展参考」 | 有 | 页眉补「AI 生成，仅供参考」 |
| 自我探索（屏） | `apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx:925`；`apps/miniapp/pages/self-explore/self-explore.js:52` | 有 | 无 | 保持 |
| 自我探索 PDF | `services/api/src/ai/resume/self-assessment-pdf.service.ts:49`、`:77`、`:31` | 部分。可见句写「仅作为自助参考」「不构成能力评价」，没有「AI 生成」 | 有 | 解读段前加「AI 生成，仅供参考」；规则打分段落标明不是 AI |
| 模拟面试报告（一体机） | `apps/kiosk/src/pages/interview/InterviewReportPage.tsx:216`、`:226` | 部分。写「仅供本人面试练习」，没有「AI 生成」 | 无 | 横幅改为「AI 生成，仅供参考，只用于本人练习复盘」 |
| 模拟面试报告（小程序，已上传） | `apps/miniapp/pages/interview-result/interview-result.wxml:110` | 有。「以上复盘由 AI 生成，仅供个人练习参考」 | 无 | 与一体机对齐成同一句 |
| 模拟面试 PDF | `services/api/src/mock-interview/interview-report-pdf.service.ts:63`、`:66`、`:43` | 部分。可见免责没有「AI 生成」，并印「练习表现等级」 | 有 | 页眉补「AI 生成，仅供参考」 |
| 面试进行中 | `apps/kiosk/src/pages/interview/session/InterviewSessionPanels.tsx:81` | 部分。「模拟练习，仅供参考」 | 无 | 改为「题目由 AI 生成，仅供参考」 |
| 岗位 AI 推荐 | `apps/kiosk/src/pages/jobs/components/JobAiResultPanel.tsx:42`、`:94`；入口 `apps/kiosk/src/pages/jobs/JobsPage.tsx:475` | 部分。只有「仅供参考」，推荐卡展示「匹配参考：较高」 | 无 | 托管 a 下撤下该入口；若保留自填对照，去掉档位并写「AI 生成，仅供参考」 |
| 参会准备单（屏） | `apps/kiosk/src/pages/job-fairs/components/FairVisitPlanSections.tsx:92`、`:104` | 有。「AI 生成，仅供参考」 | 无 | 托管 a 下这页随招聘会一起撤出我们的云 |
| 参会准备单 PDF | `services/api/src/ai/resume/fair-visit-plan-pdf.service.ts:63-66`、`:36-38` | 无。可见句没有「AI 生成」 | 有 | 页眉补「AI 生成，仅供参考」 |
| AI 助手（小程序，已上传） | 页顶 `apps/miniapp/pages/assistant/assistant.wxml:27` 绑定 `assistant.js:69`；单条回复 `assistant.js:151-153`、`assistant.wxml:39-44` | 部分。页顶有「由 AI 生成」；真实回复故意不挂标识，只给降级话术打标 | 无 | 每条模型回复保留一句「AI 生成，仅供参考」，降级条继续标明不是模型生成 |
| AI 助手（一体机对话） | `apps/kiosk/src/pages/assistant/AssistantPage.tsx:608` | 部分。只有「仅供参考」 | 无 | 补「AI 生成，仅供参考」 |
| 顾问作业舱 / 语音条 | `apps/kiosk/src/pages/assistant/AdvisorCockpit.tsx:99`；`AssistantCallPanel.tsx:290` | 作业舱有 `AigcMark`。语音条是「AI 内容仅供参考」，没有「AI 生成」 | 无 | 语音条改成同一句 |
| 顾问作业 PDF | `services/api/src/advisor/advisor-pdf.service.ts:35`、`:58-60`；免责原文 `advisor-skills.ts:42`「AI 判断，仅供参考」 | 有 | 有 | 可见句补上「AI 生成」，与屏显一致 |
| 合同审查（一体机 + PDF） | `apps/kiosk/src/pages/contract-review/ContractReviewResultPage.tsx:386`；PDF `services/api/src/contract-review/contract-review-report-pdf.service.ts:49`、`:92`、`:26-32` | 有。「AI 生成」和风险提示都在 | 有。页眉、页脚、`AIGenerated` | 保留 AI 标识；把「法律意见」从对外句子里拿掉（见下表） |
| 合同审查（小程序） | `apps/miniapp/pages/contract-review/` 整目录 | 不进入上传包。`project.config.json:95-97` 忽略，`app.json` 未注册 | — | 保持停放 |

未当作缺标识：求职材料是模板渲染，`apps/miniapp/pages/job-materials/job-materials.js:6` 故意不写「AI 生成」。面试题目单 PDF 与职业规划降级 PDF 写 `AIGenerated=false`，与「里面没有模型文字」一致。

**表二「冲突文案」**

| 端 | 文件:行 | 原文 | 问题 | 建议改成 |
|---|---|---|---|---|
| 一体机 | `apps/kiosk/src/pages/home/components/QxHomeView.tsx:64` | 查看来源与更新时间，去来源平台投递；徽标「N 个在招」 | 托管 a：首页岗位卡和投递按钮仍在 | 机构终端改为「本机构官方渠道」；自营点位不显示这张卡 |
| 一体机 | `QxHomeView.tsx:146` | 找工作 | 招聘类快捷入口 | 删除该按钮 |
| 一体机 | `QxHomeView.tsx:219` | 岗位信息 / 查看岗位 | 岗位卡仍指向岗位服务台 | 同官方渠道口径，不写查看岗位 |
| 一体机 | `QxHomeView.tsx:259-262` | 招聘会 / 查看招聘会 | 招聘会入口仍在首页 | 自营点位隐藏；机构终端不展示场次列表 |
| 一体机 | `apps/kiosk/src/pages/home/homeV6Domains.ts:105` | 岗位匹配 | 入口名仍是匹配档，不是「简历对照」 | 简历对照 |
| 一体机 | `homeV6Domains.ts:113-116` | 岗位信息；第三方来源岗位与企业入口 | 服务域仍是招聘列表 | 本机构官方渠道 |
| 一体机 | `apps/kiosk/src/pages/jobs/JobDetailPage.tsx:310`、`:321` | 扫码投递；去来源平台投递 | 岗位详情上的投递按钮 | 撤下详情页；不保留这两个按钮 |
| 一体机 | `apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx:251` | 扫码预约 | 招聘会预约按钮 | 撤下该页 |
| 一体机 | `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx:180` | 去来源平台投递 | 参会企业上的投递按钮 | 撤下该页 |
| 一体机 | `apps/kiosk/src/pages/campus/components/CampusTabs.tsx:144` | 扫码预约 · 去来源平台办理 | 校招页预约按钮 | 撤下预约按钮 |
| 一体机 | `apps/kiosk/src/pages/profile/me/MyActivityPage.tsx:119` | 先去看岗位……去来源平台投递 | 「我的」把用户送回岗位列表 | 删除这条起步引导 |
| 一体机 | `apps/kiosk/src/pages/jobs/JobsPage.tsx:475` | AI岗位推荐……仅供参考 | 云上岗位推荐入口 | 删除推荐入口 |
| 一体机 | `jobFit/jobFitResultSpec.ts:37-40` | 这次匹配，准备程度较高；匹配参考已返回 · 较高 | 简历对照给出胜任力档 | 删档位，只留已写到、未体现、改法 |
| 一体机 | `jobFitResultSpec.ts:73`、`:79` | 偏低不代表不能投 | 对是否去投递表态，贴近「建议投递」 | 删掉这句，不评价该不该投 |
| 一体机 | `jobFit/DecisionSummaryBar.tsx:26` | 岗位决策参考 · 匹配参考：较高 | 决策档 + 等级 | 简历对照 · AI 生成，仅供参考 |
| 一体机 | `jobFit/jobFitQxKit.tsx:271-275` | 准备程度 / 较高·中等·偏低 | 三档梯子 | 去掉判定卡 |
| 一体机 | `jobs/components/JobAiResultPanel.tsx:7-9`、`:94` | 匹配参考：较高 / 中等 / 偏低 | 推荐结果上的胜任力档 | 不展示档位 |
| 一体机 | `jobs/components/JobsQxChrome.tsx:9` | 从当前真实岗位中给出参考等级和理由 | 承诺输出等级 | 填一份岗位要求，只对照已写到和未写到的要点 |
| 服务端 PDF | `ai/resume/job-fit-pdf.service.ts:53`、`:63` | 岗位匹配决策报告；参考等级： | 导出文件带决策档 | 标题改为「简历对照」；删除参考等级行 |
| 服务端提示词回显 | `ai/resume/llm-job-fit.service.ts:157` | summary 要求「2-3 句总评」 | 总评会被页面和 PDF 印出来 | 改成已写到与未体现的要点，不写总评 |
| 一体机 | `contract-review/ContractReviewHomePage.tsx:157`、`:351` | 非法律意见；不构成正式法律意见 | 对外写出「法律意见」 | 仅作条款风险提示，请自行核对原文 |
| 一体机 | `ContractReviewResultPage.tsx:386` | 不构成正式法律意见 | 同上 | 本结果由 AI 生成，仅供参考，只提示需要核对的条款 |
| 一体机 | `ContractReviewProcessingPage.tsx:388` | 不构成正式法律意见 | 同上 | 本次结果仅作风险提示，请自行核对原文 |
| 一体机 | `assistant/advisorScenes.ts:92-94`、`:106` | 不构成……法律意见 | 助手场景对外写「法律意见」 | 仅供个人核对，不代替专业人士判断 |
| 服务端 PDF | `contract-review-report-pdf.service.ts:92`、`:128` | 不构成正式法律意见；不构成法律意见 | 导出页脚、文末对外写「法律意见」 | AI 生成，仅作风险提示，请自行核对原文 |
| 小程序 | `pages/package-create/package-create.wxml:115`；`package-create.js:322` | 彩色（可切换） | 彩色打印未按终端开通，这里却能选中。同包 `print-upload.js:160` 已写「彩色打印暂不可选」 | 彩色按钮置灰，旁注「该服务点未开通彩色打印」 |
| 一体机 | `resume/components/resume-deliver/ResumePricingBar.tsx:40` | 可用权益 N 次 | 权益抵扣未接通，却写成可用次数。活动页 `BenefitActivityDetailPage.tsx:216-217` 已写「抵扣功能尚未开放」 | 抵扣尚未开放，本次按标价计费 |
| 一体机 | `print/components/PrintConfirmView.tsx:550` | 费用行名「权益抵扣」 | 确认页把抵扣写成计价项目 | 行名改为「优惠」；未开放时写「抵扣尚未开放，按原价」 |
| 小程序 | `pages/privacy/privacy.js:426-434`；`privacy.wxml:108-111` | 确认钮「仍要提交」/「提交注销请求」 | 说明写了未开放，主按钮仍像能办成注销 | 去掉提交钮，只留「线上自助注销未开放，请联系现场工作人员」 |
| 后台文案库 | `packages/shared/src/types/complianceCopy.ts:96-97` | 系统仅作为第三方信息的聚合入口……所有岗位必须显示……外部跳转链接 | 管理员看到的仍是「我们在聚合招聘信息」，与托管 a「云上不存岗位、只留紧急下架」不一致 | 我们的云不发布岗位与招聘会；此页只可查看并紧急下架 |
| 机构后台 | `apps/partner/src/routes/jobs/index.tsx:546` | 岗位仅作为第三方来源信息展示，求职者通过「去来源平台投递/扫码投递」跳转 | 机构端仍以在营岗位管理口吻写给操作者 | 托管云上不维护岗位；完整招聘功能只在客户私有化部署中使用 |

小程序已注册、会上传的页面里，没有「查看岗位 / 去来源平台投递 / 扫码预约」这类按钮。`verify-review-scope.mjs` 的停放清单与 `app.json`、`project.config.json` 的 `packOptions.ignore` 一致。简历对照页允许用户自己粘贴岗位要求（`pages/ai/ai.js:46`）。证件照在一体机写成「尚未开放」（`PrintScanHomePage.tsx:234-235`）。Word 转换的用户句是「暂未开放」。扫描卡在能力读不到时整卡停用（`PrintScanHomePage.tsx:377-388`）。这三处不记为「写成可用」。

**表三「提示词风险」**

| 文件:行 | 原句或缺失 | 风险 | 建议补的约束句 |
|---|---|---|---|
| `services/api/src/ai/resume/llm-job-fit.service.ts:144-157` | 要求输出 `fitLevel` 高/中/低，并写「准备投递」「优先选择更匹配的岗位」「2-3 句总评」 | 直接产出胜任力档和投递倾向。全文没有性别、年龄、婚育、民族、户籍、健康这六类禁令 | 不得输出建议投递、胜任力等级、录用概率或高中低档。只列简历里已写到的要点、未体现的要点和改进建议。不得编造学历、工作经历或证书。不得基于性别、年龄、婚育、民族、户籍、健康状况作出区别对待或暗示 |
| `services/api/src/job-ai/job-ai-llm.service.ts:45-50` | 「输出岗位推荐参考」，JSON 必填 `fitLevel` | 云上岗位推荐，并强制三档。未要求匹配句必须来自简历原文，也没有六类公平就业禁令 | 同上。托管 a 下这条推荐提示词应停止对用户调用 |
| `services/api/src/ai/resume/llm-career-plan.service.ts:107`、`:114` | 「不判断人格、心理或其他敏感属性」；方向字段是「为什么适合」 | 「敏感属性」没有点名六类；「适合」会引出岗位适合度 | 不得根据性别、年龄、婚育、民族、户籍、健康状况建议方向。不得编造学历、经历或证书。方向只描述简历里已有事实的延伸，不写适合或不适合 |
| `services/api/src/ai/resume/llm-fair-visit-plan.service.ts:149-155`、`:167` | 「为什么仍值得继续跟进」「为什么适合现场优先了解」 | 用简历给企业排序，没有六类禁令 | 不得按性别、年龄、婚育、民族、户籍、健康状况挑选企业。不得编造企业、岗位或联系人。托管 a 下停止生成参会单 |
| `services/api/src/mock-interview/mock-interview-llm.service.ts:111-112`、`:175-181` | 禁止录用承诺和人格评价；报告要写「岗位匹配度参考」「专业能力表现」 | 没有六类禁令。模型仍可就年龄、婚育、健康作评价，并产出能力档 | 不得评论性别、年龄、婚育、民族、户籍、健康状况。不得编造候选人没说过的经历。练习反馈只谈表达和准备，不给胜任力等级或录用概率 |
| `services/api/src/ai/resume/llm-resume.service.ts:95` | 已写「严禁涉及年龄、性别、婚育、地域、学历歧视」 | 缺民族、户籍、健康状况 | 把禁令补全为：不得基于性别、年龄、婚育、民族、户籍、健康状况作出评价或暗示 |
| `services/api/src/ai/resume/llm-resume-optimize.service.ts:80-85` | 有「绝不编造」事实字段 | 缺六类公平就业禁令 | 补上同一句六类约束。优化只改表达，不新增学历、经历、证书 |
| `services/api/src/ai/resume/llm-resume-generate.service.ts:59-61` | 有「不得编造或暗示……学历……证书」 | 缺六类禁令 | 补上同一句六类约束 |
| `services/api/src/ai/resume/llm-self-assessment.service.ts:230-233` | 禁止临床量表、疾病、适合/不适合、推荐岗位 | 健康只覆盖到「疾病」，没有点名其余五类 | 解读不得提及性别、年龄、婚育、民族、户籍、健康状况，也不据此推断适合的工作 |
| `services/api/src/advisor/llm-advisor.service.ts:203-215` | 问答禁止编出处、禁止代投 | 问答层没有「不得编造学历、经历、证书」，也没有六类禁令。成稿函数 `:266` 才有不得编造 | 问答与成稿都加上两句：不得编造学历、工作经历或证书；不得基于上述六类作判断 |
| `services/api/src/advisor/assistant-summary.service.ts:242-243` | 不得编造学校、公司、时间、证书；不得输出录用概率 | 缺六类禁令 | 补上六类约束句 |
| `services/api/src/contract-review/contract-review-provider.service.ts:125` | 「不是律师，不得给出确定性法律结论。」 | 没有写「不构成法律意见」，也没有写「不得判断合同是否有效」 | 你不是律师。本输出不构成法律意见，不得判断合同是否有效，不得写成律师审查结论 |
| `services/api/src/ai/llm/llm-config.service.ts:87-90`；`trtc.service.ts:115-117`；`ai/llm/llm-guard.ts:1-2` | 默认人设仍提供「岗位/招聘会信息查询引导」；护栏只拼禁用词和 120 字限制 | 助手与数字人提示词可被环境变量或后台自定义替换（`assistant_chat` 允许自定义）。替换后六类禁令与防编造不会自动附上 | 在 `buildGuardedSystemPrompt` 末尾固定追加两句，自定义提示词不能删掉：不得编造学历、工作经历或证书；不得基于性别、年龄、婚育、民族、户籍、健康状况作出区别对待或暗示。角色范围改为简历、打印与政策说明，不再引导查询云上岗位和招聘会 |

**建议新增的门禁断言**

现有三条都抓不到上面的主体问题。`scripts/verify-compliance-copy.mjs` 只扫前端禁词，把「去来源平台投递」「扫码预约」当白名单，并且明确不扫 `services/api/src` 的提示词和 PDF 正文。`apps/miniapp/scripts/verify-review-scope.mjs` 只锁小程序上传包：它能拦住停放页和 `fit.fitLevel` 这几个属性名，但一体机上的「较高 / 准备程度 / 参考等级 / 找工作 / N 个在招」一个都不会红。`apps/kiosk/scripts/lib/sweep-copy-guards.mjs` 只禁「一键投递、立即投递、平台投递」三个词，还要求岗位详情必须出现「外部投递链接」，和托管 a 要撤掉这些入口的方向相反。

建议补四条断言，都对着源码字符串，不启动服务：

1. AI 结果面：列出诊断、优化、生成、简历对照、职业规划、自我探索、模拟面试、助手、顾问 PDF、合同审查、参会单的页面与 `*pdf*.ts`、`resume-docx.service.ts`。可见字符串（PDF 的 `doc.text`、DOCX 的 body，不含仅写在 `info`/`customProperties` 里的字段）必须同时出现「AI 生成」和「仅供参考」。元数据 `AIGenerated=true` 单独通过不算显式标识。题目单和降级 PDF 保持 `AIGenerated=false`，并且正文不得出现「AI 生成」。
2. 简历对照：`apps/kiosk/src/pages/resume/jobFit/**`、`JobAiResultPanel.tsx`、`job-fit-pdf.service.ts`、`llm-job-fit.service.ts` 的用户可见串与提示词不得出现「参考等级」「准备程度较高」「匹配参考：较高」「岗位决策」「总评」「建议投递」「不能投」「录用概率」。小程序侧在现有 `fit.fitLevel` 属性检查之外，再禁「较高」「中等」「偏低」这三个档位词。
3. 合同审查对外文案：`apps/kiosk/src/pages/contract-review/**`、`advisorScenes.ts`、`contract-review-report-pdf.service.ts` 的可见字符串不得包含「法律意见」「律师审查」「判断合同有效」「合同有效」。提示词文件 `contract-review-provider.service.ts` 必须包含「不是律师」「不构成法律意见」「不得判断合同是否有效」。
4. 托管 a 与未开放能力：一体机 `apps/kiosk/src/pages/home/**`、`pages/jobs/**`、`pages/job-fairs/**`、`pages/campus/**`、`pages/profile/**` 不得再出现「找工作」「查看岗位」「去来源平台投递」「扫码投递」「查看招聘会」「扫码预约」「AI岗位推荐」「个在招」。小程序 `pages/package-create/package-create.wxml` 的彩色选项必须带「暂不可选」或禁用标记。`ResumePricingBar.tsx` 与 `PrintConfirmView.tsx` 在抵扣未接通时不得出现「可用权益」。`apps/miniapp/pages/privacy/privacy.js` 在注销未开放时不得出现「提交注销请求」。另外给 `services/api/src` 里每一段 system prompt 加一条存在性断言：必须含「不得编造学历、工作经历或证书」和「不得基于性别、年龄、婚育、民族、户籍、健康状况」。
