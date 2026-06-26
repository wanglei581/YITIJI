# 项目规范化 T5：D 类外部材料索引报告

> 生成时间：2026-06-21
> 分支：`codex/normalization-external-materials-index`
> 范围：主工作区 `docs/business/`、`deliverables/`、`opc-doc/` 外部材料索引；不提交原始外部材料，不移动、不删除主工作区文件。

## 结论

T5 不把 D 类外部材料整包纳入仓库。`docs/business/`、`deliverables/` 和 `opc-doc/` 同时包含商业计划、OPC 协作产物、路线图、PDF、JSON 状态和系统垃圾文件；它们的价值在于“后续转正式材料的输入”，不是当前就整包提交。

本轮只沉淀：

- 外部材料的清单和处置规则。
- 哪些 Markdown 后续可转正式文档。
- 哪些 PDF / 二进制应仓库外归档。
- 哪些 OPC 输出只作为商业策略输入。
- 哪些本地垃圾或过程态文件不入库。

## 快照统计

统计来源为主工作区 D 类外部材料目录，统计时间为 2026-06-21。

采样命令包括 `find docs/business deliverables opc-doc -maxdepth 3 -type f`、`du -sh docs/business deliverables opc-doc`、`git status --short --ignored docs/business deliverables opc-doc` 和 `git ls-files docs/business deliverables opc-doc`。

| 项目 | 数量 / 大小 |
| --- | ---: |
| 文件总数 | 27 |
| Markdown | 17 |
| JSON | 6 |
| PDF | 3 |
| `.DS_Store` | 1 |
| `docs/business/` | 约 1.9M |
| `deliverables/` | 约 24K |
| `opc-doc/` | 约 236K |

敏感扫描结论：未发现预生产主机、本机绝对路径、工具日志路径、file URL、AK、私钥或可直接使用的密钥值。

## Git 状态事实

T5 必须区分“新增不入库”和“历史已跟踪”：

| 路径类别 | Git 状态 | 处置 |
| --- | --- | --- |
| `docs/business/AI求职打印服务终端-B2G-B2B2C线下就业服务终端解决方案.pdf` | T5 快照时已跟踪；2026-06-26 已移出 Git 并仓库外归档 | 原件归档到 `其他文档/商业材料/PDF归档/`；仓库内只保留 Markdown 商业计划和评审材料 |
| `docs/business/*专家评审报告.md` | 未跟踪 | 可转正式评审文档候选；T5 只索引 |
| `docs/business/*专家评审报告.pdf` | 未跟踪 | 仓库外归档候选；T5 不提交 |
| `docs/business/*参赛项目简介.md` | 未跟踪 | 可转正式对外简介候选；T5 只索引 |
| `docs/business/*OPC创业大赛商业计划书.md` | 未跟踪 | 可转正式商业计划候选；T5 只索引 |
| `docs/business/*商业计划书.md` | 未跟踪 | 旧版商业计划候选；需和 OPC 版合并去重后再转正 |
| `docs/business/*商业计划书.pdf` | 未跟踪 | 仓库外归档候选；T5 不提交 |
| `deliverables/product-strategy/*.md` | 未跟踪 | 路线图转正式产品/运营计划候选；后续已转入 `docs/product/roadmap-update-launch-2026Q3-2027Q2-2026-06-17.md` |
| `deliverables/README.md` 与 3 个宣传片 Markdown | T5 后续曾被跟踪；2026-06-26 已移出 Git 并仓库外归档 | 逐字节一致副本保留在 `其他文档/deliverables/`；OPC 成品完整性记录迁入本文下方 |
| `opc-doc/outputs/` | 已被 ignore | 只作为商业策略输入；不直接入库 |
| `opc-doc/state/*.json` | 未跟踪且未忽略 | 过程态状态文件；不入库，后续可随 `opc-doc/` 外部归档或本地保留 |
| `opc-doc/.DS_Store` | 已被 ignore | 本地垃圾；可本地删除，不入库 |

## Markdown 转正式文档候选

| 来源 | 价值 | 转正前置条件 |
| --- | --- | --- |
| `docs/business/AI求职打印服务终端-B2G-B2B2C方案-专家评审报告.md` | 对既有 B2G/B2B2C 方案提出品牌名、商业模型、已完成功能呈现不足等修订意见 | 转为正式评审报告前需去掉聊天式表达，保留事实/建议/风险分级 |
| `docs/business/职易达AI求职服务终端-参赛项目简介.md` | 可作为 OPC 报名和对外简介短版素材 | 转正前需统一品牌名、确认是否继续使用“职易达” |
| `docs/business/职易达AI求职服务终端-青岛OPC创业大赛商业计划书.md` | 较完整的 OPC 商业计划书，明确事实、预测假设和待补充信息边界 | 可作为正式商业计划基线；转正时必须保留事实/预测边界 |
| `docs/business/职易达AI求职服务终端商业计划书.md` | 较早商业计划书版本 | 只作为旧版参考；需与 OPC 版合并去重，不直接作为当前唯一版本 |
| `deliverables/product-strategy/roadmap-update-launch-2026Q3-2027Q2-2026-06-17.md` | 2026 Q3 到 2027 Q2 路线图，强调上线窗口、P0 技术债、外部资源和商业化路径 | 可转为正式路线图，但上线日期、资源到位时间和预测指标需按最新事实复核 |

