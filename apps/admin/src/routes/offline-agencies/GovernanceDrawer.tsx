// ============================================================
// 线下机构「治理档案 / 资质」只读抽屉
//
// 数据来自 /admin/recruitment-content/*（只读；该域没有任何 create/update/
// review/publish 端点，verify-recruitment-content-http.ts 有断言）。所以本抽屉
// **只负责让管理员看见与取证**，审核动作仍走同页已有的 ReviewDialog。
//
// ── 为什么资质材料必须点一次请求一次 ──────────────────────────────────────
// CLAUDE.md §11：管理员访问文件必须记录日志。
// 后端把这条约束做成了结构性的：QualificationAdminView **不返回 evidenceFileId**，
// 只给 evidenceAvailable: boolean，前端根本拿不到 fileId 去拼别的文件端点；
// 唯一签发 URL 的 evidence-access 在 $transaction 里用 audit.writeRequired 写
// 'recruitment.qualification_evidence_access'，审计写失败就整体回滚、URL 发不出去。
// 相比之下通用的 GET /files/:id/url 用 audit.write（吞异常、fail-open），
// 而且只记 targetType='file'、不带 qualificationId。
// 因此这里：
//   1. 不在抽屉打开时预取证据（会给没真看过的材料留审计记录）；
//   2. 不缓存返回的 url 复用，也不把它渲染成常驻链接——每次「查看材料」都重新请求，
//      让「一次查看」和「一条审计」一一对应；
//   3. 弹窗被拦截时提示重试，重试同样会重新请求、重新留痕。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Drawer, StatusBadge } from '@ai-job-print/ui'
import { AlertTriangleIcon, ExternalLinkIcon, FileTextIcon, RefreshCwIcon } from 'lucide-react'
import { GhostButton } from '../../components/form'
import type { AdminOfflineAgencyListItem } from '../../services/api/offlineAgenciesAdmin'
import {
  BLOCKER_LABELS,
  EVIDENCE_NOT_FOUND_CODE,
  ORGANIZATION_NOT_FOUND_CODE,
  QUALIFICATION_STATUS_LABELS,
  QUALIFICATION_TYPE_LABELS,
  offlineAgencyGovernanceService,
  type AgencyProfileAdminView,
  type BranchAdminView,
  type PublicationReadiness,
  type QualificationAdminView,
} from '../../services/api/offlineAgencyGovernance'
import { API_BASE_URL, ApiHttpError } from '../../services/api/client'

// ─── 状态机 ───────────────────────────────────────────────────────────────────
// 「没有」和「没拿到」必须是两个不同的分支，绝不能都落到空数组上。

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

// 本地存储后端签出来的是相对路径（/api/v1/files/:id/content?...），
// 与 routes/files/index.tsx 同一套处理，避免 API 与页面不同源时打不开。
function resolveSignedUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url
  return API_BASE_URL.replace(/\/api\/v1\/?$/, '') + url
}

/**
 * 与 routes/files/index.tsx 的 openDeferredPreviewWindow 同构：在点击的同步栈里
 * 先开空白窗口，签名成功再 location.replace。
 * 除了绕过弹窗拦截，这里还有一层合规意义：窗口开不出来就**不发请求**，
 * 不会为一次根本看不到的查看留下 evidence_access 审计记录。
 */
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
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

// ─── 小组件 ───────────────────────────────────────────────────────────────────

function SectionCard({ title, extra, children }: {
  title: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {extra}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

/** 加载失败的统一表达：带错误码，和「暂无数据」在视觉与文案上都不可混淆。 */
function LoadFailed({ code, message, onRetry }: { code: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
        <AlertTriangleIcon className="h-4 w-4 shrink-0" />
        未能获取数据，当前内容不可作为审核依据
      </p>
      <p className="mt-1 text-xs text-red-600">{message}（{code}）</p>
      <button
        onClick={onRetry}
        className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        <RefreshCwIcon className="h-3 w-3" />
        重试
      </button>
    </div>
  )
}

/** 确认「查过了，就是没有」。与 LoadFailed 完全不同的底色和措辞。 */
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1 text-xs">
      <span className="w-24 shrink-0 text-neutral-400">{label}</span>
      <span className="min-w-0 flex-1 break-words text-neutral-700">{children}</span>
    </div>
  )
}

