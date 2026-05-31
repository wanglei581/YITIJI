# 2026-06-01 Claude 今日动手清单(W2 Day 3)

## 角色

P0 冲刺 **W2 Day 3**。让 Kiosk 招聘会列表立刻有数据可看 + 补 detail 端点供校企合作详情页用。

## 分支

`feat/p0-w2-claude-jobfair-be7`(延续 W2 整周分支)

## 将编辑/新建的文件

- `services/api/prisma/seed-fairs.ts`(新建,**独立** seed 脚本,不动 Mavis 独占的 seed.ts)
- `services/api/package.json`(加 `db:seed:fairs` 脚本)
- `services/api/src/jobs/jobs.controller.ts`(新增 `GET /job-fairs/:id/detail`)
- `services/api/src/jobs/jobs.service.ts`(新增 `getPublishedFairDetail`)

## 数据设计(3 场招聘会 + 19 家企业 + 11 个展区)

| Fair | Theme | 主办 | Companies | Zones |
|---|---|---|---|---|
| 2026 届春季校园双选会 | campus | uniOrg | 8(字节/阿里/腾讯/美团/拼多多/京东/小米/蚂蚁) | 4(北京/上海/深圳/杭州) |
| **AI 产业校企合作专场** | **campus_corp** | uniOrg | 6(智谱/DeepSeek/月之暗面/商汤/旷视/第四范式) | 4(LLM/CV/机器人/自动驾驶) |
| "百企千岗"民企专场 | general | hrOrg | 5(本地国企+民企) | 3(制造/金融/服务) |

全部 `reviewStatus=approved` + `publishStatus=published`,跑完 Kiosk 立刻看到 3 张卡。

## 阻塞 Mavis 的事项

- Day 3 全天:Mavis 不要碰 `services/api/src/jobs/`(我加 detail 端点)
- Mavis **不需要等我** 才能并行做 Day 5 的 4 件视觉活(K1 首页 / K3 横幅 / A4 横幅 / Admin 工作台 8 卡)

## Mavis 已被指令并行做的事(零冲突,见上一条 Claude 给 Mavis 的清单)

1. K1 Kiosk 首页卡片墙重做
2. K3 Kiosk 招聘列表合规横幅(用 ComplianceBanner)
3. A4 Admin 岗位信息源蓝色合规声明
4. Admin 工作台 8 卡 + 趋势(MetricGrid + TrendLineChart)

## 完成清单(下班前更新)

- [ ] seed-fairs.ts 跑完 dev.db 有 3 场招聘会 + 19 家企业 + 11 展区
- [ ] db:seed:fairs script 可独立运行
- [ ] GET /job-fairs/:id/detail 返回 FairDetailResponse(fair + companies + zones)
- [ ] typecheck + lint + boot + curl smoke
- [ ] commit
