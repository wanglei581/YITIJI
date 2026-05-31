# 角色边界与合规架构

> **本文档是 AI 求职打印服务终端的产品架构 SSOT**,定义谁能做什么 / 谁不能做什么,
> 以及任何"看起来缺一个端"的想法应该如何处理。
>
> **适用范围**:产品设计 / 法务复核 / BD demo / 任何"为什么不做 X" 的争论。
>
> **强制约束**:本文档与 [CLAUDE.md §1+§2](../../CLAUDE.md)、
> [compliance-boundary.md](../compliance/compliance-boundary.md)、
> [feature-scope.md](feature-scope.md) 共同生效。冲突时以 CLAUDE.md 为准。

---

## 1. 法律基础(绝不能动)

我方公司 **当前没有取得"人力资源服务许可证"**(CLAUDE.md §1 已声明)。

这意味着:
- **不能做"企业 — 候选人"撮合**(收简历转交 / 推荐候选人 / Offer 管理 等)
- **不能做"招聘信息发布平台"**(企业自主发布岗位 + 直接收简历)
- **可以做"信息聚合入口"**(展示第三方岗位 + 跳走对方平台投递)
- **可以做"求职者个人服务"**(简历优化 / 打印 / 个人 AI 助手 等)

任何超越上述边界的功能需求,**必须先取得许可证**,在此之前一律拒绝。

---

## 2. 四个角色(只有这四个)

| 角色 | 谁 | 端口 | 入口 |
|---|---|---|---|
| **Kiosk** | 求职者(无登录 / 轻量取件码) | 5173 | 21.5 寸一体机 + 浏览器 |
| **Partner** | 合作的"内容提供方机构" | 5175 | 浏览器(机构账号登录) |
| **Admin** | 我方运营人员 | 5174 | 浏览器(我方员工账号) |
| **Terminal Agent** | Windows 一体机本机后台进程 | 本机 | 无 UI |

**不存在**(刻意不做):
- ❌ Enterprise 端(字节 / 阿里 / 腾讯自己的招聘账号)
- ❌ Candidate 推送端(我方主动把求职者数据推给企业)
- ❌ HR Console 端(企业 HR 在我方系统看候选人)

---

## 3. Partner 是什么 — 关键概念

**Partner = "内容提供方机构"** ,不是企业本身。具体可能是:

| Partner 类型(`Organization.type`) | 举例 | 收益模式 |
|---|---|---|
| `school_employment_center` | 某大学就业指导中心 | 学校付费用我方一体机 + 数据接入费 |
| `public_employment_service` | 市人才交流中心 / 省级就业服务局 | 政府采购 / 公共服务合同 |
| `licensed_hr_agency` | 智联招聘 / 前程无忧 / Boss 直聘 | 数据接入分成 / 流量结算 |
| `fair_organizer` | 招聘会主办方 / 校招会公司 | 招聘会上架费 + 展位流量 |
| `enterprise_source` ⚠️ | 字节 / 阿里(以"内容提供方"身份)| 见 §5 路径 B |

**Partner 的核心职能**(已在 5175 后台实现):
- 导入岗位 / 招聘会(API 直连 / Excel / CSV / Webhook)
- 管自己机构的"数据来源凭证"(apiKey / Webhook secret 仅服务端存)
- 看自己机构的数据表现(浏览数 / 外部跳转数 / 同步日志)
- 不审核(审核由 Admin 做)

---

## 4. 每个角色的"能做"清单(白名单)

### Kiosk 能做

- 浏览岗位 / 招聘会 / 校企合作主题展(全部 `approved` + `published`)
- 扫码跳走第三方平台投递 / 预约
- 上传简历 / 扫描纸质简历 → AI 诊断 / 优化 → 打印(数据 1h 自动清理)
- 求职信 / 推荐信 / 简历模板下载 + 打印
- AI 对话助手(意图分类 + 跳转引导,不存对话原文)
- 通用文档打印 / 证件复印 / 扫描

### Partner 能做

- **数据中介**:导入第三方岗位 / 招聘会(`POST /partner/jobs/import` / `POST /partner/fairs/import`)
- 看自己机构岗位 / 招聘会的审核状态 + 数据表现
- 下架自己的岗位 / 招聘会(只能下架本机构的)
- 配置数据来源凭证(API endpoint / Webhook secret;**凭证仅服务端存,前端只见 `credentialConfigured: boolean`**)
- 看自己机构同步日志
- 子账号管理(内部分发权限)

### Admin 能做