## PDF 与二进制处置

| 来源 | 状态 | 处置 |
| --- | --- | --- |
| 已跟踪旧方案 PDF | T5 快照时仓库历史中已经存在；2026-06-26 已清理 | 原件仓库外归档；仓库内不再跟踪该 PDF |
| 专家评审报告 PDF | 未跟踪，有同名 Markdown | 仓库外归档；仓库内只保留 Markdown 转正后的文本 |
| 商业计划书 PDF | 未跟踪，有同名 Markdown | 仓库外归档；仓库内只保留 Markdown 转正后的文本 |

规则：

- 新增 PDF、PPT、DOCX、ZIP、图片和压缩包默认不进 Git。
- 有 Markdown 源的 PDF 作为导出版，优先仓库外归档。
- 无 Markdown 源但已经跟踪的 PDF，清理必须另起任务，先确认外部归档位置和是否仍需保留。

## 交付物归档完整性记录（2026-06-26 迁入）

原 `deliverables/README.md` 与 3 个宣传片 Markdown 已从 Git 移出，逐字节一致副本保留在本地 `其他文档/deliverables/`。为避免删除 `deliverables/README.md` 后丢失仓库内留痕，本节迁入 OPC 2026 交付物清单和 sha256 校验记录。

外部存储位置仍为本机归档，待上传 COS / 网盘 / GitHub release 附件后再补可访问 URL 与访问权限。本机归档目录：`/Users/wanglei/Documents/AI求职打印服务终端交付物归档/OPC-2026-06/`。

| 文件 | 类型 | 大小(字节) | 原仓库相对路径 | 对应 Markdown 源 |
| --- | --- | ---: | --- | --- |
| `AI求职打印服务终端-交互演示.html` | HTML | 51332 | `deliverables/opc-参赛材料/` | 无（app / PPT 衍生导出） |
| `AI求职打印服务终端-演示PPT.pptx` | PPTX | 4925351 | `deliverables/opc-参赛材料/` | 内容源＝668 行 BP |
| `AI求职打印服务终端-演示PPT.pdf` | PDF | 1084405 | `deliverables/opc-参赛材料/` | 同上（PPT 的 PDF 导出） |
| `职易达-OPC路演PPT.pptx` | PPTX | 341980 | `deliverables/opc-参赛材料/` | 内容源＝668 行 BP |
| `职易达-OPC路演PPT.pdf` | PDF | 654476 | `deliverables/opc-参赛材料/` | 同上 |
| `职易达-OPC参赛项目介绍.docx` | DOCX | 26628 | `deliverables/opc-参赛材料/` | 约等于参赛项目简介.md |
| `职易达-项目介绍.pdf` | PDF | 583157 | `deliverables/opc-参赛材料/` | 约等于参赛项目简介.md / 668 行 BP |
| `AI求职打印服务终端-B2G-B2B2C方案-专家评审报告.pdf` | PDF | 805630 | `docs/business/` | 专家评审报告.md |
| `职易达AI求职服务终端商业计划书.pdf` | PDF | 1064859 | `docs/business/` | 232 行叙述版 BP |
| `职易达AI求职服务终端商业计划书.md` | Markdown | 22195 | `docs/business/` | 668 行 canonical BP 的叙述体重复 |

可用下列 `shasum -a 256` 清单在归档目录校验完整性：

```text
c2b10c6af96a81ce13f3d1d80b826f74259b9979a30a84dc28e5ca0a704d3869  AI求职打印服务终端-交互演示.html
e4291266f1582066025d08f1fdec996bbbda3e6cab1c71b5a0d8bfd1c58c42ae  AI求职打印服务终端-演示PPT.pptx
5d103573f96d5a73e3c3f18bd9086084767cd4c88b4545e74d55787bb89dbd16  AI求职打印服务终端-演示PPT.pdf
3abd952c7371cde1178967e3550029a278ac61a5d7f94503e1ee7f32b0b253f3  职易达-OPC路演PPT.pptx
066634de496df69bf424cdac217d98df6714f9b24c42fd47173dd9bedc4d5542  职易达-OPC路演PPT.pdf
827851a73e04a6ccd178ae2f698202941287819d4ab01b7d6733a0e35a9a3adc  职易达-OPC参赛项目介绍.docx
870cb0ccbfef18b8a640a92f7da4c6febaf263c67ade09a12110d589edaa35f4  职易达-项目介绍.pdf
7413d1acef0c1651fd5f5606617131937d6c094d8f43447e61c2804af781f579  AI求职打印服务终端-B2G-B2B2C方案-专家评审报告.pdf
125784a37a96167e35e293b17d925b5f4f004b2c5f67da1e37c19d6f0f615c3c  职易达AI求职服务终端商业计划书.pdf
41de3e662a8595329b324ebef2e87f7356094edac12f5ffa2940e9767e02414b  职易达AI求职服务终端商业计划书.md
```

