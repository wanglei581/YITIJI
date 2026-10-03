import { useEffect, useState } from 'react'
import { replaceIfChanged, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { Drawer, LoadingState } from '@ai-job-print/ui'
import { FRONTEND_HINT, Page, withFrontendHint } from '../Page'
import { FileTextIcon, PlusIcon } from 'lucide-react'
import EligibilityRulesDrawer from './EligibilityRulesDrawer'
import { PolicyReleaseDialog } from './PolicyReleaseDialog'
import { PolicyTable } from './PolicyTable'
import { AUDIENCE_LABELS, CATEGORY_LABELS } from './policyLabels'
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog'
import {
  partnerPoliciesService,
  type PartnerPolicyRecord,
  type PolicyAudience,
  type PolicyCategory,
  type PolicyKind,
  type SavePolicyInput,
} from '../../services/api/policies'
import type { ReviewStatus } from '../../services/api'
import { useCapability } from '../../services/capabilities'
import { isAbsoluteHttpUrl } from '../../lib/httpUrl'

// ─── Display maps ─────────────────────────────────────────────────────────────

const PARTNER_POLICIES_REFRESH_KEY = 'partner:policies'
const PAGE_SIZE = 20
const REVIEW_FILTERS = ['全部', '待审核', '已通过', '已拒绝'] as const
const REVIEW_FILTER_MAP: Record<string, ReviewStatus | null> = {
  全部: null, 待审核: 'pending', 已通过: 'approved', 已拒绝: 'rejected',
}
const FILTER_SELECTED_CLASS = 'border-primary-600 bg-primary-600 text-white'
const FILTER_IDLE_CLASS = 'border-neutral-200 bg-surface text-neutral-700 hover:border-primary-600/40'

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
        {required && <span className="ml-0.5 text-error-fg">*</span>}
      </span>
      {children}
    </label>
  )
}

interface PolicyFormState {
  kind: PolicyKind
  title: string
  summary: string
  content: string
  audience: PolicyAudience
  category: PolicyCategory
  externalUrl: string
  publishedDate: string // YYYY-MM-DD
}

