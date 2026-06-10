import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Drawer, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { CalendarIcon, PlusIcon } from 'lucide-react'
import type {
  PartnerFairRecord,
  JobFairStatus,
  ReviewStatus,
  PublishStatus,
  UpdatePartnerFairInput,
} from '../../services/api'
import { getPartnerFairs, importPartnerFairs, unpublishPartnerFair, updatePartnerFair } from '../../services/api'

// ─── Display maps ─────────────────────────────────────────────────────────────

const FAIR_STATUS_MAP: Record<JobFairStatus, { style: string; label: string }> = {
  upcoming: { style: 'bg-blue-50 text-blue-600',   label: '未开始' },
  ongoing:  { style: 'bg-green-50 text-green-600', label: '进行中' },
  ended:    { style: 'bg-gray-100 text-gray-500',  label: '已结束' },
}

const REVIEW_MAP: Record<ReviewStatus, { badge: 'warning' | 'info' | 'success' | 'error'; label: string }> = {
  pending:   { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info',    label: '审核中' },
  approved:  { badge: 'success', label: '已通过' },
  rejected:  { badge: 'error',   label: '已拒绝' },
}

const PUBLISH_MAP: Record<PublishStatus, { badge: 'success' | 'warning' | 'default'; label: string }> = {
  draft:       { badge: 'warning', label: '待发布' },
  published:   { badge: 'success', label: '已发布' },
  unpublished: { badge: 'default', label: '已下架' },
  expired:     { badge: 'default', label: '已过期' },
}

const STATUS_FILTERS = ['全部', '未开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, JobFairStatus | null> = {
  全部: null, 未开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended',
}

const THEME_OPTIONS = [
  { value: 'general',     label: '综合招聘会' },
  { value: 'campus',      label: '校园招聘会' },
  { value: 'campus_corp', label: '校企合作专场' },
  { value: 'industry',    label: '行业专场' },
] as const

const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}

/** ISO ↔ <input type="datetime-local">(本地时区)。 */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function localInputToIso(value: string): string {
  return new Date(value).toISOString()
}

interface FairFormState {
  title: string
  theme: 'general' | 'campus' | 'campus_corp' | 'industry'
  startAt: string // ISO
  endAt: string   // ISO
  venue: string
  city: string
  address: string
  sourceUrl: string
  description: string
}

