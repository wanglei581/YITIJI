import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { GiftIcon, RefreshCwIcon } from 'lucide-react'
import { Page } from '../Page'
import {
  benefitActivitiesAdminApi,
  type AdminBenefitActivityClaimItem,
  type AdminBenefitActivityItem,
  type AdminBenefitActivitySourceType,
  type AdminBenefitActivityStatus,
  type AdminBenefitActivityType,
  type UpsertBenefitActivityInput,
} from '../../services/api/benefitActivitiesAdmin'

const BENEFIT_TYPES: { value: AdminBenefitActivityType; label: string }[] = [
  { value: 'coupon', label: '优惠券' },
  { value: 'free_quota', label: '免费次数' },
  { value: 'package_entitlement', label: '服务额度' },
  { value: 'subsidy_eligibility_hint', label: '政策资格提示' },
]

const SOURCE_TYPES: { value: AdminBenefitActivitySourceType; label: string }[] = [
  { value: 'platform', label: '平台' },
  { value: 'campus', label: '校园' },
  { value: 'gov', label: '公共就业机构' },
  { value: 'fair', label: '招聘会服务' },
  { value: 'partner', label: '合作机构' },
]

const STATUS_LABEL: Record<AdminBenefitActivityStatus, string> = {
  draft: '草稿',
  published: '已发布',
  ended: '已下架',
}

const STATUS_CLASS: Record<AdminBenefitActivityStatus, string> = {
  draft: 'bg-gray-100 text-gray-500',
  published: 'bg-emerald-50 text-emerald-600',
  ended: 'bg-amber-50 text-amber-600',
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 16).replace('T', ' ')
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 16)
}

function defaultTitle(type: AdminBenefitActivityType): string {
  if (type === 'subsidy_eligibility_hint') return '政策资格提示活动'
  if (type === 'package_entitlement') return '求职服务额度活动'
  if (type === 'coupon') return '打印服务优惠券活动'
  return '免费打印次数活动'
}

const EMPTY_FORM = {
  title: defaultTitle('free_quota'),
  description: '',
  rulesText: '每个手机号限领一次。权益仅用于本终端服务与打印辅助。',
  benefitType: 'free_quota' as AdminBenefitActivityType,
  sourceType: 'platform' as AdminBenefitActivitySourceType,
  quantityTotal: '1',
  stockTotal: '',
  validFrom: '',
  validUntil: '',
  grantValidDays: '',
}

