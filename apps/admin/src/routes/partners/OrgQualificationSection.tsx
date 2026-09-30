import { formatDateTime } from '@ai-job-print/shared'

// ============================================================
// 机构详情抽屉 ·「资质核验」（只读 + 取证留痕）
//
// 3.15 从线下机构页的「资质」抽屉（offline-agencies/GovernanceDrawer.tsx，随整页停放）迁来：
// 那边要先经线下机构的 sourceOrgId 才能找到机构，这里直接按合作机构 id 读，入驻核验在机构详情里一处看全。
//
// 数据来自 /admin/recruitment-content/*（只读；该域没有任何 create / update / review / publish 端点）。
// 生产上目前**没有**写入 QualificationRecord 的入口，所以这里只能查看已有记录，并如实写明登记入口尚未开放。
//
// ── 为什么资质材料必须点一次请求一次 ──────────────────────────────────────
// CLAUDE.md §11：管理员访问文件必须记录日志。后端把它做成结构性的：
// QualificationAdminView 不返回 evidenceFileId，只给 evidenceAvailable: boolean；
// 唯一签发 URL 的 evidence-access 在事务里用 audit.writeRequired 写
// 'recruitment.qualification_evidence_access'，审计写失败就整体回滚、URL 发不出去。因此这里：
//   1. 不在展开时预取证据（会给没真看过的材料留审计记录）；
//   2. 不缓存返回的 url、不渲染成常驻链接——每次「查看资质材料」都重新请求；
//   3. 先开窗再请求：窗口被拦截就不发请求，不留一条「其实没看到」的审计。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { StatusBadge } from '@ai-job-print/ui'
import { AlertTriangleIcon, BadgeCheckIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react'
import {
  BLOCKER_LABELS,
  EVIDENCE_NOT_FOUND_CODE,
  ORGANIZATION_NOT_FOUND_CODE,
  QUALIFICATION_STATUS_LABELS,
  QUALIFICATION_TYPE_LABELS,
  offlineAgencyGovernanceService,
  type AgencyProfileAdminView,
  type PublicationReadiness,
  type QualificationAdminView,
} from '../../services/api/offlineAgencyGovernance'
import { API_BASE_URL, ApiHttpError } from '../../services/api/client'

// ─── 状态机：「没有」和「没拿到」必须是两个不同的分支 ─────────────────────────

type Section<T> =
  | { kind: 'loading' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ready'; data: T }

type EvidenceState =
  | { kind: 'loading' }
  | { kind: 'opened'; expiresAt: string }
  | { kind: 'blocked' }
  | { kind: 'error'; code: string; message: string }

function toError(e: unknown): { code: string; message: string } {
  if (e instanceof ApiHttpError) return { code: e.code, message: e.message }
  return { code: 'UNKNOWN', message: e instanceof Error ? e.message : '未知错误' }
}

// 本地存储后端签出来的是相对路径（/api/v1/files/:id/content?...），与文件管理页同一套处理。
function resolveSignedUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url
  return API_BASE_URL.replace(/\/api\/v1\/?$/, '') + url
}

/** 在点击的同步栈里先开空白窗口；开不出来就不发请求、不留审计。 */
function openDeferredWindow(): Window | null {
  const win = window.open('about:blank', '_blank')
  if (!win) return null
  win.opener = null
  const meta = win.document.createElement('meta')
  meta.name = 'referrer'
  meta.content = 'no-referrer'
  win.document.head.append(meta)
  win.document.title = '正在打开资质材料'
  return win
}

const dash = <span className="text-neutral-300">—</span>

function fmt(value: string | null): React.ReactNode {
  if (!value) return dash
  return formatDateTime(value, { fallback: value })
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-xs">
      <span className="w-24 shrink-0 text-neutral-400">{label}</span>
      <span className="min-w-0 flex-1 break-words text-neutral-700">{children}</span>
    </div>
  )
}

/** 加载失败：带错误码，和「查过了，没有」在视觉与文案上都不可混淆。 */
function LoadFailed({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
        <AlertTriangleIcon className="h-4 w-4 shrink-0" />
        没能读到资质数据，当前内容不能作为核验依据
      </p>
      <p className="mt-1 text-xs text-red-600">{message}（{code}）</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        <RefreshCwIcon className="h-3 w-3" />
        重试
      </button>
    </div>
  )
}

/** 确认「查过了，就是没有」。 */
function ConfirmedEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      <p className="mt-1 text-xs text-neutral-500">{detail}</p>
    </div>
  )
}

