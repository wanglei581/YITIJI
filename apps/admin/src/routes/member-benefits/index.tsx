import { FormEvent, useCallback, useMemo, useState } from 'react'
import { Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { GiftIcon, RefreshCwIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react'
import { Page } from '../Page'
import {
  memberBenefitsAdminApi,
  type AdminBenefitGrantItem,
  type AdminBenefitSourceType,
  type AdminBenefitType,
  type AdminEndUserSearchItem,
} from '../../services/api/memberBenefitsAdmin'

const BENEFIT_TYPES: { value: AdminBenefitType; label: string; desc: string }[] = [
  { value: 'coupon', label: '优惠券', desc: '用于打印或服务优惠' },
  { value: 'free_quota', label: '免费次数', desc: '用于免费打印/服务次数' },
  { value: 'package_entitlement', label: '服务额度', desc: '仅代表工具服务额度' },
  { value: 'subsidy_eligibility_hint', label: '政策资格提示', desc: '仅作官方入口与材料指引' },
]

const SOURCE_TYPES: { value: AdminBenefitSourceType; label: string }[] = [
  { value: 'platform', label: '平台' },
  { value: 'campus', label: '校园' },
  { value: 'gov', label: '公共就业机构' },
  { value: 'fair', label: '招聘会现场' },
  { value: 'partner', label: '合作机构' },
]

const STATUS_LABEL: Record<AdminBenefitGrantItem['status'], string> = {
  active: '可用',
  used_up: '已用完',
  expired: '已过期',
  revoked: '已撤销',
}

const STATUS_CLASS: Record<AdminBenefitGrantItem['status'], string> = {
  active: 'bg-emerald-50 text-emerald-600',
  used_up: 'bg-gray-100 text-gray-500',
  expired: 'bg-amber-50 text-amber-600',
  revoked: 'bg-rose-50 text-rose-600',
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 16).replace('T', ' ')
}

function defaultTitle(type: AdminBenefitType): string {
  if (type === 'free_quota') return '免费打印次数'
  if (type === 'package_entitlement') return '求职服务额度'
  if (type === 'subsidy_eligibility_hint') return '政策资格提示'
  return '打印服务优惠券'
}

export default function MemberBenefitsPage() {
  const [phone, setPhone] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminEndUserSearchItem | null>(null)
  const [items, setItems] = useState<AdminBenefitGrantItem[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [benefitType, setBenefitType] = useState<AdminBenefitType>('free_quota')
  const [sourceType, setSourceType] = useState<AdminBenefitSourceType>('platform')
  const [title, setTitle] = useState(defaultTitle('free_quota'))
  const [description, setDescription] = useState('')
  const [quantityTotal, setQuantityTotal] = useState('1')
  const [validUntil, setValidUntil] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const selectedType = useMemo(() => BENEFIT_TYPES.find((t) => t.value === benefitType)!, [benefitType])
  const quantityEnabled = benefitType !== 'subsidy_eligibility_hint'

  const loadItems = useCallback(async (userId: string) => {
    setState('loading')
    try {
      const res = await memberBenefitsAdminApi.list(userId)
      setItems(res.items)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  const search = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    setSelectedUser(null)
    setItems([])
    const normalized = phone.trim()
    if (!/^1[3-9]\d{9}$/.test(normalized)) {
      setMessage('请输入 11 位中国大陆手机号')
      return
    }
    setState('loading')
    try {
      const res = await memberBenefitsAdminApi.searchUsers(normalized)
      const user = res.items[0] ?? null
      setSelectedUser(user)
      if (!user) {
        setState('ready')
        setMessage('未找到该手机号对应的会员账号')
        return
      }
      await loadItems(user.endUserId)
    } catch {
      setState('error')
    }
  }

  const submitGrant = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedUser) return
    setSubmitting(true)
    setMessage(null)
    try {
      await memberBenefitsAdminApi.grant({
        endUserId: selectedUser.endUserId,
        benefitType,
        sourceType,
        title: title.trim() || defaultTitle(benefitType),
        description: description.trim() || null,
        quantityTotal: quantityEnabled ? Number(quantityTotal || 1) : null,
        validFrom: null,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      })
      setMessage('权益已发放')
      await loadItems(selectedUser.endUserId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发放失败')
    } finally {
      setSubmitting(false)
    }
  }

  const revoke = async (item: AdminBenefitGrantItem) => {
    if (!selectedUser || item.status !== 'active') return
    const reason = window.prompt('请输入撤销原因（不会写入用户前台，仅用于审计）')?.trim()
    if (!reason) return
    setMessage(null)
    try {
      await memberBenefitsAdminApi.revoke(item.id, reason)
      setMessage('权益已撤销')
      await loadItems(selectedUser.endUserId)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销失败')
    }
  }

  const handleTypeChange = (next: AdminBenefitType) => {
    setBenefitType(next)
    setTitle(defaultTitle(next))
    if (next === 'subsidy_eligibility_hint') setQuantityTotal('')
    else if (!quantityTotal) setQuantityTotal('1')
  }

  return (
    <Page
      title="会员权益"
      subtitle="按手机号精确定位会员，手动发放或撤销权益"
      actions={
        selectedUser && (
          <button
            type="button"
            onClick={() => void loadItems(selectedUser.endUserId)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <RefreshCwIcon className="h-4 w-4" />
            刷新
          </button>
        )
      }
    >
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
        权益只代表本终端服务与打印辅助。政策资格提示只作官方入口与材料指引，不代办、不承诺办理结果；页面不展示明文手机号。
      </div>

      <form onSubmit={(event) => void search(event)} className="mb-4 flex gap-3">
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="输入会员手机号精确搜索"
          className="h-11 w-80 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-primary-500"
        />
        <button type="submit" className="flex h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white">
          <SearchIcon className="h-4 w-4" />
          搜索会员
        </button>
      </form>

      {message && (
        <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">{message}</div>
      )}

      {selectedUser && (
        <div className="mb-4 grid gap-4 xl:grid-cols-[360px_1fr]">
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                <ShieldCheckIcon className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{selectedUser.phoneMasked}</p>
                <p className="mt-0.5 text-xs text-gray-500">{selectedUser.nickname ?? '未设置昵称'} · {selectedUser.enabled ? '账号启用' : '账号停用'}</p>
              </div>
            </div>

            <form onSubmit={(event) => void submitGrant(event)} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500">权益类型</label>
                <select
                  value={benefitType}
                  onChange={(event) => handleTypeChange(event.target.value as AdminBenefitType)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                >
                  {BENEFIT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label} · {type.desc}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">来源</label>
                <select
                  value={sourceType}
                  onChange={(event) => setSourceType(event.target.value as AdminBenefitSourceType)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                >
                  {SOURCE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">标题</label>
                <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" maxLength={80} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">说明</label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="mt-1 min-h-[84px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  maxLength={500}
                  placeholder={benefitType === 'subsidy_eligibility_hint' ? '仅填写官方入口、材料清单、资格提示等 info-only 文案' : '填写使用范围和现场规则'}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">额度</label>
                  <input
                    value={quantityTotal}
                    onChange={(event) => setQuantityTotal(event.target.value)}
                    disabled={!quantityEnabled}
                    type="number"
                    min={1}
                    max={9999}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm disabled:bg-gray-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">有效期至</label>
                  <input value={validUntil} onChange={(event) => setValidUntil(event.target.value)} type="datetime-local" className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm" />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting || !selectedUser.enabled}
                className="h-11 w-full rounded-lg bg-primary-600 text-sm font-semibold text-white disabled:bg-gray-300"
              >
                {submitting ? '发放中…' : `发放${selectedType.label}`}
              </button>
            </form>
          </Card>

          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold text-gray-900">权益记录</p>
            {state === 'loading' && <LoadingState className="py-16" />}
            {state === 'error' && <ErrorState className="py-16" onRetry={() => selectedUser && void loadItems(selectedUser.endUserId)} />}
            {state === 'ready' && items.length === 0 && (
              <EmptyState icon={GiftIcon} title="暂无权益" description="发放后会在这里显示记录，并同步到用户「我的权益」" className="py-16" />
            )}
            {state === 'ready' && items.length > 0 && (
              <div className="flex flex-col gap-3">
                {items.map((item) => (
                  <div key={item.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                        <p className="mt-1 text-xs text-gray-400">{item.phoneMasked} · {item.sourceType} · 创建于 {fmt(item.createdAt)}</p>
                      </div>
                      <span className={['shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', STATUS_CLASS[item.status]].join(' ')}>
                        {STATUS_LABEL[item.status]}
                      </span>
                    </div>
                    {item.description && <p className="mt-2 text-xs leading-relaxed text-gray-500">{item.description}</p>}
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-xs text-gray-400">
                        额度 {item.quantityRemaining ?? '—'} / {item.quantityTotal ?? '—'} · 有效期至 {fmt(item.validUntil)}
                      </p>
                      <button
                        type="button"
                        disabled={item.status !== 'active'}
                        onClick={() => void revoke(item)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:cursor-not-allowed disabled:text-gray-300"
                      >
                        撤销
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {!selectedUser && state === 'idle' && (
        <EmptyState icon={GiftIcon} title="先搜索会员" description="输入手机号精确定位会员后，再发放或查看权益记录" className="py-20" />
      )}
    </Page>
  )
}