export default function BenefitActivitiesPage() {
  const [items, setItems] = useState<AdminBenefitActivityItem[]>([])
  const [claims, setClaims] = useState<AdminBenefitActivityClaimItem[]>([])
  const [selected, setSelected] = useState<AdminBenefitActivityItem | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [claimsState, setClaimsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const quantityEnabled = form.benefitType !== 'subsidy_eligibility_hint'
  const selectedEditable = !selected || selected.status === 'draft'

  const load = useCallback(() => {
    setState('loading')
    benefitActivitiesAdminApi.list()
      .then((res) => {
        setItems(res.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const selectedType = useMemo(() => BENEFIT_TYPES.find((type) => type.value === form.benefitType)!, [form.benefitType])

  const edit = (item: AdminBenefitActivityItem) => {
    setSelected(item)
    setForm({
      title: item.title,
      description: item.description ?? '',
      rulesText: item.rulesText ?? '',
      benefitType: item.benefitType,
      sourceType: item.sourceType,
      quantityTotal: item.quantityTotal === null ? '' : String(item.quantityTotal),
      stockTotal: item.stockTotal === null ? '' : String(item.stockTotal),
      validFrom: toLocalInput(item.validFrom),
      validUntil: toLocalInput(item.validUntil),
      grantValidDays: item.grantValidDays === null ? '' : String(item.grantValidDays),
    })
    void loadClaims(item.id)
  }

  const reset = () => {
    setSelected(null)
    setClaims([])
    setClaimsState('idle')
    setForm(EMPTY_FORM)
  }

  const loadClaims = async (id: string) => {
    setClaimsState('loading')
    try {
      const res = await benefitActivitiesAdminApi.claims(id)
      setClaims(res.items)
      setClaimsState('ready')
    } catch {
      setClaimsState('error')
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    const input: UpsertBenefitActivityInput = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      rulesText: form.rulesText.trim() || null,
      benefitType: form.benefitType,
      sourceType: form.sourceType,
      quantityTotal: quantityEnabled && form.quantityTotal ? Number(form.quantityTotal) : null,
      stockTotal: form.stockTotal ? Number(form.stockTotal) : null,
      validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
      validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
      grantValidDays: form.grantValidDays ? Number(form.grantValidDays) : null,
    }
    try {
      const saved = selected
        ? await benefitActivitiesAdminApi.update(selected.id, input)
        : await benefitActivitiesAdminApi.create(input)
      setMessage(selected ? '活动已保存' : '活动草稿已创建')
      setSelected(saved)
      await loadClaims(saved.id)
      load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    }
  }

  const publish = async (item: AdminBenefitActivityItem) => {
    if (!window.confirm('确认发布该权益活动？发布后前台可见。')) return
    try {
      const saved = await benefitActivitiesAdminApi.publish(item.id)
      setMessage('活动已发布')
      setSelected(saved)
      load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发布失败')
    }
  }

  const end = async (item: AdminBenefitActivityItem) => {
    if (!window.confirm('确认下架该权益活动？下架后前台不可领取。')) return
    try {
      const saved = await benefitActivitiesAdminApi.end(item.id)
      setMessage('活动已下架')
      setSelected(saved)
      load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '下架失败')
    }
  }

  return (
    <Page
      title="权益活动"
      subtitle="配置用户可领取的服务权益活动；领取后生成 BenefitGrant，进入用户「我的权益」"
      actions={
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCwIcon className="h-4 w-4" />
          刷新
        </button>
      }
    >
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
        权益活动只发放本终端服务权益、打印额度或政策信息提示；不接支付、不做套餐购买、不生成招聘会报名或签到凭证。
      </div>

      {message && <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">{message}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">活动列表</p>
            <button type="button" onClick={reset} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">
              新建活动
            </button>
          </div>
          {state === 'loading' && <LoadingState className="py-20" />}
          {state === 'error' && <ErrorState className="py-20" onRetry={load} />}
          {state === 'ready' && items.length === 0 && (
            <EmptyState icon={GiftIcon} title="暂无活动" description="创建草稿并发布后，前台权益活动中心可见" className="py-20" />
          )}
          {state === 'ready' && items.length > 0 && (
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <div key={item.id} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={['rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CLASS[item.status]].join(' ')}>
                          {STATUS_LABEL[item.status]}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">{item.sourceType}</span>
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">{item.benefitType}</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-gray-900">{item.title}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        库存 {item.stockRemaining ?? '不限'} / {item.stockTotal ?? '不限'} · 有效期 {fmt(item.validFrom)} - {fmt(item.validUntil)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => edit(item)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600">
                        查看
                      </button>
                      {item.status === 'draft' && (
                        <button type="button" onClick={() => void publish(item)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
                          发布
                        </button>
                      )}
                      {item.status === 'published' && (
                        <button type="button" onClick={() => void end(item)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">
                          下架
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">{selected ? '活动详情' : '新建活动'}</p>
            <form onSubmit={(event) => void submit(event)} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500">活动标题</label>
                <input
                  value={form.title}
                  onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
                  disabled={!selectedEditable}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                  maxLength={80}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">权益类型</label>
                  <select
                    value={form.benefitType}
                    disabled={!selectedEditable}
                    onChange={(event) => {
                      const next = event.target.value as AdminBenefitActivityType
                      setForm((f) => ({ ...f, benefitType: next, title: defaultTitle(next), quantityTotal: next === 'subsidy_eligibility_hint' ? '' : f.quantityTotal || '1' }))
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                  >
                    {BENEFIT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">活动来源</label>
                  <select
                    value={form.sourceType}
                    disabled={!selectedEditable}
                    onChange={(event) => setForm((f) => ({ ...f, sourceType: event.target.value as AdminBenefitActivitySourceType }))}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                  >
                    {SOURCE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">活动说明</label>
                <textarea
                  value={form.description}
                  disabled={!selectedEditable}
                  onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
                  className="mt-1 min-h-[72px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                  maxLength={500}
                  placeholder={form.benefitType === 'subsidy_eligibility_hint' ? '仅填写官方入口、材料清单、资格提示等 info-only 文案' : '填写权益使用范围和现场规则'}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">领取规则</label>
                <textarea
                  value={form.rulesText}
                  disabled={!selectedEditable}
                  onChange={(event) => setForm((f) => ({ ...f, rulesText: event.target.value }))}
                  className="mt-1 min-h-[72px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50"
                  maxLength={1000}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">权益额度</label>
                  <input
                    value={form.quantityTotal}
                    disabled={!selectedEditable || !quantityEnabled}
                    onChange={(event) => setForm((f) => ({ ...f, quantityTotal: event.target.value }))}
                    type="number"
                    min={1}
                    max={9999}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">总库存</label>
                  <input
                    value={form.stockTotal}
                    disabled={!selectedEditable}
                    onChange={(event) => setForm((f) => ({ ...f, stockTotal: event.target.value }))}
                    type="number"
                    min={1}
                    max={999999}
                    placeholder="不限"
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">开始时间</label>
                  <input value={form.validFrom} disabled={!selectedEditable} onChange={(event) => setForm((f) => ({ ...f, validFrom: event.target.value }))} type="datetime-local" className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">结束时间</label>
                  <input value={form.validUntil} disabled={!selectedEditable} onChange={(event) => setForm((f) => ({ ...f, validUntil: event.target.value }))} type="datetime-local" className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">领取后有效天数</label>
                <input value={form.grantValidDays} disabled={!selectedEditable} onChange={(event) => setForm((f) => ({ ...f, grantValidDays: event.target.value }))} type="number" min={1} max={3650} placeholder="默认跟随活动结束时间" className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50" />
              </div>
              <button
                type="submit"
                disabled={!selectedEditable}
                className="h-11 w-full rounded-lg bg-primary-600 text-sm font-semibold text-white disabled:bg-gray-300"
              >
                {selected ? `保存${selectedType.label}活动` : '创建草稿'}
              </button>
            </form>
          </Card>

          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">领取记录</p>
            {!selected && <EmptyState icon={GiftIcon} title="未选择活动" description="选择活动后查看领取记录" className="py-12" />}
            {selected && claimsState === 'loading' && <LoadingState className="py-12" />}
            {selected && claimsState === 'error' && <ErrorState className="py-12" onRetry={() => void loadClaims(selected.id)} />}
            {selected && claimsState === 'ready' && claims.length === 0 && <EmptyState icon={GiftIcon} title="暂无领取记录" description="用户领取后会在这里显示脱敏流水" className="py-12" />}
            {selected && claimsState === 'ready' && claims.length > 0 && (
              <div className="flex flex-col gap-2">
                {claims.map((claim) => (
                  <div key={claim.id} className="rounded-lg border border-gray-100 p-3 text-xs text-gray-500">
                    <p className="font-semibold text-gray-900">{claim.phoneMasked}</p>
                    <p className="mt-1">权益 {claim.benefitGrantId} · {claim.grantStatus}</p>
                    <p className="mt-1">领取时间 {fmt(claim.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  )
}