const EMPTY_FORM: FairFormState = {
  title: '', theme: 'general', startAt: '', endAt: '', venue: '', city: '', address: '', sourceUrl: '', description: '',
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') return (e as Error).message
  return '操作失败,请重试'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FairsPage() {
  const [fairs,        setFairs]        = useState<PartnerFairRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [statusFilter, setStatusFilter] = useState('全部')
  const [editing, setEditing] = useState<PartnerFairRecord | 'new' | null>(null)
  const [form, setForm] = useState<FairFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    getPartnerFairs()
      .then(setFairs)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const filtered = statusFilter === '全部'
    ? fairs
    : fairs.filter((f) => f.status === STATUS_FILTER_MAP[statusFilter])

  const counts = {
    全部:   fairs.length,
    未开始: fairs.filter((f) => f.status === 'upcoming').length,
    进行中: fairs.filter((f) => f.status === 'ongoing').length,
    已结束: fairs.filter((f) => f.status === 'ended').length,
  }

  const handleUnpublish = (id: string) => {
    unpublishPartnerFair(id).then((updated) => {
      setFairs((prev) => prev.map((f) => f.id === id ? updated : f))
    })
  }

  const openNew = () => {
    setForm(EMPTY_FORM)
    setFormError(null)
    setEditing('new')
  }

  const openEdit = (f: PartnerFairRecord) => {
    setForm({
      title: f.name,
      theme: (f.theme as FairFormState['theme']) ?? 'general',
      startAt: f.startTime,
      endAt: f.endTime,
      venue: f.venue,
      city: f.city ?? '',
      address: f.address ?? '',
      sourceUrl: f.sourceUrl,
      description: f.description ?? '',
    })
    setFormError(null)
    setEditing(f)
  }

  const canSave =
    form.title.trim() && form.venue.trim() && form.city.trim() && form.sourceUrl.trim() && form.startAt && form.endAt

  const save = async () => {
    setSaving(true)
    setFormError(null)
    const payload: UpdatePartnerFairInput = {
      title: form.title.trim(),
      theme: form.theme,
      startAt: form.startAt,
      endAt: form.endAt,
      venue: form.venue.trim(),
      city: form.city.trim(),
      address: form.address.trim() || undefined,
      sourceUrl: form.sourceUrl.trim(),
      description: form.description.trim() || undefined,
    }
    try {
      if (editing === 'new') {
        const externalId = `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        await importPartnerFairs([{
          externalId,
          title: payload.title!,
          theme: payload.theme,
          startAt: payload.startAt!,
          endAt: payload.endAt!,
          venue: payload.venue!,
          city: payload.city!,
          address: payload.address,
          description: payload.description,
          sourceUrl: payload.sourceUrl!,
        }])
        setNotice('招聘会已录入,进入待审核;管理员审核通过并发布后,终端才会展示。')
      } else if (editing) {
        await updatePartnerFair(editing.id, payload)
        setNotice('修改已保存。该招聘会已重新进入待审核,审核通过并重新发布前,终端不展示该条数据。')
      }
      setEditing(null)
      load()
    } catch (e) {
      setFormError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Page title="招聘会信息管理" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="招聘会信息管理" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <CalendarIcon className="h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="招聘会信息管理"
      subtitle={`共 ${fairs.length} 场招聘会`}
      actions={
        <Button size="sm" variant="primary" className="flex items-center gap-1.5" onClick={openNew}>
          <PlusIcon className="h-4 w-4" />
          新增招聘会
        </Button>
      }
    >
      {notice && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {notice}
        </div>
      )}

      {/* 筛选标签 */}
      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
            <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['外部编号', '招聘会名称', '主办方', '时间', '地点', '会议状态', '来源预约链接', '同步时间', '审核状态', '发布状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-sm text-gray-400">
                    <CalendarIcon className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                    当前筛选条件下无招聘会
                  </td>
                </tr>
              ) : (
                filtered.map((f) => {
                  const fs      = FAIR_STATUS_MAP[f.status]
                  const review  = REVIEW_MAP[f.reviewStatus]
                  const publish = PUBLISH_MAP[f.publishStatus]
                  return (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-400">{f.externalId}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{f.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{f.organizer}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        <div>{f.startTime.slice(0, 16).replace('T', ' ')}</div>
                        <div className="text-gray-300">至 {f.endTime.slice(5, 16).replace('T', ' ')}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{f.venue}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${fs.style}`}>{fs.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-primary-600">
                        <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                          查看来源
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{f.syncTime}</td>
                      <td className="px-4 py-3"><StatusBadge status={review.badge}  label={review.label}  /></td>
                      <td className="px-4 py-3"><StatusBadge status={publish.badge} label={publish.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                            onClick={() => openEdit(f)}
                          >
                            编辑
                          </button>
                          {f.publishStatus === 'published' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50"
                              onClick={() => handleUnpublish(f.id)}
                            >
                              下架
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

      <p className="mt-3 text-xs text-gray-400">
        本后台仅管理来源数据，不在本系统内接收求职者简历，不参与招聘闭环。编辑或新增的招聘会需经管理员重新审核后才会在终端展示;现场活动资料由管理员在运营后台维护。
      </p>

      {/* 编辑/新增抽屉 */}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增招聘会(手动录入)' : '编辑招聘会'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} disabled={saving} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">取消</button>
            <button onClick={save} disabled={saving || !canSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? '保存中…' : editing === 'new' ? '提交审核' : '保存并重新提审'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{formError}</p>}
          {editing !== 'new' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              保存后该招聘会将重新进入待审核状态;审核通过并重新发布前,终端不展示该条数据。外部编号与来源机构不可修改。
            </p>
          )}
          <Field label="招聘会名称" required>
            <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="主题类型">
            <select className={inputCls} value={form.theme} onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value as FairFormState['theme'] }))}>
              {THEME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="开始时间" required>
              <input
                type="datetime-local"
                className={inputCls}
                value={form.startAt ? isoToLocalInput(form.startAt) : ''}
                onChange={(e) => e.target.value && setForm((f) => ({ ...f, startAt: localInputToIso(e.target.value) }))}
              />
            </Field>
            <Field label="结束时间" required>
              <input
                type="datetime-local"
                className={inputCls}
                value={form.endAt ? isoToLocalInput(form.endAt) : ''}
                onChange={(e) => e.target.value && setForm((f) => ({ ...f, endAt: localInputToIso(e.target.value) }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="举办场馆" required>
              <input className={inputCls} value={form.venue} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} />
            </Field>
            <Field label="城市" required>
              <input className={inputCls} value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </Field>
          </div>
          <Field label="详细地址">
            <input className={inputCls} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label="来源平台预约链接" required>
            <input className={inputCls} placeholder="https://…(求职者跳转外部平台预约)" value={form.sourceUrl} onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))} />
          </Field>
          <Field label="简介">
            <textarea className={`${inputCls} h-24 resize-none`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <p className="text-xs text-gray-400">
            招聘会仅作为第三方/官方来源信息展示,求职者通过"去来源平台预约/扫码预约"跳转,本系统不接收报名信息。
          </p>
        </div>
      </Drawer>
    </Page>
  )
}
