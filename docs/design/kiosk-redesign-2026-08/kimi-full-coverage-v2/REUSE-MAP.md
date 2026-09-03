# REUSE-MAP · Kiosk 青序流光单底座映射表（v4.1）

> 当前结论：**青序流光是唯一继续建设和验收的静态设计底座。**
>
> `docs/design/kiosk-ai-os-v3-2026-08/` 自本版起降为只读历史参考：不删除、不覆盖、不继续返修，不作为最终页面交付，也不再为其调用 Kimi。
>
> S1/S2 已在该单底座内完成：五个服务 Hub 共用 `16-service-hubs.html`，首页与全部服务页只接这一个青序流光宿主；未修改 `apps/**`、`services/**`、`packages/**`、Terminal Agent、生产配置或硬件代码。

---

## 一、真值与最终设计关系

| 层 | 真值来源 | 当前作用 |
|---|---|---|
| 业务与运行时 | `apps/kiosk/src/routes/index.tsx`、`apps/kiosk/tests/visual/route-manifest.ts`、React 页面、API/Agent 契约 | 决定真实 route、入口、状态、登录、接口和能力边界 |
| 最终静态设计 | `docs/design/kiosk-redesign-2026-08/` | 唯一继续建设、截图验收和迁移到 React 的青序流光页面 |
| 历史参考 | `docs/design/kiosk-ai-os-v3-2026-08/` | 只读查阅已有信息结构、文案问题和历史设计，不是最终宿主 |
| 早期产品参考 | `docs/design/kiosk-proto-2026-07-fusion/` | 只读提取产品任务密度、信息层级和流程覆盖；不复用其旧视觉、不作为 route 或验收真值，也不新开并行施工底座 |
| 对比审查参考 | `docs/design/compare-2026-08-23/kiosk-verdict.html` | 可用于检查功能缺口、字阶和主内容密度；其中“以 V3 为基座”的历史结论已被青序流光单底座决策覆盖，不作为施工方向 |

静态 HTML 通过只证明原型表现，不证明 React 接线、API、支付、生产部署、Windows Agent、扫码器或奔图真机完成。

---

## 二、单底座硬规则

1. **每条真实 route 只能登记一个青序流光最终宿主。** 多 route 可以共享同一 HTML 的不同真实状态，但不得同时维护 Kimi 与 V3 两份成品。
2. **已有青序流光宿主优先 keep/repair/add-state。** 不因 V3 文件更完整就切回 V3 继续施工。
3. **只有 V3 参考、没有青序流光宿主时，登记为 `K 待建`。** 先复核真实 route、入口、出口、登录和依赖，再由 Codex 按青序流光规范迁移；不默认调用 Kimi 重画。
4. **V3 修改和证据只作历史候选资产。** 可以读取和提取已经核实的事实，不直接接入首页，不把其截图写成最终青序流光验收。
5. **禁止双份返修。** 不得要求一个模型同时修青序流光页面和同功能 V3 页面。
6. **禁止为了编号整齐重画。** 可通过一个青序流光宿主承载同一功能族的多个 route/state。
7. **两套都没有时才新增青序流光宿主。** controlled/frozen/redirect/phone-helper 继续按真实边界处理，不为凑页面数新建。

### 分类词

| 分类 | 含义 |
|---|---|
| `keep` | 青序流光宿主可直接保留，仅做一致性验收 |
| `repair` | 修正文案、链接、密度、触控或业务事实 |
| `add-state` | 在同一青序流光宿主内补真实状态，不新增同功能页面 |
| `K 待建` | 当前只有历史参考或 React 页面，尚无青序流光最终宿主 |
| `controlled` | 按真实 capability/feature flag 展示 loading/disabled/enabled |
| `frozen` | 当前关闭或无真实调用，只展示不可用或不施工 |
| `redirect/shared-host` | 复用同一青序流光宿主，不新增独立业务 HTML |

---

## 三、资产边界

### 3.1 唯一继续建设的目录

`docs/design/kiosk-redesign-2026-08/` 下现有业务 HTML、设计系统和已经验收的证据继续保留。重点宿主包括：

- `00-standby.html`：待机。
- `01-home.html`：唯一首页设计宿主。
- `02-services.html`：全部服务入口。
- `05-ai-cockpit.html`：AI 顾问。
- `10-print-hub.html`：打印扫描 Hub。
- `11-arrival-code.html`：到机码。
- `12-file-source.html` 至 `15-print-fulfill.html`、`32-cashier.html`：打印与支付流程。
- `18-scan-workbench.html` 至 `25-material-workshop.html`：扫描、文件、简历和材料流程。
- `26-browse-list.html` 至 `29-interview-training.html`：岗位、招聘会和面试。
- `30-my-profile.html`、`31-benefits.html`：我的与权益。
- `34-self-assessment.html`：自我探索。

