import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Drawer, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import {
  ActivityIcon,
  BuildingIcon,
  FileTextIcon,
  LayoutGridIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { Page } from '../Page'
import { API_BASE_URL } from '../../services/api/client'
import {
  fairsAdminService,
  type AdminFairDetail,
  type AdminFairListItem,
  type AdminFairStats,
  type AdminFairView,
  type FairCompanyView,
  type FairMaterialView,
  type FairZoneView,
  type SaveFairCompanyInput,
  type SaveFairZoneInput,
  type UpdateFairInfoInput,
} from '../../services/api/fairsAdmin'

// ─── 展示常量 ─────────────────────────────────────────────────────────────────

const THEME_LABELS: Record<string, string> = {
  general: '综合招聘会',
  campus: '校园招聘会',
  campus_corp: '校企合作专场',
  industry: '行业专场',
}

const MATERIAL_TYPE_LABELS: Record<string, string> = {
  schedule: '活动日程',
  venue_map: '展馆地图',
  company_list: '企业名册',
  position_list: '岗位汇总',
  brochure: '宣传手册',
  other: '其他资料',
}

const ZONE_CATEGORY_LABELS: Record<string, string> = {
  innovation: '创新展区',
  service: '现场服务',
  campus_corp_topic: '校企合作主题',
}

const REVIEW_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  pending:   { status: 'warning', label: '待审核' },
  reviewing: { status: 'info',    label: '审核中' },
  approved:  { status: 'success', label: '已通过' },
  rejected:  { status: 'error',   label: '已拒绝' },
}

const PUBLISH_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  draft:       { status: 'default', label: '草稿' },
  published:   { status: 'success', label: '已发布' },
  unpublished: { status: 'warning', label: '已下架' },
  expired:     { status: 'default', label: '已过期' },
}

type FairTimeStatus = 'upcoming' | 'ongoing' | 'ended'
const TIME_STATUS_STYLES: Record<FairTimeStatus, string> = {
  upcoming: 'bg-blue-50 text-blue-600',
  ongoing:  'bg-green-50 text-green-600',
  ended:    'bg-gray-100 text-gray-400',
}
const TIME_STATUS_LABELS: Record<FairTimeStatus, string> = { upcoming: '未开始', ongoing: '进行中', ended: '已结束' }

