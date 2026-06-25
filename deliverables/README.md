# 交付物归档索引（deliverables/）

> 最后更新：2026-06-23
> 关联：[../CLAUDE.md](../CLAUDE.md) §7（单一事实来源）/ §8（迁移、删除必须留痕）、[../.gitignore](../.gitignore)（deliverables 二进制忽略规则）

## 用途

`deliverables/` 存放对外交付材料。**二进制成品（PPT / PDF / DOCX / 导出 HTML）不入 Git**——避免永久撑大仓库历史，由 `.gitignore` 的 `/deliverables/**/*.{pdf,pptx,docx}` 规则拦截；原创文本（`.md`，如路线图）仍可入库。本文件是已外置二进制及重复文档的**索引与完整性记录**，使仓库即便不持有二进制，也仍是"交付物去向"的事实来源。

## 归档策略

| 类别 | 处理 |
|---|---|
| 原创文本 `.md`（如发布路线图） | 入 Git（已归位 `docs/`） |
| 二进制定稿（PPT / PDF / DOCX / 导出 HTML） | 外部归档，仓库内仅留本索引 + sha256 |
| 系统垃圾（`.DS_Store`） | 直接删除，不归档 |

## 资产清单 · OPC 2026 批次

- **外部存储位置：当前为本机归档，待上传外部存储（COS / 网盘 / GitHub release 附件）后更新为可访问 URL（并注明访问权限）。**
- 本机归档目录：`/Users/wanglei/Documents/AI求职打印服务终端交付物归档/OPC-2026-06/`
- 归档日期：2026-06-23

| 文件 | 类型 | 大小(字节) | 原仓库相对路径 | 对应 md 源（仓库内） |
|---|---|---:|---|---|
| AI求职打印服务终端-交互演示.html | HTML | 51332 | `deliverables/opc-参赛材料/` | 无（app / PPT 衍生导出） |
| AI求职打印服务终端-演示PPT.pptx | PPTX | 4925351 | `deliverables/opc-参赛材料/` | 内容源＝668 行 BP |
| AI求职打印服务终端-演示PPT.pdf | PDF | 1084405 | `deliverables/opc-参赛材料/` | 同上（PPT 的 PDF 导出） |
| 职易达-OPC路演PPT.pptx | PPTX | 341980 | `deliverables/opc-参赛材料/` | 内容源＝668 行 BP |
| 职易达-OPC路演PPT.pdf | PDF | 654476 | `deliverables/opc-参赛材料/` | 同上 |
| 职易达-OPC参赛项目介绍.docx | DOCX | 26628 | `deliverables/opc-参赛材料/` | ≈ 参赛项目简介.md |
| 职易达-项目介绍.pdf | PDF | 583157 | `deliverables/opc-参赛材料/` | ≈ 参赛项目简介.md / 668 BP |
| AI求职打印服务终端-B2G-B2B2C方案-专家评审报告.pdf | PDF | 805630 | `docs/business/` | ✅ 专家评审报告.md（175 行，已入库） |
| 职易达AI求职服务终端商业计划书.pdf | PDF | 1064859 | `docs/business/` | ＝232 行叙述版 BP（本批一并外置） |
| 职易达AI求职服务终端商业计划书.md | Markdown | 22195 | `docs/business/` | 668 行 canonical BP 的叙述体重复 |

## 资产清单 · 视频宣传素材源文件

以下为原创文本源文件，可入 Git；后续导出的成片、PPT、PDF、工程文件仍按二进制归档策略外置。

| 文件 | 用途 | 说明 |
|---|---|---|
| 职易达-60秒宣传片-脚本分镜与AI提示词.md | 路演宣传片脚本 | 通用 AI 视频工具提示词与分镜 |
| 职易达-60秒宣传片-即梦执行版-4段15秒.md | 路演宣传片执行版 | 面向即梦/Dreamina + 剪映的 4 段生成方案 |
| 职易达-官网产品宣传片-内容清单与脚本设计.md | 官网产品视频 | 官网 Hero / 主片 / 功能微片内容结构 |

### sha256 校验清单

下列为 `shasum -a 256` 格式，可在归档目录用 `shasum -a 256 -c` 校验完整性：

```
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

## 检索与访问

- 当前副本仅在仓库维护者本机归档目录；如需获取请联系维护者。
- 上传外部存储后，将"外部存储位置"替换为可访问 URL，并注明访问权限与负责人。

## 版本关联

- 批次：OPC 2026 参赛材料（"创·在青岛"创业大赛 OPC 挑战赛）。
- 仓库内文本事实来源（已入库，未外置）：
  - [`docs/business/AI求职打印服务终端-B2G-B2B2C方案-专家评审报告.md`](../docs/business/AI求职打印服务终端-B2G-B2B2C方案-专家评审报告.md)
  - [`docs/business/职易达AI求职服务终端-青岛OPC创业大赛商业计划书.md`](../docs/business/职易达AI求职服务终端-青岛OPC创业大赛商业计划书.md)（668 行，canonical BP）
  - [`docs/business/职易达AI求职服务终端-参赛项目简介.md`](../docs/business/职易达AI求职服务终端-参赛项目简介.md)
- 注：外置的 `职易达AI求职服务终端商业计划书.md`（232 行叙述版）是上面 668 行 canonical BP 的叙述体重复，不在主干双轨维护。

## 维护规则

新增交付物：先归档到外部存储 → 记录 sha256 / 大小 / 原路径 → 更新本表。**不要把二进制成品直接 `git add`**（已被 `.gitignore` 拦截）。
