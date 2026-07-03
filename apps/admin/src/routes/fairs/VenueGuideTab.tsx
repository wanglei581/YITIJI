import { useCallback, useEffect, useState } from 'react'
import { Card, Drawer, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { FairVenueFacilityType, SaveFairVenueGuideInput, SaveVenueHallInput, SaveVenueFacilityInput } from '@ai-job-print/shared'
import { DoorOpenIcon, InfoIcon, MapIcon, MessageCircleQuestionIcon, PlusIcon, PrinterIcon, Trash2Icon } from 'lucide-react'
import { fairsAdminService, type FairCompanyView } from '../../services/api/fairsAdmin'

// ============================================================
// 场馆导览配置 Tab(Admin):展厅(A/B/C 厅) / 企业展位绑定 / 设施点位。
// 整体 PUT 保存(服务端事务性替换);企业只能从本招聘会参展企业中选择。
// 合规:仅会场位置导览与信息展示,不涉及任何投递/收简历闭环。
// ============================================================

const FACILITY_TYPES: { value: FairVenueFacilityType; label: string; icon: React.ElementType }[] = [
  { value: 'entrance', label: '入口', icon: DoorOpenIcon },
  { value: 'serviceDesk', label: '服务台', icon: InfoIcon },
  { value: 'printPoint', label: '打印服务点', icon: PrinterIcon },
  { value: 'consulting', label: '咨询区', icon: MessageCircleQuestionIcon },
]

const HALL_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500', 'bg-cyan-600', 'bg-rose-500']

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}