const EMPTY_FORM: PolicyFormState = {
  kind: 'notice', title: '', summary: '', content: '', audience: 'general', category: 'notice', externalUrl: '', publishedDate: '',
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') return (e as Error).message
  return '操作失败,请重试'
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * 政策内容只有公共就业服务机构与高校就业中心可**创建**
 * （policies.service.ts 的 assertPolicyCapableOrgType → 400
 * ORG_TYPE_NOT_ALLOWED_FOR_POLICY，判定读 partner-capabilities.ts 的
 * canManagePolicies）。这是合规约束：政策属官方性质，商业机构不得冒名发布。
 *
 * 更新/下架/删除不校验类型，存量内容必须还能被机构自己下架，
 * 所以此页不隐藏、只禁用「新增」。
 *
 * 3.13 起政策由本机构自己「审核通过」并「发布」（发布前须确认发布责任，服务端审计记下
 * 确认人、时间与内容版本）；平台管理员只保留紧急下架。修改已发布的政策会生成新版本、
 * 自动撤下并回到待审核，页面上要把这一点说清楚。审核 / 发布同样不校验机构类型。
 */
const CANNOT_CREATE_HINT = '政策内容属官方性质，仅公共就业服务机构与高校就业中心可发布。本机构不能新增，只能处理已有内容（查看、审核发布、下架）。'

export default function PolicyPage() {
  const canCreate = useCapability('canManagePolicies')
  const [editing, setEditing] = useState<PartnerPolicyRecord | 'new' | null>(null)
  const [form, setForm] = useState<PolicyFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmUnpublish, setConfirmUnpublish] = useState<PartnerPolicyRecord | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PartnerPolicyRecord | null>(null)
  /** 发布责任确认弹窗（3.13：政策由本机构自己发布） */
  const [releasing, setReleasing] = useState<PartnerPolicyRecord | null>(null)
  /** P21 申领条件录入面(只对政策扶持条目开放;公告没有申领条件) */
  const [rulesFor, setRulesFor] = useState<PartnerPolicyRecord | null>(null)
  const [page, setPage] = useState(1)
  const [reviewFilter, setReviewFilter] = useState('全部')

  const reviewStatus = REVIEW_FILTER_MAP[reviewFilter]
  const policiesRefreshKey = `${PARTNER_POLICIES_REFRESH_KEY}:${page}:${reviewStatus ?? 'all'}`
  const { data, status, refresh } = useRefreshable(
    policiesRefreshKey,
    () => partnerPoliciesService.getPolicies({
      page,
      pageSize: PAGE_SIZE,
      ...(reviewStatus ? { reviewStatus } : {}),
    }),
    {
      intervalMs: 60_000,
      merge: replaceIfChanged,
      failPolicy: 'keep-last',
    },
  )

  useInteractionLock(
    editing !== null || saving || busyId !== null || confirmDelete !== null || confirmUnpublish !== null || rulesFor !== null || releasing !== null,
    [policiesRefreshKey],
    'hard',
  )

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const rows = data?.data ?? []
  const total = data?.pagination.total ?? 0
  const loading = status === 'idle' || (status === 'loading' && rows.length === 0)
  const error = status === 'error' && rows.length === 0

  const openNew = () => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditing('new')
  }

  const openEdit = (r: PartnerPolicyRecord) => {
    setForm({
      kind: (r.kind as PolicyKind) ?? 'notice',
      title: r.title,
      summary: r.summary ?? '',
      content: r.content ?? '',
      audience: (r.audience as PolicyAudience) ?? 'general',
      category: (r.category as PolicyCategory) ?? 'notice',
      externalUrl: r.externalUrl ?? '',
      publishedDate: r.publishedDate ?? '',
    })
    setFormError(null)
    setEditing(r)
  }

  const urlOk = !form.externalUrl.trim() || isAbsoluteHttpUrl(form.externalUrl)
  const canSave = form.title.trim().length > 0 && urlOk

  const save = async () => {
    setSaving(true)
    setFormError(null)
    const payload: SavePolicyInput = {
      kind: form.kind,
      title: form.title.trim(),
      summary: form.summary.trim() || undefined,
      content: form.content.trim() || undefined,
      audience: form.kind === 'policy_guide' ? form.audience : undefined,
      category: form.kind === 'notice' ? form.category : undefined,
      externalUrl: form.externalUrl.trim() || undefined,
      publishedDate: form.publishedDate || undefined,
    }
    try {
      if (editing === 'new') {
        await partnerPoliciesService.createPolicy(payload)
        setNoticeIsError(false)
        setNotice('政策内容已保存为待审核;本机构审核通过并确认发布后,终端才会展示。')
      } else if (editing) {
        const updated = await partnerPoliciesService.updatePolicy(editing.id, payload)
        setNoticeIsError(false)
        setNotice(
          `修改已保存${typeof updated.contentVersion === 'number' ? `,内容版本更新为 v${updated.contentVersion}` : ''}。`
          + '该内容已回到待审核,本机构重新审核通过并确认发布前,终端不展示。',
        )
      }
      setEditing(null)
      void refresh()
    } catch (e) {
      setFormError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async (row: PartnerPolicyRecord) => {
    setBusyId(row.id)
    try {
      await partnerPoliciesService.approvePolicy(row.id)
      setNoticeIsError(false)
      setNotice(`「${row.title}」已审核通过。发布前还需确认发布责任,点「发布」完成。`)
      void refresh()
    } catch (e) {
      setNoticeIsError(true)
      setNotice(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  const handleUnpublish = async (row: PartnerPolicyRecord) => {
    setBusyId(row.id)
    setConfirmUnpublish(null)
    try {
      await partnerPoliciesService.unpublishPolicy(row.id)
      setNoticeIsError(false)
      setNotice('政策内容已下架，终端将不再展示。')
      void refresh()
    } catch (e) {
      setNoticeIsError(true)
      setNotice(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (row: PartnerPolicyRecord) => {
    setBusyId(row.id)
    setConfirmDelete(null)
    try {
      await partnerPoliciesService.deletePolicy(row.id)
      setNoticeIsError(false)
      setNotice('政策内容已删除')
      void refresh()
    } catch (e) {
      setNoticeIsError(true)
      setNotice(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <Page title="政策公告" subtitle={withFrontendHint('加载中...', FRONTEND_HINT.policy)}>
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="政策公告" subtitle={withFrontendHint('加载失败', FRONTEND_HINT.policy)}>
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <FileTextIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="政策公告"
      subtitle={withFrontendHint(`共 ${total} 条政策内容 — 政策扶持条目与政策公告`, FRONTEND_HINT.policy)}
      actions={
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={openNew}
            disabled={!canCreate}
            title={canCreate ? undefined : CANNOT_CREATE_HINT}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:pointer-events-none disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            新增政策内容
          </button>
          {!canCreate && (
            <p className="max-w-[300px] text-right text-xs leading-relaxed text-neutral-500">{CANNOT_CREATE_HINT}</p>
          )}
        </div>
      }
    >
      {notice && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          noticeIsError
            ? 'border-error/30 bg-error-bg text-error-fg'
            : 'border-success/30 bg-success-bg text-success-fg'
        }`}>
          {notice}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <span className="w-14 text-xs text-neutral-400">审核状态</span>
        <div className="flex gap-2">
          {REVIEW_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => { setReviewFilter(f); setPage(1) }}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                reviewFilter === f ? FILTER_SELECTED_CLASS : FILTER_IDLE_CLASS
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <PolicyTable rows={rows} page={page} total={total} onPageChange={setPage} reviewFilter={reviewFilter} canCreate={canCreate} cannotCreateHint={CANNOT_CREATE_HINT}
        busyId={busyId} openEdit={openEdit} setRulesFor={setRulesFor} handleApprove={handleApprove} setReleasing={setReleasing} setConfirmUnpublish={setConfirmUnpublish} setConfirmDelete={setConfirmDelete} />

      <p className="mt-3 text-xs text-neutral-400">
        政策内容只做说明：仅政策说明、材料清单与官方入口；不承诺补贴到账、不代申请。录入后由本机构审核通过、确认发布责任并发布,才会在一体机「政策服务」页展示;平台管理员不审核、不代发,只在违法违规等紧急情况下单向下架。
        政策扶持条目可另行录入「申领条件」:条件按政策原文逐条录入,一体机据此给出「相符 / 不符 / 无法判定」的机械比对结果,不做资格认定;未录入条件的政策不会出现任何判定结论。
      </p>

      {rulesFor && (
        <EligibilityRulesDrawer
          policy={rulesFor}
          onClose={() => setRulesFor(null)}
          onSaved={() => {
            setNoticeIsError(false)
            setNotice('申领条件已保存。该政策已重新进入待审核,审核通过并重新发布前,一体机不会使用这组条件。')
            void refresh()
          }}
        />
      )}

      {/* 新增/编辑抽屉 */}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增政策内容' : '编辑政策内容'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} disabled={saving} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">取消</button>
            <button onClick={save} disabled={saving || !canSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? '保存中…' : editing === 'new' ? '提交审核' : '保存并重新提审'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && <p className="rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">{formError}</p>}
          {editing !== null && editing !== 'new' && (
            <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg">
              {editing.publishStatus === 'published'
                ? `这条政策已发布${typeof editing.contentVersion === 'number' ? `(v${editing.contentVersion})` : ''}。保存修改会生成新的内容版本,并立即从终端撤下、回到待审核;须本机构重新审核通过并确认发布后,终端才会展示新版本。`
                : '保存后该内容将重新进入待审核状态,内容版本随之更新;本机构审核通过并确认发布前,终端不展示。'}
            </p>
          )}
          <Field label="内容类型" required>
            <select className={inputCls} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as PolicyKind }))}>
              <option value="notice">政策公告(公告/通知/招募,展示在公告列表)</option>
              <option value="policy_guide">政策扶持条目(按人群分组展示)</option>
            </select>
          </Field>
          <Field label="标题" required>
            <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          {form.kind === 'policy_guide' ? (
            <Field label="适用人群" required>
              <select className={inputCls} value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as PolicyAudience }))}>
                {Object.entries(AUDIENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="公告标签" required>
              <select className={inputCls} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as PolicyCategory }))}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          )}
          <Field label="摘要(一体机列表展示)">
            <textarea className={`${inputCls} h-16 resize-none`} maxLength={500} value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} />
          </Field>
          <Field label="正文(政策说明/材料清单/办理指引)">
            <textarea className={`${inputCls} h-32 resize-none`} maxLength={10000} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="政策来源 / 办理链接">
              <input className={inputCls} placeholder="https://…(请填写发布主体或办理渠道链接)" value={form.externalUrl} onChange={(e) => setForm((f) => ({ ...f, externalUrl: e.target.value }))} />
              {form.externalUrl.trim() && !isAbsoluteHttpUrl(form.externalUrl) && (
                <p className="mt-1 text-xs text-error-fg">请填写以 http:// 或 https:// 开头的有效链接</p>
              )}
            </Field>
            <Field label="展示日期">
              <input lang="zh-CN" type="date" className={inputCls} value={form.publishedDate} onChange={(e) => setForm((f) => ({ ...f, publishedDate: e.target.value }))} />
            </Field>
          </div>
          <p className="text-xs text-neutral-400">
            合规提示:内容仅做政策说明与来源链接指引;提交前请核对发布主体和目标域名;请勿出现"补贴必到账""代为申请"等承诺性表述,此类内容审核将不予通过。
          </p>
        </div>
      </Drawer>

      <PolicyReleaseDialog
        policy={releasing}
        onClose={() => setReleasing(null)}
        onReleased={(updated) => {
          setReleasing(null)
          setNoticeIsError(false)
          setNotice(
            `「${updated.title}」已发布`
            + (typeof updated.publishConfirmedContentVersion === 'number' ? `(v${updated.publishConfirmedContentVersion})` : '')
            + ',发布责任确认已记录。',
          )
          void refresh()
        }}
      />

      <ConfirmActionDialog
        open={confirmUnpublish !== null}
        title="确认下架政策"
        description={confirmUnpublish
          ? `下架后终端将不再展示「${confirmUnpublish.title}」。`
          : ''}
        confirmLabel="确认下架"
        busy={busyId !== null}
        onCancel={() => setConfirmUnpublish(null)}
        onConfirm={() => confirmUnpublish && void handleUnpublish(confirmUnpublish)}
      />
      <ConfirmActionDialog
        open={confirmDelete !== null}
        title="确认删除政策"
        description={confirmDelete
          ? `删除「${confirmDelete.title}」后不可恢复。终端若仍在展示，将立即失去该条内容。`
          : ''}
        confirmLabel="确认删除"
        tone="danger"
        busy={busyId !== null}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void handleDelete(confirmDelete)}
      />
    </Page>
  )
}