function deriveTimeStatus(startAt: string, endAt: string): FairTimeStatus {
  const nowMs = Date.now()
  if (nowMs < new Date(startAt).getTime()) return 'upcoming'
  if (nowMs > new Date(endAt).getTime()) return 'ended'
  return 'ongoing'
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatSize(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

/** 后端返回的 previewUrl 是 /api/v1/... 相对签名地址,Admin dev server 需拼到 API 源。 */
function resolvePreviewUrl(previewUrl: string): string {
  if (/^(https?:|data:|blob:)/.test(previewUrl)) return previewUrl
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return previewUrl.startsWith('/') ? `${origin}${previewUrl}` : previewUrl
}

/** ISO ↔ <input type="datetime-local">(本地时区)。 */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function localInputToIso(value: string): string {
  return new Date(value).toISOString()
}

// ─── 通用小组件 ───────────────────────────────────────────────────────────────

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

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function GhostButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

/** 两步删除按钮:第一次点击进入确认态,5 秒内再点执行删除。 */
function DangerDeleteButton({ onConfirm, busy }: { onConfirm: () => void; busy?: boolean }) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), 5000)
    return () => clearTimeout(t)
  }, [arming])
  return (
    <button
      disabled={busy}
      onClick={() => {
        if (arming) {
          setArming(false)
          onConfirm()
        } else {
          setArming(true)
        }
      }}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        arming ? 'bg-red-600 text-white hover:bg-red-700' : 'text-red-500 hover:bg-red-50'
      }`}
    >
      {arming ? '确认删除?' : <Trash2Icon className="h-3.5 w-3.5" />}
    </button>
  )
}

function InlineError({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{message}</p>
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败,请重试'
}

// ─── 基本信息编辑抽屉 ─────────────────────────────────────────────────────────

function EditFairDrawer({
  fair,
  open,
  onClose,
  onSaved,
}: {
  fair: AdminFairView
  open: boolean
  onClose: () => void
  onSaved: (updated: AdminFairView) => void
}) {
  const [form, setForm] = useState<UpdateFairInfoInput>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm({
        title: fair.title,
        theme: fair.theme,
        startAt: fair.startAt,
        endAt: fair.endAt,
        venue: fair.venue,
        city: fair.city,
        address: fair.address ?? '',
        description: fair.description ?? '',
      })
      setError(null)
    }
  }, [open, fair])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const updated = await fairsAdminService.updateFairInfo(fair.id, form)
      onSaved(updated)
      onClose()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="编辑招聘会基本信息" size="md"
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose} disabled={saving}>取消</GhostButton>
          <PrimaryButton onClick={save} disabled={saving || !form.title?.trim() || !form.venue?.trim() || !form.city?.trim()}>
            {saving ? '保存中…' : '保存'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4">
        <InlineError message={error} />
        <Field label="名称" required>
          <input className={inputCls} value={form.title ?? ''} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label="主题类型">
          <select className={inputCls} value={form.theme ?? 'general'} onChange={(e) => setForm((f) => ({ ...f, theme: e.target.value }))}>
            {Object.entries(THEME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
            <input className={inputCls} value={form.venue ?? ''} onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))} />
          </Field>
          <Field label="城市" required>
            <input className={inputCls} value={form.city ?? ''} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
          </Field>
        </div>
        <Field label="详细地址">
          <input className={inputCls} value={form.address ?? ''} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        </Field>
        <Field label="简介">
          <textarea className={`${inputCls} h-24 resize-none`} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <p className="text-xs text-gray-400">
          来源字段(来源机构 / 外部编号 / 来源链接)不可修改,保持数据可溯源。来源机构再次同步时,以来源数据为准,可能覆盖此处人工修订。
        </p>
      </div>
    </Drawer>
  )
}

// ─── 参展企业 Tab ─────────────────────────────────────────────────────────────

const EMPTY_COMPANY: SaveFairCompanyInput = { name: '', industry: '', scale: '', description: '', sourceUrl: '', hiringTags: '', jobsCount: 0 }

function CompaniesTab({
  fairId,
  companies,
  onChanged,
}: {
  fairId: string
  companies: FairCompanyView[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<FairCompanyView | 'new' | null>(null)
  const [form, setForm] = useState<SaveFairCompanyInput>(EMPTY_COMPANY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const openNew = () => {
    setForm(EMPTY_COMPANY)
    setError(null)
    setEditing('new')
  }
  const openEdit = (c: FairCompanyView) => {
    setForm({
      name: c.name,
      industry: c.industry ?? '',
      scale: c.scale ?? '',
      description: c.description ?? '',
      sourceUrl: c.sourceUrl ?? '',
      hiringTags: c.hiringTags.join(','),
      jobsCount: c.jobsCount,
    })
    setError(null)
    setEditing(c)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      if (editing === 'new') await fairsAdminService.createCompany(fairId, form)
      else if (editing) await fairsAdminService.updateCompany(fairId, editing.id, form)
      setEditing(null)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (companyId: string) => {
    setBusyId(companyId)
    try {
      await fairsAdminService.deleteCompany(fairId, companyId)
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{companies.length} 家参展企业</p>
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
          <PlusIcon className="h-3.5 w-3.5" />
          新增企业
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['企业名称', '行业', '规模', '招聘标签', '岗位数', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {companies.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-xs text-gray-400">暂无参展企业,点击右上角"新增企业"录入</td></tr>
              ) : (
                companies.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{c.industry ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{c.scale ? `${c.scale} 人` : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.hiringTags.length === 0
                          ? <span className="text-xs text-gray-400">—</span>
                          : c.hiringTags.map((t) => (
                            <span key={t} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">{t}</span>
                          ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{c.jobsCount}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(c)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <DangerDeleteButton onConfirm={() => void remove(c.id)} busy={busyId === c.id} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-gray-400">
        合规说明:企业信息仅用于招聘会现场服务展示,系统不接收求职者简历,不参与招聘闭环。
      </p>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增参展企业' : '编辑参展企业'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setEditing(null)} disabled={saving}>取消</GhostButton>
            <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>{saving ? '保存中…' : '保存'}</PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <InlineError message={error} />
          <Field label="企业名称" required>
            <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="行业">
              <input className={inputCls} placeholder="如 互联网/软件" value={form.industry ?? ''} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} />
            </Field>
            <Field label="规模">
              <select className={inputCls} value={form.scale ?? ''} onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value }))}>
                <option value="">未填写</option>
                <option value="<50">&lt;50 人</option>
                <option value="50-500">50-500 人</option>
                <option value="500-2000">500-2000 人</option>
                <option value=">2000">&gt;2000 人</option>
              </select>
            </Field>
          </div>
          <Field label="企业简介">
            <textarea className={`${inputCls} h-20 resize-none`} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="招聘标签(逗号分隔)">
              <input className={inputCls} placeholder="如 校招,实习" value={form.hiringTags ?? ''} onChange={(e) => setForm((f) => ({ ...f, hiringTags: e.target.value }))} />
            </Field>
            <Field label="岗位数">
              <input
                type="number" min={0} className={inputCls} value={form.jobsCount ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, jobsCount: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </Field>
          </div>
          <Field label="来源平台企业页链接">
            <input className={inputCls} placeholder="https://…(用户跳转外部平台查看)" value={form.sourceUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))} />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}

// ─── 展区 Tab ─────────────────────────────────────────────────────────────────

const EMPTY_ZONE: SaveFairZoneInput = { name: '', category: '', city: '', description: '', sortOrder: 0 }

function ZonesTab({
  fairId,
  zones,
  onChanged,
}: {
  fairId: string
  zones: FairZoneView[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<FairZoneView | 'new' | null>(null)
  const [form, setForm] = useState<SaveFairZoneInput>(EMPTY_ZONE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const openNew = () => {
    setForm({ ...EMPTY_ZONE, sortOrder: zones.length })
    setError(null)
    setEditing('new')
  }
  const openEdit = (z: FairZoneView) => {
    setForm({ name: z.name, category: z.category ?? '', city: z.city ?? '', description: z.description ?? '', sortOrder: z.sortOrder })
    setError(null)
    setEditing(z)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: SaveFairZoneInput = { ...form, category: form.category || undefined }
      if (editing === 'new') await fairsAdminService.createZone(fairId, payload)
      else if (editing) await fairsAdminService.updateZone(fairId, editing.id, payload)
      setEditing(null)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (zoneId: string) => {
    setBusyId(zoneId)
    try {
      await fairsAdminService.deleteZone(fairId, zoneId)
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{zones.length} 个展区(按排序值升序展示)</p>
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
          <PlusIcon className="h-3.5 w-3.5" />
          新增展区
        </button>
      </div>

      {zones.length === 0 ? (
        <Card className="p-10 text-center text-xs text-gray-400">暂无展区,点击右上角"新增展区"录入(如 A区 数字经济 / 现场服务区)</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {zones.map((z) => (
            <Card key={z.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500">#{z.sortOrder}</span>
                    <p className="truncate font-medium text-gray-800">{z.name}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    {z.category ? ZONE_CATEGORY_LABELS[z.category] ?? z.category : '未分类'}
                    {z.city ? ` · ${z.city}` : ''}
                  </p>
                  {z.description && <p className="mt-1.5 line-clamp-2 text-xs text-gray-500">{z.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => openEdit(z)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                  <DangerDeleteButton onConfirm={() => void remove(z.id)} busy={busyId === z.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400">
        展区信息用于一体机"展位导览"页展示。当前未建展位(booth)级数据模型,导览图展示展区列表与底图,不含展位坐标。
      </p>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增展区' : '编辑展区'}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setEditing(null)} disabled={saving}>取消</GhostButton>
            <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>{saving ? '保存中…' : '保存'}</PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <InlineError message={error} />
          <Field label="展区名称" required>
            <input className={inputCls} placeholder="如 A区 数字经济" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="类别">
            <select className={inputCls} value={form.category ?? ''} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              <option value="">未分类</option>
              {Object.entries(ZONE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="城市/区">
              <input className={inputCls} value={form.city ?? ''} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </Field>
            <Field label="排序值">
              <input
                type="number" min={0} className={inputCls} value={form.sortOrder ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </Field>
          </div>
          <Field label="说明">
            <textarea className={`${inputCls} h-20 resize-none`} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}

// ─── 活动资料 Tab ─────────────────────────────────────────────────────────────

function MaterialsTab({
  fairId,
  materials,
  onChanged,
}: {
  fairId: string
  materials: FairMaterialView[]
  onChanged: () => void
}) {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadMeta, setUploadMeta] = useState({ name: '', type: 'other', description: '', pageCount: '' })
  const [editing, setEditing] = useState<FairMaterialView | null>(null)
  const [editMeta, setEditMeta] = useState({ name: '', type: 'other', description: '', pageCount: '', allowPrint: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const openUpload = () => {
    setUploadFile(null)
    setUploadMeta({ name: '', type: 'other', description: '', pageCount: '' })
    setError(null)
    setUploadOpen(true)
  }

  const pickFile = (file: File | null) => {
    setUploadFile(file)
    if (file && !uploadMeta.name.trim()) {
      setUploadMeta((m) => ({ ...m, name: file.name.replace(/\.[^.]+$/, '') }))
    }
  }

  const doUpload = async () => {
    if (!uploadFile) return
    setSaving(true)
    setError(null)
    try {
      await fairsAdminService.uploadMaterial(fairId, uploadFile, {
        name: uploadMeta.name.trim(),
        type: uploadMeta.type,
        description: uploadMeta.description.trim() || undefined,
        pageCount: uploadMeta.pageCount ? Math.max(0, Math.floor(Number(uploadMeta.pageCount) || 0)) : undefined,
      })
      setUploadOpen(false)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (m: FairMaterialView) => {
    setEditMeta({
      name: m.name,
      type: m.type,
      description: m.description ?? '',
      pageCount: m.pageCount ? String(m.pageCount) : '',
      allowPrint: m.allowPrint,
    })
    setError(null)
    setEditing(m)
  }

  const doEdit = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      await fairsAdminService.updateMaterial(fairId, editing.id, {
        name: editMeta.name.trim(),
        type: editMeta.type,
        description: editMeta.description.trim() || undefined,
        pageCount: editMeta.pageCount ? Math.max(0, Math.floor(Number(editMeta.pageCount) || 0)) : 0,
        allowPrint: editMeta.allowPrint,
      })
      setEditing(null)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const togglePublish = async (m: FairMaterialView) => {
    setBusyId(m.id)
    try {
      await fairsAdminService.publishMaterial(fairId, m.id, m.publishStatus === 'published' ? 'unpublish' : 'publish')
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (materialId: string) => {
    setBusyId(materialId)
    try {
      await fairsAdminService.deleteMaterial(fairId, materialId)
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{materials.length} 份资料(发布后在一体机"活动资料"页可见)</p>
        <button onClick={openUpload} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
          <UploadIcon className="h-3.5 w-3.5" />
          上传资料
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['资料名称', '类型', '页数', '大小', '打印次数', '状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {materials.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-xs text-gray-400">暂无活动资料,点击右上角"上传资料"(支持 PDF / PNG / JPEG)</td></tr>
              ) : (
                materials.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileTextIcon className="h-4 w-4 shrink-0 text-gray-400" />
                        <span className="font-medium text-gray-800">{m.name}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{MATERIAL_TYPE_LABELS[m.type] ?? m.type}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{m.pageCount > 0 ? `${m.pageCount} 页` : '未填写'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{formatSize(m.fileSizeKB)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex items-center gap-1 text-xs text-gray-600">
                        <PrinterIcon className="h-3.5 w-3.5 text-gray-400" />
                        {m.printCount}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={PUBLISH_BADGE[m.publishStatus]?.status ?? 'default'}
                        label={PUBLISH_BADGE[m.publishStatus]?.label ?? m.publishStatus}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1">
                        {m.previewUrl ? (
                          <a
                            href={resolvePreviewUrl(m.previewUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          >
                            预览
                          </a>
                        ) : (
                          <span className="rounded px-2 py-1 text-xs text-gray-300" title="mock 模式无真实文件">预览</span>
                        )}
                        <button
                          disabled={busyId === m.id}
                          onClick={() => void togglePublish(m)}
                          className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                            m.publishStatus === 'published' ? 'text-orange-500 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {m.publishStatus === 'published' ? '下架' : '发布'}
                        </button>
                        <button onClick={() => openEdit(m)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <DangerDeleteButton onConfirm={() => void remove(m.id)} busy={busyId === m.id} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-gray-400">
        资料文件经服务端校验(PDF / PNG / JPEG,≤20MB),一体机经签名短时链接访问,不暴露存储地址。删除会移除文件并保留删除日志。
      </p>

      {/* 上传抽屉 */}
      <Drawer
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="上传活动资料"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setUploadOpen(false)} disabled={saving}>取消</GhostButton>
            <PrimaryButton onClick={doUpload} disabled={saving || !uploadFile || !uploadMeta.name.trim()}>
              {saving ? '上传中…' : '上传'}
            </PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <InlineError message={error} />
          <Field label="文件(PDF / PNG / JPEG,≤20MB)" required>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary-600 hover:file:bg-primary-100"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          {uploadFile && (
            <p className="text-xs text-gray-500">已选择:{uploadFile.name}({formatSize(Math.round(uploadFile.size / 1024))})</p>
          )}
          <Field label="资料名称" required>
            <input className={inputCls} value={uploadMeta.name} onChange={(e) => setUploadMeta((m) => ({ ...m, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="类型">
              <select className={inputCls} value={uploadMeta.type} onChange={(e) => setUploadMeta((m) => ({ ...m, type: e.target.value }))}>
                {Object.entries(MATERIAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="页数(选填)">
              <input
                type="number" min={0} className={inputCls} placeholder="打印参考"
                value={uploadMeta.pageCount}
                onChange={(e) => setUploadMeta((m) => ({ ...m, pageCount: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="说明(选填)">
            <textarea className={`${inputCls} h-20 resize-none`} value={uploadMeta.description} onChange={(e) => setUploadMeta((m) => ({ ...m, description: e.target.value }))} />
          </Field>
          <p className="text-xs text-gray-400">上传后默认为草稿,需点击"发布"后一体机才可见。Word 文档请先转为 PDF 再上传。</p>
        </div>
      </Drawer>

      {/* 编辑抽屉 */}
      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="编辑资料信息"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setEditing(null)} disabled={saving}>取消</GhostButton>
            <PrimaryButton onClick={doEdit} disabled={saving || !editMeta.name.trim()}>{saving ? '保存中…' : '保存'}</PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <InlineError message={error} />
          <Field label="资料名称" required>
            <input className={inputCls} value={editMeta.name} onChange={(e) => setEditMeta((m) => ({ ...m, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="类型">
              <select className={inputCls} value={editMeta.type} onChange={(e) => setEditMeta((m) => ({ ...m, type: e.target.value }))}>
                {Object.entries(MATERIAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="页数">
              <input
                type="number" min={0} className={inputCls}
                value={editMeta.pageCount}
                onChange={(e) => setEditMeta((m) => ({ ...m, pageCount: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="说明">
            <textarea className={`${inputCls} h-20 resize-none`} value={editMeta.description} onChange={(e) => setEditMeta((m) => ({ ...m, description: e.target.value }))} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={editMeta.allowPrint}
              onChange={(e) => setEditMeta((m) => ({ ...m, allowPrint: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300"
            />
            允许在一体机打印
          </label>
          <p className="text-xs text-gray-400">文件本体不可替换;如需换文件,请删除后重新上传。</p>
        </div>
      </Drawer>
    </div>
  )
}

// ─── 数据统计 Tab(仅真实可得字段)────────────────────────────────────────────

function StatsTab({ stats }: { stats: AdminFairStats | null }) {
  if (!stats) return <LoadingState className="py-16" />
  const cards = [
    { label: '参展企业(已录入)', value: stats.companyTotal,        note: '本系统已录入的企业卡片数',  icon: BuildingIcon,  accent: 'text-blue-600 bg-blue-50' },
    { label: '展区',             value: stats.zoneTotal,           note: '导览展区数量',              icon: MapPinIcon,    accent: 'text-teal-600 bg-teal-50' },
    { label: '活动资料',         value: stats.materialTotal,       note: `已发布 ${stats.materialPublished} 份`, icon: FileTextIcon, accent: 'text-purple-600 bg-purple-50' },
    { label: '资料打印次数',     value: stats.materialPrintCount,  note: '一体机打印活动资料次数',    icon: PrinterIcon,   accent: 'text-orange-500 bg-orange-50' },
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(({ label, value, note, icon: Icon, accent }) => (
          <Card key={label} className="p-4">
            <div className={`w-fit rounded-lg p-2 ${accent}`}>
              <Icon className="h-4 w-4" />
            </div>
            <p className="mt-3 text-xl font-bold text-gray-900">{value}</p>
            <p className="mt-0.5 text-xs font-medium text-gray-500">{label}</p>
            <p className="mt-0.5 text-xs text-gray-400">{note}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <p className="mb-2 text-sm font-medium text-gray-700">来源同步快照(仅供参考,非本系统统计)</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{stats.snapshot.companyCount}</p>
            <p className="text-xs text-gray-500">来源标称企业数</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{stats.snapshot.jobCount}</p>
            <p className="text-xs text-gray-500">来源标称岗位数</p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 text-center">
            <p className="text-lg font-bold text-gray-800">{stats.snapshot.viewCount}</p>
            <p className="text-xs text-gray-500">终端浏览次数</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          系统仅统计服务行为(录入 / 浏览 / 打印),不记录求职者个人信息,不参与招聘闭环。现场签到 / 展位入驻未建数据模型,此处不展示估算数据。
        </p>
      </Card>
    </div>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

type TabKey = 'companies' | 'zones' | 'materials' | 'stats'

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'companies', label: '参展企业', icon: BuildingIcon },
  { key: 'zones',     label: '展区管理', icon: LayoutGridIcon },
  { key: 'materials', label: '活动资料', icon: FileTextIcon },
  { key: 'stats',     label: '数据统计', icon: ActivityIcon },
]

export default function FairsPage() {
  const [fairs, setFairs] = useState<AdminFairListItem[]>([])
  const [listState, setListState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminFairDetail | null>(null)
  const [detailState, setDetailState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [stats, setStats] = useState<AdminFairStats | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('companies')
  const [editOpen, setEditOpen] = useState(false)

  const loadList = useCallback(async () => {
    setListState('loading')
    try {
      const rows = await fairsAdminService.listFairs()
      setFairs(rows)
      setListState('ready')
      setSelectedId((prev) => prev && rows.some((f) => f.id === prev) ? prev : rows[0]?.id ?? null)
    } catch {
      setListState('error')
    }
  }, [])

  const loadDetail = useCallback(async (fairId: string) => {
    setDetailState('loading')
    setStats(null)
    try {
      const [d, s] = await Promise.all([
        fairsAdminService.getFairDetail(fairId),
        fairsAdminService.getStats(fairId),
      ])
      setDetail(d)
      setStats(s)
      setDetailState('ready')
    } catch {
      setDetailState('error')
    }
  }, [])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => { if (selectedId) void loadDetail(selectedId) }, [selectedId, loadDetail])

  /** 子资源变更后刷新详情 + 列表计数。 */
  const refresh = useCallback(() => {
    if (selectedId) void loadDetail(selectedId)
    void loadList()
  }, [selectedId, loadDetail, loadList])

  const selectedFair = useMemo(() => detail?.fair ?? null, [detail])

  return (
    <Page
      title="招聘会管理"
      subtitle="招聘会内容运营 — 基本信息 · 参展企业 · 展区 · 活动资料 · 统计(审核/发布请到「招聘会信息源」)"
    >
      {listState === 'loading' && <LoadingState className="py-24" />}
      {listState === 'error' && <ErrorState className="py-24" onRetry={() => void loadList()} />}
      {listState === 'ready' && fairs.length === 0 && (
        <EmptyState
          className="py-24"
          title="暂无招聘会数据"
          description="招聘会由合作机构在机构后台导入,经「招聘会信息源」审核后在此进行内容运营。"
        />
      )}

      {listState === 'ready' && fairs.length > 0 && (
        <>
          {/* 招聘会选择器 */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {fairs.map((fair) => {
              const timeStatus = deriveTimeStatus(fair.startAt, fair.endAt)
              return (
                <button
                  key={fair.id}
                  onClick={() => setSelectedId(fair.id)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    selectedId === fair.id
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1 text-sm font-semibold leading-snug text-gray-900">{fair.title}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TIME_STATUS_STYLES[timeStatus]}`}>
                      {TIME_STATUS_LABELS[timeStatus]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-400">{fair.venue} · {fair.city}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{fmtDateTime(fair.startAt)}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <StatusBadge status={REVIEW_BADGE[fair.reviewStatus]?.status ?? 'default'} label={REVIEW_BADGE[fair.reviewStatus]?.label ?? fair.reviewStatus} />
                    <StatusBadge status={PUBLISH_BADGE[fair.publishStatus]?.status ?? 'default'} label={PUBLISH_BADGE[fair.publishStatus]?.label ?? fair.publishStatus} />
                    <span className="ml-auto text-xs text-gray-400">
                      企业 {fair.counts.companies} · 展区 {fair.counts.zones} · 资料 {fair.counts.materials}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {detailState === 'loading' && <LoadingState className="py-24" />}
          {detailState === 'error' && selectedId && <ErrorState className="py-24" onRetry={() => void loadDetail(selectedId)} />}

          {detailState === 'ready' && selectedFair && (
            <>
              {/* 当前招聘会标题区 */}
              <div className="mb-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-gray-900">{selectedFair.title}</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {THEME_LABELS[selectedFair.theme] ?? selectedFair.theme}
                    {' · '}{fmtDateTime(selectedFair.startAt)} ~ {fmtDateTime(selectedFair.endAt)}
                    {' · '}{selectedFair.venue}
                    {selectedFair.address ? `(${selectedFair.address})` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    来源:{selectedFair.sourceName} · 外部编号 {selectedFair.externalId} · 同步于 {fmtDateTime(selectedFair.syncTime)}
                  </p>
                </div>
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <PencilIcon className="h-3.5 w-3.5" />
                  编辑基本信息
                </button>
              </div>

              {/* 标签页 */}
              <div className="mb-4 flex gap-1 border-b border-gray-200">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === key
                        ? 'border-b-2 border-primary-600 text-primary-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === 'companies' && <CompaniesTab fairId={selectedFair.id} companies={detail?.companies ?? []} onChanged={refresh} />}
              {activeTab === 'zones'     && <ZonesTab fairId={selectedFair.id} zones={detail?.zones ?? []} onChanged={refresh} />}
              {activeTab === 'materials' && <MaterialsTab fairId={selectedFair.id} materials={detail?.materials ?? []} onChanged={refresh} />}
              {activeTab === 'stats'     && <StatsTab stats={stats} />}

              <EditFairDrawer
                fair={selectedFair}
                open={editOpen}
                onClose={() => setEditOpen(false)}
                onSaved={refresh}
              />
            </>
          )}
        </>
      )}

      <p className="mt-6 text-xs text-gray-400">
        招聘会数字化模块:仅提供信息展示和现场服务,不接收简历,不参与招聘闭环。所有修改操作均记录审计日志。
      </p>
    </Page>
  )
}