/** 两步确认删除按钮(防误删展厅/解绑企业)。 */
function TwoStepDelete({ onConfirm, label = '' }: { onConfirm: () => void; label?: string }) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), 5000)
    return () => clearTimeout(t)
  }, [arming])
  return (
    <button
      type="button"
      onClick={() => { if (arming) { setArming(false); onConfirm() } else setArming(true) }}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
        arming ? 'bg-red-600 text-white hover:bg-red-700' : 'text-red-500 hover:bg-red-50'
      }`}
    >
      {arming ? '确认删除?' : <><Trash2Icon className="h-3.5 w-3.5" />{label}</>}
    </button>
  )
}

const EMPTY_HALL: SaveVenueHallInput = { hallCode: '', hallName: '', industryCategory: '', description: '', boothRange: '', companies: [] }

export function VenueGuideTab({
  fairId,
  venueDefault,
  companies,
}: {
  fairId: string
  venueDefault: string
  companies: FairCompanyView[]
}) {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  /** null = 尚未配置(空态);非 null = 编辑中的配置 */
  const [draft, setDraft] = useState<SaveFairVenueGuideInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [editingHall, setEditingHall] = useState<number | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const { data } = await fairsAdminService.getVenueGuide(fairId)
      setDraft(data ? {
        venueName: data.venueName,
        halls: data.halls.map((h) => ({
          hallCode: h.hallCode,
          hallName: h.hallName,
          industryCategory: h.industryCategory ?? '',
          description: h.description ?? '',
          boothRange: h.boothRange ?? '',
          companies: h.companies.map((c, j) => ({ fairCompanyId: c.companyId, boothNo: c.boothNo ?? '', sortOrder: j })),
        })),
        facilities: data.facilities.map((f, i) => ({
          type: f.type, name: f.name, locationLabel: f.locationLabel ?? '', relatedHallCode: f.relatedHallCode ?? '', sortOrder: i,
        })),
      } : null)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [fairId])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    // 基础校验
    for (const h of draft.halls) {
      if (!h.hallCode.trim() || !h.hallName.trim()) {
        setError('每个展厅必须填写展厅编码和名称')
        return
      }
    }
    const codes = draft.halls.map((h) => h.hallCode.trim().toUpperCase())
    if (new Set(codes).size !== codes.length) {
      setError('展厅编码不能重复')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await fairsAdminService.saveVenueGuide(fairId, {
        venueName: draft.venueName.trim(),
        halls: draft.halls.map((h, i) => ({
          hallCode: h.hallCode.trim().toUpperCase(),
          hallName: h.hallName.trim(),
          industryCategory: h.industryCategory?.trim() || undefined,
          description: h.description?.trim() || undefined,
          boothRange: h.boothRange?.trim() || undefined,
          sortOrder: i,
          companies: h.companies.map((c, j) => ({ fairCompanyId: c.fairCompanyId, boothNo: c.boothNo?.trim() || undefined, sortOrder: j })),
        })),
        facilities: draft.facilities.map((f, i) => ({
          type: f.type,
          name: f.name.trim(),
          locationLabel: f.locationLabel?.trim() || undefined,
          relatedHallCode: f.relatedHallCode?.trim().toUpperCase() || undefined,
          sortOrder: i,
        })),
      })
      setSavedAt(Date.now())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败,请重试')
    } finally {
      setSaving(false)
    }
  }

  const removeGuide = async () => {
    setSaving(true)
    setError(null)
    try {
      await fairsAdminService.deleteVenueGuide(fairId)
      setDraft(null)
      setSavedAt(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败,请重试')
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') return <LoadingState className="py-16" />
  if (state === 'error') return <ErrorState className="py-16" onRetry={() => void load()} />

  // ── 空态:尚未配置 ──────────────────────────────────────────────────────────
  if (!draft) {
    return (
      <Card className="flex flex-col items-center gap-4 py-14 text-center">
        <MapIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
        <div>
          <p className="text-base font-semibold text-neutral-700">该招聘会尚未配置场馆导览</p>
          <p className="mt-1 text-xs text-neutral-400">配置展厅布局、企业展位与设施点位后,一体机详情页将显示「场馆导览」</p>
        </div>
        <button
          onClick={() => setDraft({ venueName: venueDefault, halls: [{ ...EMPTY_HALL, hallCode: 'A', hallName: 'A 厅' }], facilities: [] })}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          开始配置
        </button>
      </Card>
    )
  }

  const hall = editingHall !== null ? draft.halls[editingHall] : null
  const boundElsewhere = (companyId: string, exceptHall: number) =>
    draft.halls.some((h, i) => i !== exceptHall && h.companies.some((c) => c.fairCompanyId === companyId))

  return (
    <div className="space-y-4">
      {/* 预览条:A/B/C 厅 + 企业数 */}
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium text-neutral-700">布局预览</p>
        <div className="flex flex-wrap items-end gap-3">
          {draft.halls.length === 0 ? (
            <p className="text-xs text-neutral-400">暂无展厅,点击下方「添加展厅」</p>
          ) : (
            draft.halls.map((h, i) => (
              <div key={i} className="text-center">
                <div className={`flex h-16 w-24 flex-col items-center justify-center rounded-xl text-white shadow-sm ${HALL_COLORS[i % HALL_COLORS.length]}`}>
                  <p className="text-lg font-bold">{h.hallCode.toUpperCase() || '?'}</p>
                  <p className="text-[10px] opacity-90">{h.companies.length} 家企业</p>
                </div>
                <p className="mt-1 max-w-24 truncate text-[10px] text-neutral-500">{h.industryCategory || h.hallName}</p>
              </div>
            ))
          )}
          {draft.facilities.length > 0 && (
            <div className="ml-2 flex flex-wrap gap-1.5 self-center">
              {draft.facilities.map((f, i) => {
                const meta = FACILITY_TYPES.find((t) => t.value === f.type)
                const Icon = meta?.icon ?? InfoIcon
                return (
                  <span key={i} className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600">
                    <Icon className="h-3 w-3" />{f.name}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <Field label="场馆名称" required>
          <input className={inputCls} value={draft.venueName} onChange={(e) => setDraft((d) => d ? { ...d, venueName: e.target.value } : d)} />
        </Field>
      </Card>

      {/* 展厅列表 */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-700">展厅({draft.halls.length})</p>
        <button
          onClick={() => {
            const nextCode = String.fromCharCode(65 + draft.halls.length) // A,B,C...
            setDraft((d) => d ? { ...d, halls: [...d.halls, { ...EMPTY_HALL, hallCode: nextCode, hallName: `${nextCode} 厅` }] } : d)
            setEditingHall(draft.halls.length)
          }}
          className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          添加展厅
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {draft.halls.map((h, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white ${HALL_COLORS[i % HALL_COLORS.length]}`}>
                  {h.hallCode.toUpperCase() || '?'}
                </span>
                <div>
                  <p className="text-sm font-semibold text-neutral-800">{h.hallName || '(未命名)'}</p>
                  <p className="text-xs text-neutral-400">{h.industryCategory || '未设置行业'} · {h.companies.length} 家企业{h.boothRange ? ` · ${h.boothRange}` : ''}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => setEditingHall(i)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">编辑</button>
                <TwoStepDelete onConfirm={() => setDraft((d) => d ? { ...d, halls: d.halls.filter((_, idx) => idx !== i) } : d)} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* 设施点位 */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-neutral-700">设施点位({draft.facilities.length})</p>
        <button
          onClick={() => setDraft((d) => d ? { ...d, facilities: [...d.facilities, { type: 'entrance', name: '入口', locationLabel: '', relatedHallCode: '' } as SaveVenueFacilityInput] } : d)}
          className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          添加设施
        </button>
      </div>
      <Card className="divide-y divide-neutral-100 p-0">
        {draft.facilities.length === 0 && (
          <p className="py-6 text-center text-xs text-neutral-400">暂无设施点位(入口/服务台/打印点/咨询区)</p>
        )}
        {draft.facilities.map((f, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[140px_1fr_1fr_90px_auto] md:items-center">
            <select
              className={inputCls}
              value={f.type}
              onChange={(e) => setDraft((d) => d ? { ...d, facilities: d.facilities.map((x, idx) => idx === i ? { ...x, type: e.target.value as FairVenueFacilityType } : x) } : d)}
            >
              {FACILITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input className={inputCls} placeholder="名称,如 主入口" value={f.name} onChange={(e) => setDraft((d) => d ? { ...d, facilities: d.facilities.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x) } : d)} />
            <input className={inputCls} placeholder="位置说明,如 南门入口" value={f.locationLabel ?? ''} onChange={(e) => setDraft((d) => d ? { ...d, facilities: d.facilities.map((x, idx) => idx === i ? { ...x, locationLabel: e.target.value } : x) } : d)} />
            <input className={inputCls} placeholder="关联厅" value={f.relatedHallCode ?? ''} onChange={(e) => setDraft((d) => d ? { ...d, facilities: d.facilities.map((x, idx) => idx === i ? { ...x, relatedHallCode: e.target.value } : x) } : d)} />
            <TwoStepDelete onConfirm={() => setDraft((d) => d ? { ...d, facilities: d.facilities.filter((_, idx) => idx !== i) } : d)} />
          </div>
        ))}
      </Card>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {savedAt && !error && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">已保存,一体机刷新后即可看到最新导览。</p>}

      <div className="flex items-center justify-between">
        <TwoStepDelete label="删除整个导览配置" onConfirm={() => void removeGuide()} />
        <button
          onClick={() => void save()}
          disabled={saving || !draft.venueName.trim()}
          className="rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存导览配置'}
        </button>
      </div>

      <p className="text-xs text-neutral-400">
        合规说明:场馆导览仅用于会场位置与展区信息展示;企业绑定来自本招聘会参展企业,系统不接收求职者简历,不参与招聘闭环。
      </p>

      {/* 展厅编辑抽屉 */}
      <Drawer
        open={editingHall !== null && hall !== null}
        onClose={() => setEditingHall(null)}
        title={`编辑展厅 ${hall?.hallCode.toUpperCase() ?? ''}`}
        size="md"
        footer={
          <div className="flex justify-end">
            <button onClick={() => setEditingHall(null)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">完成</button>
          </div>
        }
      >
        {hall && editingHall !== null && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="展厅编码(A/B/C)" required>
                <input
                  className={inputCls} maxLength={4} value={hall.hallCode}
                  onChange={(e) => setDraft((d) => d ? { ...d, halls: d.halls.map((x, idx) => idx === editingHall ? { ...x, hallCode: e.target.value.replace(/[^A-Za-z0-9]/g, '') } : x) } : d)}
                />
              </Field>
              <Field label="展厅名称" required>
                <input
                  className={inputCls} value={hall.hallName}
                  onChange={(e) => setDraft((d) => d ? { ...d, halls: d.halls.map((x, idx) => idx === editingHall ? { ...x, hallName: e.target.value } : x) } : d)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="行业类别">
                <input
                  className={inputCls} placeholder="如 互联网与人工智能" value={hall.industryCategory ?? ''}
                  onChange={(e) => setDraft((d) => d ? { ...d, halls: d.halls.map((x, idx) => idx === editingHall ? { ...x, industryCategory: e.target.value } : x) } : d)}
                />
              </Field>
              <Field label="展位范围">
                <input
                  className={inputCls} placeholder="如 A01-A30" value={hall.boothRange ?? ''}
                  onChange={(e) => setDraft((d) => d ? { ...d, halls: d.halls.map((x, idx) => idx === editingHall ? { ...x, boothRange: e.target.value } : x) } : d)}
                />
              </Field>
            </div>
            <Field label="展区说明">
              <textarea
                className={`${inputCls} h-16 resize-none`} value={hall.description ?? ''}
                onChange={(e) => setDraft((d) => d ? { ...d, halls: d.halls.map((x, idx) => idx === editingHall ? { ...x, description: e.target.value } : x) } : d)}
              />
            </Field>

            {/* 企业绑定:只能选本招聘会参展企业 */}
            <div>
              <p className="mb-2 text-xs font-medium text-neutral-600">绑定参展企业({hall.companies.length})</p>
              <div className="space-y-2">
                {hall.companies.map((b, j) => {
                  const company = companies.find((c) => c.id === b.fairCompanyId)
                  return (
                    <div key={j} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-neutral-800">{company?.name ?? b.fairCompanyId}</p>
                      <input
                        className="w-24 rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
                        placeholder="展位号" maxLength={20} value={b.boothNo ?? ''}
                        onChange={(e) => setDraft((d) => d ? {
                          ...d,
                          halls: d.halls.map((x, idx) => idx === editingHall ? {
                            ...x, companies: x.companies.map((y, jdx) => jdx === j ? { ...y, boothNo: e.target.value } : y),
                          } : x),
                        } : d)}
                      />
                      <TwoStepDelete onConfirm={() => setDraft((d) => d ? {
                        ...d,
                        halls: d.halls.map((x, idx) => idx === editingHall ? { ...x, companies: x.companies.filter((_, jdx) => jdx !== j) } : x),
                      } : d)} />
                    </div>
                  )
                })}
              </div>
              <select
                className={`${inputCls} mt-2`}
                value=""
                onChange={(e) => {
                  const id = e.target.value
                  if (!id) return
                  setDraft((d) => d ? {
                    ...d,
                    halls: d.halls.map((x, idx) => idx === editingHall ? { ...x, companies: [...x.companies, { fairCompanyId: id, boothNo: '' }] } : x),
                  } : d)
                }}
              >
                <option value="">+ 从本招聘会参展企业中添加…</option>
                {/* 同一企业只能绑定一个展厅(服务端硬校验 COMPANY_BOUND_MULTIPLE),已绑其它展厅的不在候选中 */}
                {companies
                  .filter((c) => !hall.companies.some((b) => b.fairCompanyId === c.id) && !boundElsewhere(c.id, editingHall))
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
              {companies.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">本招聘会还没有参展企业,请先在「参展企业」标签页录入。</p>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