function Readiness({ value }: { value: PublicationReadiness }) {
  if (value.ready) return <StatusBadge dot status="success" label="可公开" />
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge dot status="warning" label="不可公开" />
      {value.blockers.map((blocker) => (
        <span key={blocker} className="rounded bg-warning-bg px-1.5 py-0.5 text-[11px] text-warning-fg">
          {BLOCKER_LABELS[blocker] ?? blocker}
        </span>
      ))}
    </div>
  )
}

function QualificationCard({ item, evidence, onViewEvidence }: {
  item: QualificationAdminView
  evidence: EvidenceState | undefined
  onViewEvidence: () => void
}) {
  const statusLabel = QUALIFICATION_STATUS_LABELS[item.status] ?? item.status
  return (
    <li className="rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-neutral-800">
          {QUALIFICATION_TYPE_LABELS[item.qualificationType] ?? item.qualificationType}
        </p>
        <div className="flex items-center gap-1.5">
          <StatusBadge dot status={item.status === 'valid' ? 'success' : 'warning'} label={statusLabel} />
          <StatusBadge
            dot
            status={item.effectiveValid ? 'success' : 'error'}
            label={item.effectiveValid ? '核验通过' : '不满足公开条件'}
          />
        </div>
      </div>
      <Row label="证照号">{item.licenseNumberMasked ?? dash}</Row>
      <Row label="发证机关">{item.issuerName ?? dash}</Row>
      <Row label="辖区">{item.jurisdiction ?? dash}</Row>
      <Row label="有效期">
        {item.validFrom || item.validUntil ? <>{fmt(item.validFrom)} ~ {fmt(item.validUntil)}</> : dash}
      </Row>
      <Row label="核验来源">{item.verificationSource ?? dash}</Row>
      <Row label="核验人 / 时间">
        {item.verifiedBy ?? dash} / {fmt(item.verifiedAt)}
      </Row>
      {item.rejectReason && <Row label="驳回原因">{item.rejectReason}</Row>}

      <div className="mt-2 border-t border-neutral-200/70 pt-2">
        {item.evidenceAvailable ? (
          <button
            type="button"
            onClick={onViewEvidence}
            disabled={evidence?.kind === 'loading'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 px-2.5 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            {evidence?.kind === 'loading' ? '正在打开…' : '查看资质材料'}
          </button>
        ) : (
          <p className="text-xs text-neutral-500">这条资质没有可查看的材料（未上传、已过期或已删除）。</p>
        )}
        {evidence?.kind === 'opened' && (
          <p className="mt-1.5 text-[11px] text-neutral-500">
            已在新标签页打开，链接 {fmt(evidence.expiresAt)} 失效。本次查看已记入审计日志。
          </p>
        )}
        {evidence?.kind === 'blocked' && (
          <p className="mt-1.5 text-[11px] text-warning-fg">
            浏览器拦截了新标签页，本次没有打开材料，也没有留下查看记录。请允许本站打开新窗口后再点一次「查看资质材料」。
          </p>
        )}
        {evidence?.kind === 'error' && (
          <p className="mt-1.5 text-[11px] text-red-600">{evidence.message}（{evidence.code}）</p>
        )}
      </div>
    </li>
  )
}

// ─── 小节 ─────────────────────────────────────────────────────────────────────

export function OrgQualificationSection({ organizationId }: { organizationId: string }) {
  const [profile, setProfile] = useState<Section<AgencyProfileAdminView | null>>({ kind: 'loading' })
  const [quals, setQuals] = useState<Section<QualificationAdminView[]>>({ kind: 'loading' })
  const [evidence, setEvidence] = useState<Record<string, EvidenceState>>({})

  const loadProfile = useCallback(async (orgId: string) => {
    setProfile({ kind: 'loading' })
    try {
      const page = await offlineAgencyGovernanceService.listProfilesByOrganization(orgId)
      // 后端 listAgencyProfiles 不校验机构是否存在：空列表只代表「没建档」。
      setProfile({ kind: 'ready', data: page.items[0] ?? null })
    } catch (e) {
      setProfile({ kind: 'error', ...toError(e) })
    }
  }, [])

  const loadQualifications = useCallback(async (orgId: string) => {
    setQuals({ kind: 'loading' })
    setEvidence({})
    try {
      const page = await offlineAgencyGovernanceService.listQualifications(orgId)
      setQuals({ kind: 'ready', data: page.items })
    } catch (e) {
      setQuals({ kind: 'error', ...toError(e) })
    }
  }, [])

  useEffect(() => {
    void loadProfile(organizationId)
    void loadQualifications(organizationId)
  }, [organizationId, loadProfile, loadQualifications])

  const viewEvidence = async (item: QualificationAdminView) => {
    // 先在同步栈里开窗；开不出来就直接返回，不发请求、不产生审计。
    const win = openDeferredWindow()
    if (!win) {
      setEvidence((prev) => ({ ...prev, [item.id]: { kind: 'blocked' } }))
      return
    }
    setEvidence((prev) => ({ ...prev, [item.id]: { kind: 'loading' } }))
    try {
      // 每次点击都重新请求：一次查看 = 一条 recruitment.qualification_evidence_access 审计。
      const access = await offlineAgencyGovernanceService.getQualificationEvidence(organizationId, item.id)
      win.location.replace(resolveSignedUrl(access.url))
      setEvidence((prev) => ({ ...prev, [item.id]: { kind: 'opened', expiresAt: access.expiresAt } }))
    } catch (e) {
      win.close()
      const err = toError(e)
      setEvidence((prev) => ({ ...prev, [item.id]: { kind: 'error', ...err } }))
      // 列表说「有材料」但取证端 404：用单条权威读取对账，免得反复重试一份已失效的材料。
      if (err.code === EVIDENCE_NOT_FOUND_CODE) {
        try {
          const fresh = await offlineAgencyGovernanceService.getQualification(organizationId, item.id)
          setQuals((prev) => prev.kind === 'ready'
            ? { kind: 'ready', data: prev.data.map((row) => (row.id === fresh.id ? fresh : row)) }
            : prev)
        } catch { /* 对账失败就保留错误提示，不覆盖已呈现的矛盾 */ }
      }
    }
  }

  const reload = () => {
    void loadProfile(organizationId)
    void loadQualifications(organizationId)
  }

  return (
    <section aria-label="资质核验" className="space-y-3 rounded-lg border border-neutral-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-neutral-800">
          <BadgeCheckIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
          资质核验
        </p>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3 w-3" />
          重新读取
        </button>
      </div>
      <p className="text-xs leading-relaxed text-neutral-500">
        入驻核验时对照这里的资质记录。本页只读：资质登记入口尚未开放，这里只能查看已有记录；查看资质材料会重新签发临时链接并写入审计日志。
      </p>

      <div>
        <p className="mb-1.5 text-xs font-medium text-neutral-500">治理档案</p>
        {profile.kind === 'loading' && <p className="py-2 text-sm text-neutral-400">正在读取…</p>}
        {profile.kind === 'error' && (
          <LoadFailed {...profile} onRetry={() => void loadProfile(organizationId)} />
        )}
        {profile.kind === 'ready' && profile.data === null && (
          <ConfirmedEmpty title="这家机构还没有治理档案" detail="已正常读取，档案数为 0。资质记录可以单独存在，见下方。" />
        )}
        {profile.kind === 'ready' && profile.data && (
          <div className="rounded-lg border border-neutral-100 px-3 py-2">
            <Row label="展示名称">{profile.data.displayName}</Row>
            <Row label="服务范围">
              {profile.data.serviceScope.length > 0 ? profile.data.serviceScope.join('、') : dash}
            </Row>
            <Row label="网点">{profile.data.branches.length} 个</Row>
            <Row label="公开条件"><Readiness value={profile.data.publicationReadiness} /></Row>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-neutral-500">资质记录</p>
        {quals.kind === 'loading' && <p className="py-2 text-sm text-neutral-400">正在读取…</p>}
        {quals.kind === 'error' && quals.code === ORGANIZATION_NOT_FOUND_CODE && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
              <AlertTriangleIcon className="h-4 w-4 shrink-0" />
              资质系统里找不到这家机构，无法核验资质
            </p>
            <p className="mt-1 text-xs text-red-600">
              这<strong className="font-semibold">不是</strong>「这家机构没有资质」。请刷新机构列表确认机构仍然存在后再核验。
            </p>
          </div>
        )}
        {quals.kind === 'error' && quals.code !== ORGANIZATION_NOT_FOUND_CODE && (
          <LoadFailed {...quals} onRetry={() => void loadQualifications(organizationId)} />
        )}
        {quals.kind === 'ready' && quals.data.length === 0 && (
          <ConfirmedEmpty
            title="还没有登记资质记录"
            detail="已正常读取，资质记录数为 0。资质登记入口尚未开放，登记前这里会一直为空。"
          />
        )}
        {quals.kind === 'ready' && quals.data.length > 0 && (
          <ul className="space-y-2">
            {quals.data.map((item) => (
              <QualificationCard
                key={item.id}
                item={item}
                evidence={evidence[item.id]}
                onViewEvidence={() => void viewEvidence(item)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