- 审核所有 Partner 提交的岗位 / 招聘会(approve / reject / reviewing)
- 发布 / 下架(发布前必须 `reviewStatus='approved'`)
- 看全局看板(浏览数 / 跳转数 / 文件数 / AI 调用数 / 收入流水)
- 文件管理(强制清理过期 + 看每个文件的隐私倒计时)
- 审计日志查询(`GET /admin/audit-logs`)
- 合作机构管理(新增 / 停用 Partner 机构 + Partner 账号)
- 终端管理 / 打印机管理(待 Phase 8 Agent 上线)

### Terminal Agent 能做

- 拉打印任务 → 调本机打印机驱动
- 监听扫描目录 / U 盘
- 上报心跳 / 打印机状态 / 告警

---

## 5. 每个角色的"不能做"清单(黑名单)

### Kiosk 不能

- ❌ 看其他人的简历 / AI 报告
- ❌ 看任何后台入口("管理员后台" / "合作机构后台"按钮)
- ❌ 注册 / 实名 / 留存超过 1h 的个人敏感数据

### Partner 不能

- ❌ **看求职者简历内容**(简历自动 1h 清理 + 文件签名 URL 5min TTL)
- ❌ **看求职者个人信息**(姓名 / 电话 / 邮箱 — 字段层 DTO 白名单已强制)
- ❌ 看到其他 Partner 机构的数据
- ❌ 自己审核自己上架(`importJobs` 强制 `pending+draft`,等 Admin 审)
- ❌ 在导入 DTO 里塞"候选人邮箱"等任何招聘闭环字段(`forbidNonWhitelisted: true` 全局生效)

### Admin 不能

- ❌ 看求职者简历内容(管理员访问敏感文件必须落审计,且文件 1h 自动清理后无法挽回)
- ❌ 直接发布未审核内容(`PUBLISH_REQUIRES_APPROVAL` 后端硬断言)
- ❌ 跳过审计(所有写操作都同步落 `AuditLog`,DB 层无 DELETE 权限)

### Enterprise(刻意不存在的端)绝不能

由于我们**根本不建** Enterprise 端,以下"想做也做不了":
- ❌ 企业自主发布岗位 + 直接收简历(CLAUDE.md §2.8)
- ❌ 企业筛选候选人 / 查看简历列表(CLAUDE.md §2.3)
- ❌ 企业向求职者发面试邀约 / Offer(CLAUDE.md §2.4 / §2.5)
- ❌ 我方系统反向推送候选人给企业(CLAUDE.md §2.6)

---

## 6. "字节阿里腾讯想接入"的合法路径

每隔一段时间就会有 BD / 用户问"字节怎么接入"。**全部走以下两条路径之一**:

### 路径 A:走第三方聚合方(默认 / 推荐)

```
字节有自己的招聘官网(careers.bytedance.com)
   ↓
智联 / 前程 / Boss 从字节官网 API 同步岗位(他们有 HR 许可证)
   ↓
智联以"Partner 身份"在我方 Partner 后台导入(/partner/jobs/import)
   ↓
我方 Admin 审核(/admin/job-sources/:id/review)→ 上架
   ↓
求职者扫码 → 跳字节官网 → 投递
   ↓
我方全程不收简历 / 不撮合
```

我方收益:Partner 数据接入费 + 终端服务费 + 学校采购费。

### 路径 B:字节自己签约成 Partner(内容提供方)

**前提条件**(法务复核必须过):

1. ✅ 字节与我方签 "内容合作协议",明确字节角色为 **"内容提供方"**,不是 "招聘端"
2. ✅ 字节导入的岗位必须有 `sourceUrl` 跳回字节官网,**所有投递在字节侧完成**
3. ✅ 字节导入的数据不能包含任何"招聘闭环字段"(候选人邮箱 / 面试时间槽 等)
4. ✅ 字节看到的回报数据只能是 **聚合统计**(浏览数 / 跳转数 / 城市分布),**不能拿到候选人个人信息**
5. ✅ 字节用我方 Partner 后台(5175)的导入功能,跟智联走同一套流程

如果字节同意以上,**字节 Organization.type 设为 `enterprise_source`**,正常用 Partner 后台,**不开新端**。

### 路径 C(禁止) — "企业自助招聘端"

```
字节 HR 注册账号
   ↓ 发岗位
   ↓ 收简历(我方系统存储)
   ↓ 看候选人列表 / 联系候选人
   ↓ 安排面试 / Offer
```

❌ **禁止实现**。任何写代码尝试落地此路径的 PR 必须被 reject。

---

## 7. UI 文案强制约束(合规可见性)

由 [packages/shared/src/types/complianceCopy.ts](../../packages/shared/src/types/complianceCopy.ts) 集中管理。

### 禁词(用户可见 UI 一律不出现)

```
"一键投递" / "立即投递" / "平台投递" /
"企业收简历" / "候选人管理" / "一键报名"
```

### 推荐词(必须用)