`07-session-resume.html`、`33-pickup-code.html`、`35-notifications.html` 等重复或共享宿主候选，继续保留文件，但不得扩成第二套同功能产品。

### 3.2 V3/V6 历史目录

`docs/design/kiosk-ai-os-v3-2026-08/` 整体执行以下规则：

- 保留现有文件、Git 历史和证据，不删除。
- 不继续美化、返修、补状态或生成新的最终验收截图。
- 不把 V3/V6 文件直接作为首页或服务页的最终链接目标。
- React 源码中的历史注释可继续存在，但不代表 V3/V6 是未来视觉真值。
- 后续迁移只提取经当前代码验证的结构和事实，不照搬假在线、假完成、假硬件或旧 route。

### 3.3 Batch 2B-H 历史候选

以下五个 V3 Hub 和 `evidence/batch-2b-h/` 已产生，全部保留但冻结为历史候选：

- `32-resume-hub.html`
- `34-jobs-hub.html`
- `36-fairs-hub.html`
- `37-interview-hub.html`
- `38-policy-hub.html`

它们不再进入最终视觉验收，也不允许继续返修。其信息结构只能在独立核对真实 route 后迁入青序流光最终宿主。WorkBuddy/Kimi 的完成报告不等于 Codex 验收。

---

## 四、当前唯一宿主决策

| 真实 route/功能族 | 青序流光最终宿主 | V3/V6 处理 |
|---|---|---|
| `/` | `01-home.html` | `01-home-v6.html` 只读参考 |
| `/member/qr-login`、`/upload/phone` | `51-phone-relay.html?screen=qr-login|phone-upload` | `05-phone-relay` 只读参考；手机辅助共享宿主，不套 1080x1920 Kiosk 舞台 |
| `/profile` 与 `/me/*` | `30-my-profile.html` 及其页面内/后续同风格状态宿主 | `23-me`、`42-my-assets`、`43-my-records` 只读参考 |
| `/print-scan` | `10-print-hub.html` | `39-print-hub.html` 只读参考 |
| `/resume-service` | `16-service-hubs.html?hub=resume` | `32-resume-hub.html` 冻结参考 |
| `/jobs-service` | `16-service-hubs.html?hub=jobs` | `34-jobs-hub.html` 冻结参考 |
| `/fairs-service` | `16-service-hubs.html?hub=fairs` | `36-fairs-hub.html` 冻结参考 |
| `/interview-service` | `16-service-hubs.html?hub=interview` | `37-interview-hub.html` 冻结参考 |
| `/policy-service` | `16-service-hubs.html?hub=policy` | `38-policy-hub.html` 冻结参考 |

五个 Hub 共享一个维护宿主，通过 `hub` 参数形成五个可独立直达的真实设计状态。`01-home.html`、`02-services.html` 已只链接这些共享状态，不链接冻结的 V3 HTML。

### 4.1 五个 Hub 的真实出口冻结

以下清单直接来自当前 React Hub 组件，并已逐项匹配 `route-manifest.ts`。S1 构建青序流光 Hub 时以此为准，不使用 Batch 2B-H 自建映射：

- `/resume-service`：`/resume/source?intent=diagnose`、`/resume/source?intent=optimize`、`/resume/generate`、`/resume/templates`、`/resume/career-plan`、`/resume/materials`、`/print/upload?source=resume`、`/resume/job-fit`、`/me/resumes`、`/me/ai-records`、`/resume/self-assessment/intro`；`/contract-review` 仅在真实 feature flag 开启时显示。
- `/jobs-service`：`/jobs?category=fulltime|intern|parttime`、`/jobs`、`/companies`、`/resume/job-fit`、`/jobs/online-platforms`、`/offline-agencies`、`/me/activity`。
- `/fairs-service`：`/job-fairs`、`/campus`、`/job-fairs/checkin`、`/assistant`、`/resume-service`、`/print-scan`、`/me/activity`。
- `/interview-service`：`/interview/setup`、`/resume/self-assessment/intro`、`/resume/career-plan`、`/interview/tips`、`/resume/self-assessment/history`、`/assistant`、`/me/ai-records`、`/interview/reports`。
- `/policy-service`：`/renshi?tab=policy|social|register`、`/renshi`、`/assistant`、`/me/favorites?tab=policy`、`/me/activity`、`/me/ai-records`。

Batch 2B-H 的 `shoot.mjs` 把 `/me/assets`、`/me/ai-services`、`/advisor` 当成 route；这三项不在当前 106 route manifest 中，因此该批“零 unmapped”不能作为生产 route 证明。正确对应至少包括 `/me/resumes`、`/me/ai-records` 和 `/assistant`。