function BranchCard({ branch }: { branch: BranchAdminView }) {
  return (
    <li className="rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-neutral-800">{branch.branchName}</p>
        <Readiness value={branch.localPublicationReadiness} />
      </div>
      <Row label="地址">{branch.address || dash}</Row>
      <Row label="服务时间">
        {branch.serviceHours || dash}
        {branch.serviceHoursSource && (
          <span className="ml-1 text-neutral-400">（来源：{branch.serviceHoursSource}）</span>
        )}
      </Row>
      <Row label="对外电话">{branch.publicPhone || dash}</Row>
      <Row label="最后核验">{fmt(branch.lastVerifiedAt)}</Row>
    </li>
  )
}

// ─── 资质条目 ─────────────────────────────────────────────────────────────────

function QualificationCard({ item, onViewEvidence, evidence }: {
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
            onClick={onViewEvidence}
            disabled={evidence?.kind === 'loading'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 px-2.5 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            {evidence?.kind === 'loading' ? '签发中…' : '查看资质材料'}
          </button>
        ) : (
          <p className="text-xs text-neutral-500">
            该资质未关联可用的证据文件（未上传、已过期或已删除），无材料可查看。
          </p>
        )}

        {evidence?.kind === 'opened' && (
          <p className="mt-1.5 text-[11px] text-neutral-500">
            已在新标签页打开，链接 {fmt(evidence.expiresAt)} 失效。本次查看已记入审计日志
            （recruitment.qualification_evidence_access）。
          </p>
        )}
        {evidence?.kind === 'blocked' && (
          <p className="mt-1.5 text-[11px] text-warning-fg">
            浏览器拦截了新标签页，本次未发起取证请求。请允许本站打开新窗口后再点一次「查看资质材料」。
          </p>
        )}
        {evidence?.kind === 'error' && (
          <p className="mt-1.5 text-[11px] text-red-600">
            {evidence.message}（{evidence.code}）
          </p>
        )}
      </div>
    </li>
  )
}

// ─── 抽屉 ─────────────────────────────────────────────────────────────────────

export interface GovernanceDrawerProps {
  open: boolean
  agency: AdminOfflineAgencyListItem | null
  onClose: () => void
}