```
"查看岗位" / "去来源平台投递" / "扫码投递" /
"查看招聘会" / "去来源平台预约" / "扫码预约"
```

### 必须出现的合规横幅

| 位置 | 横幅文案 key |
|---|---|
| Kiosk 招聘列表顶部 | `COMPLIANCE_COPY.KIOSK_JOBS_TOP` |
| Kiosk 招聘会列表顶部 | `COMPLIANCE_COPY.KIOSK_FAIRS_TOP` |
| Kiosk 简历上传页 | `COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY` |
| Kiosk 校企合作详情 | `COMPLIANCE_COPY.KIOSK_CAMPUS_TOP` |
| Admin 岗位信息源 | `COMPLIANCE_COPY.ADMIN_JOB_SOURCES_TOP` |
| Admin 文件管理 | `COMPLIANCE_COPY.ADMIN_FILES_TOP` |
| Admin 日志审计 | `COMPLIANCE_COPY.ADMIN_AUDIT_TOP` |
| Partner 工作台顶部 | `COMPLIANCE_COPY.PARTNER_DASHBOARD_TOP` |

---

## 8. Demo / BD 时如何讲合规故事

按以下顺序翻给客户(顺序就是说服力):

1. **Kiosk 简历上传页** → 绿色"隐私保护"横幅 → "1 小时自动删除"
2. **Kiosk 招聘列表** → 橙色 → "投递请前往来源平台办理"
3. **CTA 按钮** → 全场"查看岗位 / 扫码投递",**无"一键投递"**
4. **Admin 岗位信息源** → 蓝色 → "未取得人力资源服务许可证,禁止设计一键投递"(法务最爱)
5. **Admin 文件管理** → 每文件剩余 23h 倒计时 + "已加密 / 已脱敏" → 红色"强制清理过期"
6. **Partner 工作台** → 橙色 → "本后台用于合作数据维护,不承接简历投递 / 候选人筛选 / 面试邀约"
7. **Admin 审计日志** → "所有操作不可删除不可篡改,保留 ≥ 180 天"

---

## 9. 常见质疑应答

**Q1:"你们怎么挣钱?"**
A:to-B 包年(学校/政府/Partner 服务费)+ 打印流水 + AI 服务包年。**坚决不收企业付费推广**(收了就触红线,需许可证)。

**Q2:"为什么字节不能自己进来发岗位?"**
A:可以,但字节得以"内容提供方"身份签 §6 路径 B 协议,而**不是**作为"招聘企业"。两者的法律地位完全不同。

**Q3:"你们存了简历 PDF,算什么?"**
A:简历仅供本次 AI 分析,**1 小时内自动从云端删除**(`FileObject.expiresAt`),admin 强制清理动作落审计。我方不留存 / 不转发任何第三方。

**Q4:"AI 给学生推荐了岗位算不算反向推送?"**
A:不算。AI 匹配建议**只对学生本人展示**,不向企业推送任何候选人信息。CLAUDE.md §2.6 禁的是反向 — 我们做的是正向(给学生看)。

**Q5:"为什么不做 Enterprise 端,做了不就能拿更大市场?"**
A:**违法**。CLAUDE.md §1 已声明无许可证,§2.8 红线"企业自主发布岗位并直接收简历"。如果将来拿到许可证可以重新讨论,在此之前一律拒绝。

---

## 10. 任何"我想加 X 功能"的决策树

```
开发者 / BD / 客户提"想加 X 功能"
   ↓
读 X 是否在 §4 白名单?
   ↓ 是                      ↓ 否
 直接做                  读 X 是否在 §5 黑名单?
                              ↓ 是                      ↓ 否
                         直接拒绝                  读 X 涉及哪个角色?
                         (引用本节)                    ↓ Partner / Admin → §4 增量
                                                       ↓ Enterprise → 走 §6 路径 B
                                                       ↓ 求职者新需求 → 走 Kiosk
```

---

## 11. 引用

- [CLAUDE.md §1+§2](../../CLAUDE.md)— 项目定位 + 禁止功能
- [docs/compliance/compliance-boundary.md](../compliance/compliance-boundary.md)— 合规边界细则
- [docs/product/feature-scope.md](feature-scope.md)— 功能范围
- [docs/product/external-data-source-design.md](external-data-source-design.md)— 数据源接入设计
- [docs/product/miaoda-reference-catalog.md](miaoda-reference-catalog.md)— 秒哒 49 张截图分析(红线复核已做)
- [packages/shared/src/types/complianceCopy.ts](../../packages/shared/src/types/complianceCopy.ts)— UI 文案 SSOT

---

## 起草

- Claude(Opus 4.7)— 2026-06-02
- 触发:用户提问"为什么没有企业端"(2026-06-02)
- 评审状态:待 BD + 法务复核(发起人:wanglei)
