# 四层字段核对：四条主链路完整缺口清单（2026-09-02）

> 方法：每条链路按 **输入 DTO → 服务端计算/落库 → Prisma 模型 → 对外共享契约** 四层逐层比对。
> 全部人工追查，每条结论都能指到文件。自动化尝试的失败记录见文末，避免下一个人重走。

## 结论速览

| 链路 | 确证缺口 | 严重度 |
|---|---|---|
| 打印下单 → 取件 → 出纸 | `duplex` 采集/计价/落库都有，对外契约没有 | **高**（用户付了双面的钱却看不到） |
| 简历 → AI 诊断 → 优化 | `ResumeReport` 缺内容块片段、问题对象、证据引用三类结构 | **高**（新报告页主视觉全靠它） |
| 招聘会浏览 → 导览 → 物料 | 2 个死字段 + 2 处说明书命名/形状不符 | 中（误导施工，不影响用户） |
| 岗位 → 企业 → 跳转来源 | `publishedAt` 落库但不外露 | 低 |

---

## 一、打印链路：`duplex` 只进不出

| 层 | 状态 | 位置 |
|---|---|---|
| 输入 DTO | ✅ `dto.duplex` | `member-print-order-create.service.ts:62` |
| 计价 | ✅ 按终端能力登记 fail-closed 判定，未登记机器直接拒单 | 同文件 121–124 行注释 |
| 落库 | ✅ 进 `Order.printParamsJson` | 同文件 141 行 |
| **对外契约** | ❌ **`MemberPrintOrderItem` 无此字段**（grep 计数 0） | `packages/shared/src/types/memberPrintOrders.ts` |

同契约里 `copies`、`colorMode`、`paperSize` 都有，唯独漏 duplex。
**后果**：用户在「我的 → 打印订单」看不到这单是不是双面；补打、申诉时无法复现参数。
**修法**：`MemberPrintOrderItem` 增 `duplex`，读取侧从 `printParamsJson` 取出即可，无需迁移。

## 二、简历链路：报告页要的三类结构，契约里没有

`ResumeReport` 现有：`sections[]`（key/label/score/maxScore）、`suggestions: string[]`、
`riskNotes?`、`priorities?`。

原型 `22-resume-report.html` 第 12–31 行**自行声明了这个缺口**（用「夹具」标记，
并写明「服务端合同当前没有这个字段」）。它需要的是：

1. **内容块**：简历切成七块，每块摆实际片段，标出命中几条问题、几条原文证据
2. **问题对象**：每条问题带 → 所属诊断维度、严重度、**引用的那句原文**、对读者的影响、怎么改
3. **证据引用**：问题与原文的对应关系

现有 `suggestions: string[]` 是扁平字符串，既无维度归属也无严重度和原文定位。
**这是四条里工作量最大的一条**：要改的不只是类型，还有 LLM 的输出结构与提示词
（模型必须返回带原文 span 的结构化 findings，而不是一段建议文字）。

## 三、招聘会链路：死字段与说明书不符

**死字段**（只在共享类型存在，API / Prisma / 51 页原型三方都不出现）：
- `ExternalJobFair.onsiteServices`
- `ExternalJobFair.admissionMethod`

对照契约当说明书的开发会被它们误导，建议删除或标注保留原因。

**说明书与实现不符**（原型头部 `api:` 声明 ↔ 后端实际）：
| 原型写 | 后端实际 |
|---|---|
| `GET /job-fairs/:id/booth-map` | `GET /job-fairs/:id/map` |
| `POST /job-fairs/:id/visit-plan` | `POST /job-fairs/:fairId/visit-plan/:taskId`（需 taskId） |

八个分屏（list / checkin / detail / companies / map / materials / visit-plan / stats）
的端点**全部存在**，无功能缺口。

## 四、岗位链路：合规字段齐备，`publishedAt` 缺外露

`CLAUDE.md §10` 要求岗位详情必须展示的五项，**全部齐备**——它们在基接口
`ExternalJobSource` 上（`sourceOrgId`、`sourceName`、`syncTime`、`externalId`、`sourceUrl`），
`dataSourceNote` 在 `ExternalJobDTO` 上。

唯一缺口：`publishedAt`（发布时间）在 Prisma 有、契约无，而原型 `27-browse-detail`
把它列进了要画位置的字段。

> ⚠️ 核对过程中我一度误判为「缺三项合规字段」，原因是只看了 `ExternalJob` 自身而
> **没有跟 `extends ExternalJobSource` 这条继承链**。后续做同类核对必须跟完继承链。

---

## 为什么只能人工追：两次自动化尝试的失败记录

| 判据 | 结果 | 失败原因 |
|---|---|---|
| 契约字段在 API 侧从不赋值 | 25 个接口命中，抽查前两个全是误报 | 跨层派生与预留字段：`PrinterStatus.hasPaper` 由后端状态字符串派生；`PrintJobParams.collate/paperType/feeder` 是注释写明的「开放 API 预留、驱动待验证」 |
| 写入侧 DTO 有、读取契约无 | 14 个模块命中，绝大多数误报 | `adminSecret`、`newPassword`、`phoneCode`、`syncTimeFrom` 这类本就只进不出 |
| grep「夹具」当缺口清单 | 假设错误 | 16 页 172 处中，绝大多数是 `?debug=1` 门控的**演示数据**约定，不是契约缺口；只有 22 页用的是「服务端合同当前没有这个字段」这个含义 |

**根因**：关键业务数据不在字段里。schema 的 96 个模型里有 **36 个 JSON 字符串列**
（`printParamsJson`、`itemsJson`、`payloadJson`×4、`resultJson`×2 …）。
字段级核对在 JSON 边界处失效，数据库层面也无任何约束——
`duplex` 正是这样丢的，而且丢了很久无人发现。

**建议**：优先把 `Order.printParamsJson`、`Order.itemsJson`、AI 评分三处拆成真实字段。
不是上线必需，但「每个功能每个按钮都对应上」这个目标在 36 个 JSON blob 面前无法机械验证。