## OPC 输出与状态文件

`opc-doc/outputs/` 的价值是商业策略输入，不是正式项目事实来源。可复用主题包括：

- 资源盘点：全栈软硬件、合规边界、多模型协作、招聘会闭环、关键缺口。
- 利基定位：校园招聘会 AI 简历诊断 + 优化 + 打印一站式服务；纯工具定位，非招聘平台。
- 价值主张：学生、招聘企业、高校就业中心三方价值。
- 商业模式：Lean Canvas、BMC、定价假设、风险假设。
- 硬件原型：首台原型机采购与组装思路。

处置规则：

- 不直接提交 `opc-doc/outputs/` 原文。
- 若转正式材料，必须转成 `docs/product/`、`docs/business/` 或 `docs/strategy/` 下的独立文档，并保留事实/假设/预测边界。
- `opc-doc/state/*.json` 是过程状态，不作为正式材料；后续可随 `opc-doc/` 仓库外归档或本地保留。

## 本地垃圾与过程文件

| 文件 | 处置 |
| --- | --- |
| `opc-doc/.DS_Store` | 已被 ignore；本地可删除，不入库 |
| `opc-doc/state/*.json` | 过程态文件，不入库 |
| 未来生成的导出 PDF/PPT/DOCX/ZIP | 默认仓库外归档，仓库只保留可审查 Markdown 源或摘要索引 |

## 后续任务拆分

| 后续任务 | 输入 | 边界 |
| --- | --- | --- |
| D1 已跟踪 PDF 清理 | 已跟踪旧方案 PDF | 已于 2026-06-26 完成：原件归档到 `其他文档/商业材料/PDF归档/`，Git 不再跟踪该 PDF |
| D2 商业计划书转正 | OPC 商业计划书、旧版商业计划书、专家评审报告 | 合并为正式商业计划基线，保留事实/预测/待验证边界 |
| D3 对外简介转正 | 参赛项目简介、品牌名讨论 | 确认品牌名后转为正式项目简介 |
| D4 路线图转正 | Q3-Q2 路线图更新 | 按最新部署、真机和试运营事实复核日期与指标 |
| D5 OPC 策略输入归档 | `opc-doc/outputs/`、`opc-doc/state/` | 建仓库外归档位置或转正式摘要，不整包入库 |
| D6 `deliverables/` 跟踪文件清理 | 交付物索引和宣传片 Markdown | 已于 2026-06-26 完成：同名副本归档到 `其他文档/deliverables/`，完整性记录迁入本文 |

## 双模型分析结论

Claude 结论为 `APPROVE_PLAN`，但要求 T5 报告必须记录一个关键事实：

- 1 个旧方案 PDF 已经被 Git 跟踪，T5 只能记录为“已跟踪、待清理”，不能声明所有 PDF 都未入库。

Antigravity 结论为 `APPROVE_PLAN`：

- 同意用索引代替原始外部材料入库。
- 同意 Markdown 可作为后续正式文档候选。
- 同意 PDF、OPC 输出、状态 JSON 和 `.DS_Store` 不在 T5 直接提交。

## 验证口径

提交前必须验证：

- 暂存文件只包含 T5 报告、T5 任务记录和进度文档。
- 暂存差异不包含 `docs/business/`、`deliverables/`、`opc-doc/` 原始文件。
- 暂存差异不包含 PDF、PNG、PPT、DOCX、ZIP、`.DS_Store` 等外部材料或二进制。
- `apps/`、`services/`、`packages/` 无差异。
- 暂存敏感扫描无预生产主机、本机绝对路径、工具日志路径、file URL、AK、私钥或密钥形态命中。

## 最终口径

T5 的原始可提交结果是“外部材料索引”，不是“外部材料迁移”。后续已按独立确认完成旧方案 PDF 与 `deliverables/` 跟踪文件清理：原始材料保留在本地 `其他文档/` 或外部归档目录，仓库内只保留可审查 Markdown 正式材料、审计索引和完整性记录。
