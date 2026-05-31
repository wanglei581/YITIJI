# Handoff → Mavis

> Mavis,以下是从 Claude 这边异步交给你的任务清单。**不强制立刻做**,
> 你看自己 W2 节奏插入即可。每条都给了具体文件 + 代码示例,做完打勾即可。
> 完成后在本文件加 ✅ 并附 commit hash,我下次会清理 done 项。

---

## Task M-001:Kiosk 招聘会详情页支持 **校企合作主题变体 banner**

**优先级**:⭐⭐⭐⭐(demo 必看)
**预估工时**:2 小时
**依赖**:无(W2 Day 1-3 后端已就绪)

### 背景

W2 Day 1-3 Claude 已经在后端做了:
- JobFair 表多了一个 `theme` 字段,取值:`'general' | 'campus' | 'campus_corp' | 'industry'`
- `GET /api/v1/job-fairs/:id/detail` 返回 `{ fair, companies, zones }`
- 已经 seed 一场 **校企合作专场招聘会**(id=`fair-uni-corp-ai-2026`),theme=`campus_corp`

### 你要做的

在 Kiosk **招聘会详情页**判断 `fair.theme`,如果是 `'campus_corp'`,顶部多展示:

1. **一条 info 色合规横幅**(用现有 `ComplianceBanner` + `COMPLIANCE_COPY.KIOSK_CAMPUS_TOP`)
2. **现场服务四卡区**(参展企业查询 / 招聘会导览图 / AI 岗位匹配建议 / 自助打印)

### 涉及文件(全在 Mavis 独占目录)

- `apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx`(主改)
- `apps/kiosk/src/services/api/jobFairs.ts`(可能要加一个 `getJobFairDetail(id)` 方法去打 `/detail` 端点拿 theme)
- `apps/kiosk/src/services/api/jobFairsHttpAdapter.ts`(对应 http 实现)
- `apps/kiosk/src/services/api/jobFairsMockAdapter.ts`(对应 mock 返回 campus_corp 主题假数据)

### 代码示例

**1. service 层加新方法**(`apps/kiosk/src/services/api/jobFairs.ts`):
```ts
import type { FairDetailResponse } from '@ai-job-print/shared'

// existing AiServiceInterface 风格:
export interface JobFairsServiceInterface {
  // ...existing methods
  getJobFairDetail(id: string): Promise<FairDetailResponse | null>
}

export const getJobFairDetail = (id: string) => adapter.getJobFairDetail(id)
```

**2. http adapter**:
```ts
async getJobFairDetail(id: string): Promise<FairDetailResponse | null> {
  // 沿用现有 get<T> 封装
  return get<FairDetailResponse | null>(`/job-fairs/${id}/detail`)
}
```

**3. JobFairDetailPage.tsx 顶部 banner 逻辑**:
```tsx
import { ComplianceBanner } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'

// 在 fair 加载完成后:
{fair.theme === 'campus_corp' && (
  <>
    <ComplianceBanner tone="info" title="校企合作专场合规声明">
      {COMPLIANCE_COPY.KIOSK_CAMPUS_TOP}
    </ComplianceBanner>

    {/* 现场服务四卡(秒哒 kiosk/30 参考) */}
    <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
      <ServiceCard icon={...} title="参展企业查询" onClick={() => navigate('./companies')} />
      <ServiceCard icon={...} title="招聘会导览图" onClick={() => navigate('./map')} />
      <ServiceCard icon={...} title="AI 岗位匹配建议" onClick={() => navigate('/assistant?context=fair')} />
      <ServiceCard icon={...} title="自助打印服务" onClick={() => navigate('/print/source')} />
    </div>
  </>
)}
```

**4. ServiceCard 你可以自己起一个简单的本地组件**(在 JobFairDetailPage 同文件或 `apps/kiosk/src/components/`):
```tsx
function ServiceCard({ icon, title, onClick }: { icon: ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border-2 border-primary-200 bg-white p-4 hover:border-primary-400"
    >
      <span className="text-primary-600">{icon}</span>
      <span className="text-sm font-medium text-neutral-700">{title}</span>
    </button>
  )
}
```

### 合规自查(完成前必须过)

- [ ] **AI 岗位匹配建议**按钮跳到的页面,文案要是"AI 岗位匹配建议(仅供学生本人参考)",**不要写**"AI 智能求职"
  (秒哒原图 kiosk/30 写的"AI 智能求职"语义模糊,catalog Q3 有结论)
- [ ] **不要**新增任何"AI 帮我投递"/"扫码报名"/"提交资料"类按钮
- [ ] "呼叫工作人员"按钮如果加,必须显示"由 [机构名] 提供",**不要让用户以为是平台派人**

### 验证清单

完成后 boot 起 API + Kiosk:
```bash
cd services/api && pnpm db:seed && pnpm db:seed:fairs && pnpm dev   # 终端 1
cd ../.. && pnpm dev:kiosk   # 终端 2
```

浏览器访问:
- http://localhost:5173/job-fairs/fair-uni-campus-2026q2(theme=campus,普通校园招聘会)
  → 应该**不显示** banner 与四卡
- http://localhost:5173/job-fairs/fair-uni-corp-ai-2026(theme=campus_corp,校企合作)
  → 应该**显示** banner + 四卡

### 完成后

把以下内容追加到本 task 末尾:
```
✅ M-001 完成 @ commit <hash> (feat/p0-w?-mavis-campus-corp-banner 分支)
```

---

## Task M-002(可选,有时间再做):Kiosk fair 7 页接真 API

**优先级**:⭐⭐⭐
**预估工时**:1-2 小时
**依赖**:无

Kiosk 招聘会 7 个子页(JobFairsPage / JobFairDetailPage / FairCompaniesPage /
FairCompanyDetailPage / FairMapPage / FairMaterialsPage / FairStatsPage)目前都走 mock。
后端已就绪可切真。

涉及目录:
- `apps/kiosk/src/services/api/jobFairsHttpAdapter.ts`(确认或补齐方法)
- `apps/kiosk/src/services/api/jobFairsMockAdapter.ts`(保留作为 fallback)

后端可用接口:
- `GET /api/v1/job-fairs?status=upcoming` 列表(返回 FairListItemDto 数组,legacy 字段:name/organizer/startTime/endTime/status)
- `GET /api/v1/job-fairs/:id` 单条(同形状)
- `GET /api/v1/job-fairs/:id/detail` 详情(新形状:`{ fair, companies, zones }`,FairDetailResponse)

---

## 历史 done 项(Claude 定期清理)

(空)