---

## 五、已验收成果

| 批次 | 结论 | 当前处理 |
|---|---|---|
| Batch 1 `15-print-fulfill` 9 态 | 静态 GO | 保留在青序流光底座 |
| Batch 1 `21-resume-triage` 4 态 | 静态 GO | 保留在青序流光底座 |
| Batch 1R `11-arrival-code` 8 态、17 交互 | 静态 GO | 保留冻结哈希；变化即重验 |
| Batch 2A `00/01/02` | 历史布局/交互证据 | 已由 S2 新入口证据覆盖 `01/02`；`00` 原证据保留 |
| Batch 2B-H V3 五 Hub | 未纳入单底座最终验收 | 冻结为历史候选，不继续施工 |
| S1 `16-service-hubs` 五 Hub × 4 态 | 静态 GO | 20/20 状态、15/15 首态交互通过；共享宿主继续保留 |
| S2 `01-home` 两态 + `02-services` | 静态 GO | 3/3 页面、10/10 Hub 点击通过；五入口已完成接线 |
| S5 `05-ai-cockpit` + `29-interview-training` | 静态候选，待独立复审 | 两个既有青序流光宿主承载 18 个 AI 顾问、实时语音与模拟面试状态；18/18 状态、7/7 交互通过，截图已在跳转前生成并人工复看。 |
| S11 `51-phone-relay` 手机登录/上传接力 | 静态 GO | 39/39 状态、25/25 交互、6/6 窄屏通过；仓库外复跑逐字节一致，独立冷审 GO |

---

## 六、后续施工顺序

### S0 · 单底座治理收敛

- 已把 `COVERAGE-MATRIX.md` 的 V3 标记全部降为只读参考。
- 已确认 106 条 route 零缺失、零重复、编号连续。
- 已按当前 React 组件锁定五个 Hub 的真实出口，并识别 Batch 2B-H 的三类错误 route 映射。
- 已停止 V3/V6 双底座施工，不再为历史页面消耗 Kimi 额度。

### S1 · 五个青序流光 Hub

- 已由 `16-service-hubs.html` 共享承载 `/resume-service`、`/jobs-service`、`/fairs-service`、`/interview-service`、`/policy-service`。
- 五个 Hub 均有 `default/first/ai-down/device-off` 四态，共 20 张 1080x1920 PNG。
- `evidence/s1-service-hubs/check-report.json`：20/20 状态、15/15 首态交互通过；控制台、HTTP、溢出、触控、语义、坏链接与非法 production route 均为 0。

### S2 · 首页与全部服务入口

- 已只修 `01-home.html`、`02-services.html` 并新增 `evidence/s2-home-services/`。
- 首页把招聘会与政策拆成独立入口；全部服务由 13 项变为 14 项，其他原有服务保持原目标。
- `evidence/s2-home-services/check-report.json`：3/3 页面、10/10 Hub 点击通过；五个主入口均精确进入 S1 共享宿主，V3/V6 零链接。

### S3 · 其余 106 路由

- 先复用现有青序流光宿主并补状态。
- 只有标记 `K 待建` 且无法共享宿主的 route 才新增页面。
- controlled、frozen、redirect、phone-helper 按真实边界验收。

### S12 · 从首页开始的 106 route 最终静态核销

- 从 `/` 对应的 `01-home.html` 开始，按用户可见入口进入 Hub、工作台、详情、异常态和返回路径，不以 106 个孤立 URL 能打开代替用户流程。
- 使用 `kiosk-verdict.html` 复核字阶、主内容占比和说明文字密度，但不采用其已过时的 V3 基座结论。
- 分别统计 97 条青序流光宿主 route、6 条 redirect、3 条 frozen/remove-candidate，并验证三类合计恰好覆盖 106 条。

---

## 七、验收门禁

1. 每条需施工 route 只有一个青序流光最终宿主。
2. 所有真实状态可以独立直达或通过明确的共享宿主参数进入。
3. 每态生成 1080x1920 PNG，无溢出、遮挡、异常大空白或底栏压内容。
4. 触控目标至少 48px，主要操作至少 56px，主操作字号至少 22px。
5. 可点击元素使用真实 `a/button`，具有可访问名称和稳定 `data-testid`。
6. 所有链接指向 `COVERAGE-MATRIX.md` 登记的真实 route；V3 HTML 不作为最终出口。
7. 逐态验证 `prefers-reduced-motion`。
8. 零假百分比、零假完成、零假设备在线、零固定成功结果。
9. 岗位和招聘会只使用合规来源平台投递/预约文案。
10. 每批完成后暂停等待验收，不自动进入下一批。

完整 route、登录、依赖和状态边界仍以 `COVERAGE-MATRIX.md` 为唯一 route 台账。
