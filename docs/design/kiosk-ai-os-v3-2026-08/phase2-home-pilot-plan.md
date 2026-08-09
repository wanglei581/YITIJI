# 第二阶段试点 · 首页落地施工清单(2026-08-09)

> 按 CLAUDE.md §8.1 立项。本清单经用户授权"今天全部做完"启动,**交付形态为 draft PR,合并须用户亲自验收**。

## 任务对应的真实闭环

线上首页(zyidai.cn)当前是旧视觉;V3 设计已封板(P01-v5 意图台)。本试点把首页升级为 V3 视觉与入口结构,**恢复"八大功能每个小功能可直点"的入口感**(用户明确诉求),并顺带修复盘点发现的百宝箱/智慧校园无门控问题。

## 允许 / 禁止修改

- ✅ 允许:`apps/kiosk/src/pages/home/**`(HomePage 与其组件、样式)、新增 home 专属 css/assets、`apps/kiosk/src/pages/home/serviceGroups.ts`(重建为新入口数据源)
- ❌ 禁止:路由结构、任何 services/api、后端、schema、支付/打印/硬件链路、其他页面、共享组件的破坏性改动(可新增不可改语义)、合规文案白名单外的投递类表述
- 新增入口只允许指向**已存在的真实路由**(见 closed-loop-map §七 映射表)

## 改造内容(按块)

1. **视觉基调**:参照 P01-v5「鲜彩玻璃 warm」——象牙纸底、深青玉主色、六服务身份色卡、玻璃指令胶囊。禁紫蓝渐变/星星/魔法棒(README §6.4)。CSS 走 home 作用域,不污染全站。
2. **AI 接待台**(已有 HomeReception):保留行为(输入→/assistant、三 chips、麦克风),按 V5 胶囊形态重排;文案沿用现有(已合规)。
3. **八大功能卡 + 小功能直点入口**(核心):每卡列真实子入口(与各服务中心页一致):
   - 打印扫描 → /print-scan;子:上传打印 /print/upload、扫描 /scan/start、图片转PDF /print-scan/convert、签章 /print-scan/sign
   - AI简历服务 → /resume-service;子:简历诊断 /resume/source?intent=diagnose、简历生成 /resume/generate、岗位匹配 /resume/job-fit、素材模板 /resume/templates、职业规划 /resume/career-plan
   - 岗位信息 → /jobs-service;子:岗位列表 /jobs、找企业 /companies、线下机构 /offline-agencies
   - 招聘会 → /fairs-service;子:本周场次 /job-fairs、校园招聘 /campus、现场签到 /job-fairs/checkin
   - AI面试训练 → /interview-service;子:开始练习 /interview/setup、历史报告 /interview/reports
   - 政策服务 → /policy-service;子:政策库 /renshi
   - 百宝箱 → /toolbox;智慧校园 → /smart-campus —— **按 useToolboxConfig / useSmartCampusConfig 的 enabled 门控显示**,未开启不渲染(修盘点缺口)
   - 触控:子入口 ≥48px,主卡主按钮 ≥56px
4. **本机状态卡**:保留现有真实检测逻辑与"仅展示实时检测"的诚实口径,按 V5 仪表形态重排。
5. **不做**(后续批次):办理单/意图排序引擎(需后端 intent API)、待机屏改版、其他页面。

## 验证门禁(全过才交)

- `pnpm --filter kiosk typecheck`、lint(改动文件 0 error)、`pnpm --filter kiosk build`
- 既有 verify 脚本如 `verify:fusion-home` / `verify:home-prototype-v1` 若断言旧结构需同步更新断言(不许删门禁)
- 浏览器 1080×1920 实测截图:默认态 + 未登录态;子入口逐个点击可达
- 合规自查:无「一键投递/立即投递/平台投递」;百宝箱/智慧校园门控生效

## 交付

独立分支(自干净 origin/main)→ draft PR,标题注明"试点·待用户验收";同步 docs/progress/current-progress.md。
