# G1 二次合规审查（2026-08-03）

> 触发:2026-08-03 Antigravity + Codex 双模型审查同时建议"在 f7d36064 合 main 前对 G1 三页执行合规快照审查"。
> 范围:PR #487→#489 三连合后,`apps/kiosk/src/pages/offline-agencies/` 三文件 + `services/api/src/offline-agencies/offline-agencies.service.ts` + `apps/kiosk/src/services/api/offlineAgencies.ts`。
> 标准:AGENTS.md / CLAUDE.md §18 + `docs/compliance/compliance-boundary.md` §4.6 业务指标诚实化(注:f7d36064 尚未合 main,§4.6 详细内容在 `fix/self-assessment-staged-cleanup-r3` tip)。

---

## 审查结论

**G1 三连合后仍残留 1 项 🔴 高风险 + 2 项 🟡 中低风险。**

| 严重度 | 位置 | 问题 |
|---|---|---|
| 🔴 高 | `services/api/src/offline-agencies/offline-agencies.service.ts:159` | 后端硬编码 `statusLabel: isOpen ? '营业中' : ...` |
| 🟡 中 | `apps/kiosk/src/pages/offline-agencies/OfflineAgencyDetailPage.tsx:60` | 前端 fallback `(isOpen ? '服务中' : '暂停服务')` 是运营状态声明 |
| 🟡 中 | `apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx:17-37` | `StatsBand` 组件虽被 PR #487 删除、PR #489 复活,显示 `今日开放/岗位总数` |
| 🟢 低 | `apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx:73-75` | `agency.jobCount` 直接渲染(列表不返此字段,渲染空白) |
| 🟢 低 | `apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx:133` | `syncHint` 兜底 `已同步`(中性兜底,非业务声明) |

---

## 🔴 高风险:`statusLabel` 后端硬编码"营业中"

**位置**:`services/api/src/offline-agencies/offline-agencies.service.ts:159`

```ts
statusLabel: isOpen ? '营业中' : '机构临时休息 · 以门店公告为准',
```

**问题**:这是 verify-fusion-w4.mjs L291-292 明确禁止的运营状态硬编码:

```js
// Hardcoded "营业中" copy would be a live operational claim without API backing.
assert.doesNotMatch(offlineAgencies, /'营业中'|"营业中"/)
```

verify 守护 `OfflineAgenciesPage.tsx`,**不守护后端 service**。所以 PR #489 改前端时,后端硬编码通过 verify 检查,但实质合规风险仍在。

**fix 建议**:
1. 后端 service `findOne` 不硬编码 `statusLabel`,改返回 `status: 'open' | 'rest'`(L158 已返),前端按 `status` 渲染 + fallback 文案(模板字符串,非硬编码"营业中")
2. 或:后端维护一份"按 city + 模板渲染"的服务运行状态来源,而不是单字"营业中"

**用户决策点**:选择哪种 fix 路径?

---

## 🟡 中风险:Detail page `服务中` fallback

**位置**:`apps/kiosk/src/pages/offline-agencies/OfflineAgencyDetailPage.tsx:60`

```tsx
{agency.statusLabel || (isOpen ? '服务中' : '暂停服务')}
```

**问题**:`statusLabel` 来自后端硬编码(见 🔴 高),前端 fallback 又再写一遍"服务中"。两层硬编码叠加。

**fix 建议**:删 fallback,直接渲染 `agency.statusLabel ?? '请到店咨询'`(中性,引导用户到店获取真实状态)。

---

## 🟡 中风险:`StatsBand` 复活

**位置**:`apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx:17-37` + L189

**问题**:PR #487 我删过该组件;PR #489 又加回来——为支持 API 驱动的 stats 字段。但当前 `OfflineAgencyListResult.stats` 是 `?:`,**后端 `findAll` 不返 `stats`**!所以组件 `<StatsBand stats={data.stats} />` 永远传 undefined → 内部 `if (!stats) return null` 兜底(不会渲染)。

但**代码仍然挂着**——只要后端哪天补回 `stats` 字段(如加聚合 endpoint),就会立刻显示 `今日开放/岗位总数/合作机构/覆盖区域`,其中前两项是典型的"运营状态声明"。

**fix 建议**:
- 短期:删 `StatsBand` 组件(L17-37) + `<StatsBand stats={data.stats} />`(L189),符合"无数据不展示"原则
- 或:从 type 删 `OfflineAgencyListStats`,拒绝下游误用
- 或(推荐):让后端真返 stats(基于 `_count` 真实聚合),并把 `今日开放` 改名为 `今日在招岗位` 这种从真实数据来的描述

---

## 🟢 低风险:`agency.jobCount` 在列表页渲染

**位置**:`OfflineAgenciesPage.tsx:73-75`

```tsx
<div className="oa-r-aside" aria-label={`${agency.jobCount} 个岗位`}>
  <div className="oa-jobs-n">{agency.jobCount}</div>
```

**问题**:`agency.jobCount` 在列表端点 `findAll` 不返回(`mapWireOfflineAgency` L221-235 只返 `status`,不返 `jobCount`/`statusLabel`)。当前实际渲染空白(`undefined → React 渲染空`)。

**风险**:如果将来后端 list 返 `jobCount`,前端直接展示"X 个岗位"——但**没有"实时刷新/降级"语义**,数据可能是过期。属于"数据存在但用户误以为是实时"的边界场景。

**fix 建议**:`{agency.jobCount ?? '—'}` + 加提示"岗位数请到店咨询",或干脆删这一栏(详情页已展示真实 jobs.length)。

---

## 🟢 低风险:`syncHint` fallback

**位置**:`OfflineAgenciesPage.tsx:133`

```ts
const syncHint = useMemo(() => data?.stats?.lastSyncLabel || '已同步', [data])
```

**评估**:`已同步` 是中性兜底,非"今日新增/活跃用户数"等运营声明。**合规 OK**,无需修改。

---

## 修复方案建议(汇总)

### P1(必须修,防 verify 反向闸门失效)

1. **删后端硬编码"营业中"**:把 `findOne` 的 `statusLabel` 改为由 `status` 推导(`isOpen ? 'open' : 'rest'`,与 L158 一致),文案让前端 fallback 处理(中性)。

2. **删 frontend `StatsBand` 组件**或**让后端真返 stats**——当前代码挂着是定时炸弹。

### P2(建议修,提升体验)

3. **`OfflineAgencyDetailPage.tsx:60`** fallback 改"请到店咨询"。

4. **`OfflineAgenciesPage.tsx:73-75`** `{agency.jobCount ?? '—'}` + 提示文案。

---

## 风险评估

- **🔴 高风险**:`statusLabel: '营业中'` 直接违反 AGENTS.md §18 "页面不得展示已完成、已保存、已投递、已打印、设备正常等结论"——后端做出来即全端影响。
- **🟡 中风险**:`StatsBand` 复活是 verify 反向闸门失效的具体例子——前端删了 verify 限制,后端实现却重蹈覆辙。
- **🟢 低风险**:目前都是"渲染空白"的非可见问题,但代码持续积累会形成"未来触发"风险。

---

## 关联

- Antigravity 审查:子代理 ID `177bd997-4bc3-486f-aa90-69be16e818d3` §5 风险预警
- Codex 审查:子代理 ID `9aa117b0-6946-4212-b4de-5d4db1d08807` §5 风险预警
- f7d36064 治理文档(尚未合 main):`fix/self-assessment-staged-cleanup-r3` tip
- verify 证据:`apps/kiosk/scripts/verify-fusion-w4.mjs:284-295`
- 上一次 G1 漂移:PR #482 → #487 → #489 三连修