export function GovernanceDrawer({ open, agency, onClose }: GovernanceDrawerProps) {
  const organizationId = agency?.sourceOrgId ?? null
  const [profile, setProfile] = useState<Section<AgencyProfileAdminView | null>>({ kind: 'loading' })
  const [quals, setQuals] = useState<Section<QualificationAdminView[]>>({ kind: 'loading' })
  const [evidence, setEvidence] = useState<Record<string, EvidenceState>>({})

  const loadProfile = useCallback(async (orgId: string) => {
    setProfile({ kind: 'loading' })
    try {
      const page = await offlineAgencyGovernanceService.listProfilesByOrganization(orgId)
      // 真后端 listAgencyProfiles 不校验机构是否存在：空列表只代表「没建档」。
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
    if (!open || !organizationId) return
    void loadProfile(organizationId)
    void loadQualifications(organizationId)
  }, [open, organizationId, loadProfile, loadQualifications])

  const viewEvidence = async (item: QualificationAdminView) => {
    if (!organizationId) return
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
      // 列表快照说「有材料」但取证端 404：屏幕上出现自相矛盾，用单条权威读取对账，
      // 免得管理员以为是网络抖动而反复重试一份其实已经失效的材料。
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
    if (!organizationId) return
    void loadProfile(organizationId)
    void loadQualifications(organizationId)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`治理档案与资质 — ${agency?.name ?? ''}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-neutral-400">只读视图；审核与发布仍在列表页操作</span>
          <GhostButton onClick={onClose}>关闭</GhostButton>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 来源机构：sourceOrgId 为空是独立的第三种状态，不发请求也不算「无资质」 */}
        <SectionCard
          title="来源机构"
          extra={organizationId && (
            <button
              onClick={reload}
              className="inline-flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              <RefreshCwIcon className="h-3 w-3" />
              重新加载
            </button>
          )}
        >
          {organizationId ? (
            <Row label="Organization ID">
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">{organizationId}</code>
            </Row>
          ) : (
            <ConfirmedEmpty
              title="本机构没有来源机构，因此不存在可核验的资质档案"
              detail="该记录的 sourceOrgId 为空，属于后台自录的线下机构目录，不走外部供稿链路。这不代表资质缺失，也不是加载失败。"
            />
          )}
        </SectionCard>

        {organizationId && (
          <>
            <SectionCard title="治理档案（OfflineAgencyProfile）">
              {profile.kind === 'loading' && <p className="py-2 text-sm text-neutral-400">加载中…</p>}
              {profile.kind === 'error' && (
                <LoadFailed {...profile} onRetry={() => void loadProfile(organizationId)} />
              )}
              {profile.kind === 'ready' && profile.data === null && (
                <ConfirmedEmpty
                  title="该来源机构尚未建立线下机构治理档案"
                  detail="接口已正常返回，档案数为 0。资质仍可能单独存在，见下方资质列表。"
                />
              )}
              {profile.kind === 'ready' && profile.data && (
                <div className="space-y-3">
                  <Row label="展示名称">{profile.data.displayName}</Row>
                  <Row label="所属机构">
                    {profile.data.organizationName}（{profile.data.organizationType}）
                  </Row>
                  <Row label="内容信任">
                    {profile.data.organizationContentTrustStatus ?? <span className="text-warning-fg">未标记</span>}
                  </Row>
                  <Row label="服务范围">
                    {profile.data.serviceScope.length > 0 ? profile.data.serviceScope.join('、') : dash}
                  </Row>
                  <Row label="审核 / 发布">
                    {profile.data.reviewStatus} / {profile.data.publishStatus}
                  </Row>
                  <Row label="公开门禁"><Readiness value={profile.data.publicationReadiness} /></Row>

                  <div>
                    <p className="mb-1.5 mt-3 text-xs font-medium text-neutral-500">
                      网点（{profile.data.branches.length}）
                    </p>
                    {profile.data.branches.length === 0 ? (
                      <ConfirmedEmpty
                        title="该档案下没有任何网点"
                        detail="接口已正常返回，网点数为 0。没有可公开网点时机构整体无法公开。"
                      />
                    ) : (
                      <ul className="space-y-2">
                        {profile.data.branches.map((branch) => (
                          <BranchCard key={branch.id} branch={branch} />
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </SectionCard>

            <SectionCard title="机构资质（QualificationRecord）">
              {quals.kind === 'loading' && <p className="py-2 text-sm text-neutral-400">加载中…</p>}
              {quals.kind === 'error' && quals.code === ORGANIZATION_NOT_FOUND_CODE && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                    <AlertTriangleIcon className="h-4 w-4 shrink-0" />
                    来源机构在机构表中不存在，无法核验资质
                  </p>
                  <p className="mt-1 text-xs text-red-600">
                    本机构记录的 sourceOrgId 指向一个已被删除或从未存在的 Organization
                    （sourceOrgId 无外键约束）。这<strong className="font-semibold">不是</strong>
                    「该机构没有资质」，请先修正来源机构再审核。
                  </p>
                </div>
              )}
              {quals.kind === 'error' && quals.code !== ORGANIZATION_NOT_FOUND_CODE && (
                <LoadFailed {...quals} onRetry={() => void loadQualifications(organizationId)} />
              )}
              {quals.kind === 'ready' && quals.data.length === 0 && (
                <ConfirmedEmpty
                  title="该机构未上传任何资质"
                  detail="接口已正常返回，资质记录数为 0。可据此判定资质缺失。"
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
            </SectionCard>

            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-neutral-400">
              <FileTextIcon className="mt-0.5 h-3 w-3 shrink-0" />
              资质材料每次查看都会重新签发临时链接并写入审计日志；证照号由后端脱敏，前端不持有完整号码与文件 ID。
            </p>
          </>
        )}
      </div>
    </Drawer>
  )
}
