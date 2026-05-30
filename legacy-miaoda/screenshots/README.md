# 秒哒参考截图索引

> 本目录是秒哒旧项目的设计参考截图。**CLAUDE.md §4 规约**:
> 秒哒只作参考,**不作正式工程继续开发**。可参考"页面功能结构 / 首页业务入口 /
> 模块功能清单",**不要**照搬"视觉风格(渐变/毛玻璃)/ 路由结构 / 重复样式"。

## 索引规则

文件按 `<前缀>-<功能名>.png` 命名。前缀只为排序与引用,不携带其他语义。
专家评审时可用 `kiosk/15` 这种短引用代替全文件名。

---

## 一、Kiosk(一体机前台)— 23 张

### 1. 主框架(00-09)

| # | 文件 | 对应项目页面 | 备注 |
|---|---|---|---|
| 01 | 首页上半部分 | `apps/kiosk/src/pages/home/HomePage.tsx` | 上半屏 |
| 02 | 首页中下半部分 | 同上 | 下半屏 |
| 03 | 登录页面 | **(项目暂无,Kiosk 无登录)** | 合规判定:见 catalog |
| 04 | 我的上半部分 | `apps/kiosk/src/pages/profile/ProfilePage.tsx` | 上半屏 |
| 05 | 我的中下半部分 | 同上 | 下半屏 |

### 2. AI 简历 & 面试(10-19)

| # | 文件 | 对应项目页面 |
|---|---|---|
| 10 | ai助手 | `apps/kiosk/src/pages/assistant/AssistantPage.tsx` |
| 11 | ai简历助手 | `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`(可能要重做) |
| 12 | ai简历助手功能 | 同上 |
| 13 | 简历诊断 | `apps/kiosk/src/pages/resume/ResumeReportPage.tsx` |
| 14 | 简历优化诊断 | 同上 + 优化建议 |
| 15 | ai简历优化对比 | `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx` |
| 16 | ai模拟面试 | **(项目暂无,新建)** |
| 17 | 面试技巧与辅助 | **(项目暂无,新建)** |

### 3. 招聘 / 招聘会(20-29)

| # | 文件 | 对应项目页面 |
|---|---|---|
| 20 | 招聘页面 | `apps/kiosk/src/pages/jobs/JobsPage.tsx` |
| 21 | 招聘会主页 | `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx` |
| 22 | 招聘会详情页 | `apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx` |
| 23 | 招聘会参展导览 | `apps/kiosk/src/pages/job-fairs/FairMapPage.tsx` |
| 24 | 招聘会现场数据统计 | `apps/kiosk/src/pages/job-fairs/FairStatsPage.tsx` |

### 4. 校企合作(30-39)— ⚠️ 合规重点检查

| # | 文件 | 对应项目页面 |
|---|---|---|
| 30 | 校企合作主页 | **(项目暂无,新建)** |
| 31 | 校企合作岗位信息 | **(项目暂无,新建)** |
| 32 | 校企合作页面功能 | **(项目暂无,新建)** |

### 5. 求职材料(40-49)

| # | 文件 | 对应项目页面 |
|---|---|---|
| 40 | 求职材料 | **(项目暂无,新建)** |
| 41 | 模版素材库 | **(项目暂无,新建)** |

---

## 二、Partner(合作机构后台)— 12 张

| # | 文件 | 对应项目页面 |
|---|---|---|
| 01 | 首页方案 A | `apps/partner/src/routes/dashboard/index.tsx` |
| 02 | 首页方案 B | 同上(备选) |
| 03 | 首页方案 C | 同上(备选) |
| 04 | 首页方案 D | 同上(备选) |
| 10 | 机构资料 | `apps/partner/src/routes/profile/index.tsx` |
| 11 | 外部岗位信息管理 | `apps/partner/src/routes/jobs/index.tsx` |
| 12 | 招聘会信息管理 | `apps/partner/src/routes/fairs/index.tsx` |
| 13 | 政策公告管理 | `apps/partner/src/routes/policy/index.tsx` |
| 14 | 数据来源管理 | `apps/partner/src/routes/sources/index.tsx` |
| 15 | 数据统计 | `apps/partner/src/routes/stats/index.tsx` |
| 16 | 日志 | `apps/partner/src/routes/sync-logs/index.tsx` |
| 17 | 账号权限 | `apps/partner/src/routes/account/index.tsx` |

---

## 三、Admin(管理员后台)— 14 张

| # | 文件 | 对应项目页面 |
|---|---|---|
| 01 | 首页 | `apps/admin/src/routes/dashboard/index.tsx` |
| 02 | 终端管理 | `apps/admin/src/routes/devices/index.tsx`(Tab) |
| 03 | 打印机管理 | 同上(Tab) |
| 04 | 外设管理 | 同上(Tab) |
| 05 | 订单管理 | `apps/admin/src/routes/orders/index.tsx` |
| 06 | 文件管理 | `apps/admin/src/routes/files/index.tsx` |
| 07 | ai 服务管理 | `apps/admin/src/routes/ai-services/index.tsx` |
| 08 | 岗位信息源 | `apps/admin/src/routes/job-sources/index.tsx` |
| 09 | 招聘会信息源 | `apps/admin/src/routes/fair-sources/index.tsx` |
| 10 | 合作机构 | `apps/admin/src/routes/partners/index.tsx` |
| 11 | 用户 | `apps/admin/src/routes/users/index.tsx` |
| 12 | 告警中心 | `apps/admin/src/routes/alerts/index.tsx` |
| 13 | 权限 | `apps/admin/src/routes/permissions/index.tsx` |
| 14 | 日志审计 | `apps/admin/src/routes/audit/index.tsx` |

---

## 合规判定提示(读图时必须检查)

任何包含以下意图的截图,在 catalog 里必须标 ⚠️ 或 ❌:

1. **平台代收简历** — 求职者在我方填表 → 转发企业(❌ §2.2)
2. **企业筛选/查看简历** — 企业可以"看人"(❌ §2.3)
3. **算法推送求职者给企业** — 反向推送(❌ §2.6)
4. **一键投递 / 平台投递** — 不论实际数据流(❌ §2 文案禁用)
5. **企业自主发布岗位 + 直接收简历**(❌ §2.8)
6. **校企合作"代发简历"** — 学校把学生简历给企业(❌ §2.2 变体)

**允许做的**(用户已确认 1A+2+3 方案):
- 拉取第三方招聘平台 API 岗位列表/详情 + 跳走对方 H5/APP
- 展示岗位/招聘会信息 + 扫码跳对方页面投递
- AI 简历优化 / 诊断 / 模拟面试(数据不出我方,不给企业)
- 简历打印 / 扫描 / 临时存储(自动清理)

---

## catalog 文档位置

详细的逐张分析(意图功能 / 合规判定 / 现项目对应 / 实施方案 / 工作量)
将在 `docs/product/miaoda-reference-catalog.md`,由专家产出。
