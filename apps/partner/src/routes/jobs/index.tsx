import { useEffect, useState } from 'react'
import { mergeById, replaceIfChanged, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { Button, Card, Drawer, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { BriefcaseIcon, PlusIcon } from 'lucide-react'
import type {
  PartnerJobRecord,
  JobCategory,
  ReviewStatus,
  PublishStatus,
  UpdatePartnerJobInput,
} from '../../services/api'
import { getPartnerJobQualitySummary, getPartnerJobs, importPartnerJobs, unpublishPartnerJob, updatePartnerJob } from '../../services/api'
import { JobQualitySummaryPanel } from './components/JobQualitySummaryPanel'

// ─── Display maps ─────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<JobCategory, { label: string; style: string }> = {
  fulltime: { label: '全职', style: 'bg-info-bg text-info-fg'     },
  intern:   { label: '实习', style: 'bg-purple-50 text-purple-600' },
  campus:   { label: '校招', style: 'bg-success-bg text-success-fg'   },
  parttime: { label: '兼职', style: 'bg-warning-bg text-warning-fg' },
}

const REVIEW_MAP: Record<ReviewStatus, { badge: 'warning' | 'info' | 'success' | 'error'; label: string }> = {
  pending:   { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info',    label: '审核中' },
  approved:  { badge: 'success', label: '已通过' },
  rejected:  { badge: 'error',   label: '已拒绝' },
}

const PUBLISH_MAP: Record<PublishStatus, { dot: string; label: string }> = {
  draft:       { dot: 'bg-warning', label: '待发布' },
  published:   { dot: 'bg-success',  label: '已发布' },
  unpublished: { dot: 'bg-neutral-300',   label: '已下架' },
  expired:     { dot: 'bg-neutral-300',   label: '已过期' },
}

const CATEGORY_FILTERS = ['全部', '全职', '实习', '校招', '兼职'] as const
const REVIEW_FILTERS   = ['全部', '待审核', '审核中', '已通过', '已拒绝'] as const
const CATEGORY_FILTER_MAP: Record<string, JobCategory | null>  = { 全部: null, 全职: 'fulltime', 实习: 'intern', 校招: 'campus', 兼职: 'parttime' }
const REVIEW_FILTER_MAP:   Record<string, ReviewStatus | null> = { 全部: null, 待审核: 'pending', 审核中: 'reviewing', 已通过: 'approved', 已拒绝: 'rejected' }
const PARTNER_JOBS_REFRESH_KEY = 'partner:jobs'
const PARTNER_JOB_QUALITY_REFRESH_KEY = 'partner:jobs:quality'

/** DB category('fulltime' 等)→ 编辑表单 workType('full_time' 等)。 */
const CATEGORY_TO_WORKTYPE: Record<JobCategory, 'full_time' | 'part_time' | 'internship'> = {
  fulltime: 'full_time',
  parttime: 'part_time',
  intern:   'internship',
  campus:   'full_time',
}

const WORKTYPE_OPTIONS = [
  { value: 'full_time',  label: '全职' },
  { value: 'part_time',  label: '兼职' },
  { value: 'internship', label: '实习' },
] as const

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

interface JobFormState {
  title: string
  company: string
  city: string
  sourceUrl: string
  workType: 'full_time' | 'part_time' | 'internship' | ''
  salary: string
  tags: string
  description: string
  requirements: string
}

const EMPTY_FORM: JobFormState = {
  title: '', company: '', city: '', sourceUrl: '', workType: '', salary: '', tags: '', description: '', requirements: '',
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') return (e as Error).message
  return '操作失败,请重试'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const [categoryFilter, setCategoryFilter] = useState('全部')
  const [reviewFilter,   setReviewFilter]   = useState('全部')
  // 编辑/新增抽屉
  const [editing, setEditing] = useState<PartnerJobRecord | 'new' | null>(null)
  const [form, setForm] = useState<JobFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, status, refresh } = useRefreshable(
    PARTNER_JOBS_REFRESH_KEY,
    getPartnerJobs,
    {
      intervalMs: 60_000,
      merge: mergeById<PartnerJobRecord>((item) => item.id),
      failPolicy: 'keep-last',
    },
  )
  const { data: qualitySummary = [] } = useRefreshable(
    PARTNER_JOB_QUALITY_REFRESH_KEY,
    getPartnerJobQualitySummary,
    {
      intervalMs: 60_000,
      merge: replaceIfChanged,
      failPolicy: 'keep-last',
    },
  )

  useInteractionLock(editing !== null || saving || busyId !== null, [PARTNER_JOBS_REFRESH_KEY, PARTNER_JOB_QUALITY_REFRESH_KEY], 'hard')

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const jobs = data ?? []
  const loading = status === 'idle' || (status === 'loading' && jobs.length === 0)
  const error = status === 'error' && jobs.length === 0

  const filtered = jobs.filter((j) => {
    const matchCat    = categoryFilter === '全部' || j.category     === CATEGORY_FILTER_MAP[categoryFilter]
    const matchReview = reviewFilter   === '全部' || j.reviewStatus === REVIEW_FILTER_MAP[reviewFilter]
    return matchCat && matchReview
  })

  const reviewCounts = {
    全部:   jobs.length,
    待审核: jobs.filter((j) => j.reviewStatus === 'pending').length,
    审核中: jobs.filter((j) => j.reviewStatus === 'reviewing').length,
    已通过: jobs.filter((j) => j.reviewStatus === 'approved').length,
    已拒绝: jobs.filter((j) => j.reviewStatus === 'rejected').length,
  }

  const handleUnpublish = async (id: string) => {
    setBusyId(id)
    try {
      await unpublishPartnerJob(id)
      void refresh()
    } catch (e) {
      setNotice(errMsg(e))
    } finally {
      setBusyId(null)
    }
  }

  const openNew = () => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditing('new')
  }

  const openEdit = (j: PartnerJobRecord) => {
    setForm({
      title: j.title,
      company: j.company,
      city: j.city,
      sourceUrl: j.sourceUrl,
      workType: j.category ? CATEGORY_TO_WORKTYPE[j.category] : '',
      salary: j.salary ?? '',
      tags: (j.tags ?? []).join(','),
      description: j.description ?? '',
      requirements: j.requirements ?? '',
    })
    setFormError(null)
    setEditing(j)
  }

  const canSave = form.title.trim() && form.company.trim() && form.city.trim() && form.sourceUrl.trim()

  const save = async () => {
    setSaving(true)
    setFormError(null)
    const payload: UpdatePartnerJobInput = {
      title: form.title.trim(),
      company: form.company.trim(),
      city: form.city.trim(),
      sourceUrl: form.sourceUrl.trim(),
      salary: form.salary.trim() || undefined,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      description: form.description.trim() || undefined,
      requirements: form.requirements.trim() || undefined,
      workType: form.workType || undefined,
    }
    try {
      if (editing === 'new') {
        // 手动录入岗位:走导入端点,externalId 由前端生成 MANUAL- 前缀(本机构手工来源)
        const externalId = `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await importPartnerJobs([{ ...payload, externalId, title: payload.title!, company: payload.company!, city: payload.city!, sourceUrl: payload.sourceUrl! }])
        setNotice('岗位已录入,进入待审核;管理员审核通过并发布后,终端才会展示。')
      } else if (editing) {
        await updatePartnerJob(editing.id, payload)
        setNotice('修改已保存。该岗位已重新进入待审核,审核通过并重新发布前,终端不展示该条数据。')
      }
      setEditing(null)
      void refresh()
    } catch (e) {
      setFormError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Page title="岗位信息管理" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-neutral-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="岗位信息管理" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <BriefcaseIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="岗位信息管理"
      subtitle={`共 ${jobs.length} 条岗位`}
      actions={
        <Button size="sm" variant="primary" className="flex items-center gap-1.5" onClick={openNew}>
          <PlusIcon className="h-4 w-4" />
          新增岗位
        </Button>
      }
    >
      {notice && (
        <div className="mb-4 rounded-lg border border-success/30 bg-success-bg px-4 py-3 text-sm text-success-fg">
          {notice}
        </div>
      )}

      <JobQualitySummaryPanel qualitySummary={qualitySummary} jobCount={jobs.length} />

      {/* 双行筛选 */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-neutral-400">岗位类型</span>
          <div className="flex gap-2">
            {CATEGORY_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setCategoryFilter(f)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  categoryFilter === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-neutral-400">审核状态</span>
          <div className="flex gap-2">
            {REVIEW_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setReviewFilter(f)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  reviewFilter === f ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
                }`}
              >
                {f}
                <span className="ml-1 text-xs opacity-70">{reviewCounts[f]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['外部编号', '岗位标题', '公司', '城市', '类型', '来源链接', '同步时间', '审核状态', '发布状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sm text-neutral-400">
                    <BriefcaseIcon className="mx-auto mb-2 h-8 w-8 text-neutral-200" />
                    当前筛选条件下无岗位
                  </td>
                </tr>
              ) : (
                filtered.map((j) => {
                  const cat     = j.category ? CATEGORY_MAP[j.category] : undefined
                  const review  = REVIEW_MAP[j.reviewStatus]
                  const publish = PUBLISH_MAP[j.publishStatus]
                  return (
                    <tr key={j.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-400">{j.externalId}</td>
                      <td className="px-4 py-3 font-medium text-neutral-800">{j.title}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{j.company}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{j.city}</td>
                      <td className="px-4 py-3">
                        {cat
                          ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${cat.style}`}>{cat.label}</span>
                          : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-primary-600">
                        <a href={j.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                          查看来源
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{j.syncTime}</td>
                      <td className="px-4 py-3"><StatusBadge dot status={review.badge}  label={review.label}  /></td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                          <span className={`h-1.5 w-1.5 rounded-full ${publish.dot}`} aria-hidden="true" />
                          {publish.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                            onClick={() => openEdit(j)}
                          >
                            编辑
                          </button>
                          {j.publishStatus === 'published' && (
                            <button
                              disabled={busyId === j.id}
                              className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg"
                              onClick={() => void handleUnpublish(j.id)}
                            >
                              {busyId === j.id ? '处理中…' : '下架'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        本后台仅管理外部来源岗位链接，不在本系统内接收求职者简历，不参与招聘闭环。编辑或新增的岗位需经管理员重新审核后才会在终端展示。
      </p>

      {/* 编辑/新增抽屉 */}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增岗位(手动录入)' : '编辑岗位'}
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
          {editing !== 'new' && (
            <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg">
              保存后该岗位将重新进入待审核状态;审核通过并重新发布前,终端不展示该条数据。外部编号与来源机构不可修改。
            </p>
          )}
          <Field label="岗位标题" required>
            <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="公司名称" required>
              <input className={inputCls} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
            </Field>
            <Field label="城市" required>
              <input className={inputCls} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="岗位类型">
              <select className={inputCls} value={form.workType} onChange={(e) => setForm((f) => ({ ...f, workType: e.target.value as JobFormState['workType'] }))}>
                <option value="">未指定</option>
                {WORKTYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="薪资(展示文本)">
              <input className={inputCls} placeholder="如 8k-12k" value={form.salary} onChange={(e) => setForm((f) => ({ ...f, salary: e.target.value }))} />
            </Field>
          </div>
          <Field label="外部投递链接(来源平台)" required>
            <input className={inputCls} placeholder="https://…(求职者跳转外部平台投递)" value={form.sourceUrl} onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))} />
          </Field>
          <Field label="标签(逗号分隔)">
            <input className={inputCls} placeholder="如 五险一金,双休" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </Field>
          <Field label="职位描述">
            <textarea className={`${inputCls} h-24 resize-none`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="任职要求">
            <textarea className={`${inputCls} h-24 resize-none`} value={form.requirements} onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))} />
          </Field>
          <p className="text-xs text-neutral-400">
            岗位仅作为第三方来源信息展示,求职者通过"去来源平台投递/扫码投递"跳转,本系统不接收简历。
          </p>
        </div>
      </Drawer>
    </Page>
  )
}
