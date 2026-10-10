// ============================================================
// 机构详情抽屉里的「官方域名（入驻核验）」（3.14）。
//
// 登记依据是机构入驻时提交的盖章确认函 —— 这是**机构身份核验，不是内容审核**：
// 登记之后，机构只能把官方渠道链接设在这些域名（含子域名）下，渠道内容由机构自己负责。
// 保存是整体替换（PUT，最多 10 个），先过「检查并保存」看清新增 / 移除，再确认替换。
// 只按服务端返回说话：保存成功才回到查看态并写「已保存」；被拒时留在编辑态、原样写出服务端原因。
// 与招聘内容托管开关无关，两种部署行为一样。
// 不做：不新建路由、不新建页面。控件嵌在既有「合作机构 → 机构详情」抽屉里。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { StatusBadge } from '@ai-job-print/ui'
import { GlobeIcon, PlusIcon, XIcon } from 'lucide-react'
import { getUser } from '../../services/auth'
import { userMessageOf } from '../../services/api/userErrorMessage'
import type { AuditLogRecord } from '../../services/api/audit'
import { orgOfficialChannelsService, type VerifiedOfficialDomain } from '../../services/api/orgOfficialChannels'
import { auditActorText } from '../audit/auditPresentation'
import {
  OFFICIAL_DOMAIN_MAX,
  diffDomains,
  domainRowHint,
  reviewDomainDraft,
} from './officialDomainRules'

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 font-mono text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-50'

function DomainChips({ label, domains, tone }: { label: string; domains: string[]; tone: 'add' | 'remove' | 'keep' }) {
  if (domains.length === 0) return null
  const cls = tone === 'add'
    ? 'bg-success-bg text-success-fg'
    : tone === 'remove' ? 'bg-error-bg text-error-fg line-through' : 'bg-neutral-100 text-neutral-600'
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="w-16 shrink-0 text-neutral-500">{label}</span>
      {domains.map((domain) => (
        <span key={domain} className={`rounded px-2 py-0.5 font-mono ${cls}`}>{domain}</span>
      ))}
    </div>
  )
}

export function OrgVerifiedDomainsPanel({
  orgId,
  onDomainsChange,
}: {
  orgId: string
  /** 把服务端当前登记的域名交给同一抽屉里的官方渠道小节（用来提示链接是否还在范围内）。 */
  onDomainsChange?: (domains: string[] | null) => void
}) {
  const [items, setItems] = useState<VerifiedOfficialDomain[]>([])
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view')
  const [draft, setDraft] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const isAdmin = getUser()?.role === 'admin'
  // 回调放进 ref：父组件传内联函数时也不会让 load 每次渲染都变、反复重读。
  const notifyRef = useRef(onDomainsChange)
  useEffect(() => { notifyRef.current = onDomainsChange })

  const load = useCallback(async () => {
    setState('loading')
    notifyRef.current?.(null)
    try {
      const list = await orgOfficialChannelsService.listVerifiedDomains(orgId)
      setItems(list)
      setState('ready')
      notifyRef.current?.(list.map((item) => item.domain))
    } catch (e) {
      setLoadError(userMessageOf(e, '请稍后重试'))
      setState('error')
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const current = items.map((item) => item.domain)
  const review = reviewDomainDraft(draft)
  const diff = diffDomains(current, review.domains)
  const unchanged = diff.added.length === 0 && diff.removed.length === 0

  const startEdit = () => {
    setDraft(current.length > 0 ? [...current] : [''])
    setError(null)
    setSaved(null)
    setMode('edit')
  }

  const confirmReplace = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await orgOfficialChannelsService.replaceVerifiedDomains(orgId, review.domains)
      setItems(next)
      setMode('view')
      setSaved(`已保存：服务端现在登记了 ${next.length} 个官方域名（新增 ${diff.added.length} 个，移除 ${diff.removed.length} 个）。`)
      notifyRef.current?.(next.map((item) => item.domain))
    } catch (e) {
      setError(userMessageOf(e, '保存没有成功，官方域名未改变，请稍后重试'))
      setMode('edit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="官方域名（入驻核验）" className="space-y-3 rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center gap-2">
        <GlobeIcon className="h-4 w-4 text-neutral-500" aria-hidden="true" />
        <p className="text-sm font-semibold text-neutral-800">官方域名（入驻核验）</p>
        {state === 'ready' && <StatusBadge status={items.length > 0 ? 'success' : 'warning'} label={`已登记 ${items.length} 个`} />}
        {state === 'ready' && mode === 'view' && isAdmin && (
          <button
            type="button"
            onClick={startEdit}
            className="ml-auto rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
          >
            编辑域名
          </button>
        )}
      </div>

      <p className="rounded bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-600">
        {'依据机构入驻时提交的盖章确认函，登记它的官方网站域名。'}
        <strong>这是机构身份核验，不是内容审核</strong>
        {'：登记之后，机构只能把「本机构官方渠道」的链接设在这些域名或其子域名下，渠道内容由机构自己负责。'}
      </p>

      {state === 'loading' && <p className="text-xs text-neutral-400">读取中…</p>}
      {state === 'error' && (
        <p className="text-xs text-error-fg" role="alert">
          官方域名没有读到：{loadError}
          <button type="button" onClick={() => void load()} className="ml-1 underline">重试</button>
        </p>
      )}

      {state === 'ready' && mode === 'view' && (
        <>
          {items.length === 0 ? (
            <p className="rounded border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg">
              尚未登记官方域名。登记之前，这家机构不能添加官方渠道。
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 rounded border border-neutral-100" aria-label="已登记的官方域名">
              {items.map((item) => (
                <li key={item.domain} className="px-3 py-2">
                  <span className="block font-mono text-sm text-neutral-800">{item.domain}</span>
                  <span className="mt-0.5 block text-[11px] text-neutral-500">
                    登记于 {formatDateTime(item.verifiedAt)} · 登记人 <span title={item.verifiedBy}>{auditActorText({ actorRole: 'admin', actorId: item.verifiedBy } as AuditLogRecord)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {saved && <p className="text-xs text-success-fg" role="status">{saved}</p>}
          {!isAdmin && (
            <p className="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              当前账号不是管理员，只能查看。登记官方域名是管理员职责，服务端对该端点限定 admin 角色。
            </p>
          )}
        </>
      )}

      {state === 'ready' && mode === 'edit' && (
        <div className="space-y-2 border-t border-neutral-100 pt-3">
          <p className="text-xs leading-relaxed text-neutral-600">
            {'只填域名本身，不要带 https:// 或路径。'}
            <strong>优先登记本机构自己的子域名</strong>
            {'（如 '}<span className="font-mono">hrss.qingdao.gov.cn</span>
            {'），不要登记整个城市的政府域名（如 '}<span className="font-mono">qingdao.gov.cn</span>
            {`）—— 那会放行该市所有部门的网站。最多 ${OFFICIAL_DOMAIN_MAX} 个；保存会整体替换现有列表。`}
          </p>
          {error && <p className="rounded bg-error-bg px-3 py-2 text-xs text-error-fg" role="alert">没有保存：{error}</p>}
          <ol className="space-y-2">
            {draft.map((value, index) => {
              const hint = domainRowHint(review.rows[index]!)
              return (
                <li key={index}>
                  <div className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-neutral-400">{index + 1}</span>
                    <input
                      aria-label={`官方域名 ${index + 1}`}
                      className={inputCls}
                      value={value}
                      placeholder="例如 hrss.qingdao.gov.cn"
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => setDraft((rows) => rows.map((row, i) => (i === index ? e.target.value : row)))}
                    />
                    <button
                      type="button"
                      aria-label={`移除第 ${index + 1} 个域名`}
                      onClick={() => setDraft((rows) => rows.filter((_, i) => i !== index))}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-error-fg"
                    >
                      <XIcon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {hint && (
                    <p className={`ml-7 mt-1 text-[11px] ${hint.tone === 'warn' ? 'text-warning-fg' : 'text-neutral-500'}`}>{hint.text}</p>
                  )}
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            onClick={() => setDraft((rows) => [...rows, ''])}
            disabled={draft.length >= OFFICIAL_DOMAIN_MAX}
            className="ml-7 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            添加一个域名
          </button>
          {draft.length === 0 && (
            <p className="ml-7 text-xs text-warning-fg">当前列表为空：保存后这家机构将没有任何已登记的官方域名。</p>
          )}
          {review.tooMany && <p className="ml-7 text-xs text-warning-fg">最多登记 {OFFICIAL_DOMAIN_MAX} 个官方域名。</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setMode('view'); setError(null) }}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            >
              取消编辑
            </button>
            <button
              type="button"
              onClick={() => { setError(null); setMode('confirm') }}
              disabled={review.blocked}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              检查并保存
            </button>
          </div>
        </div>
      )}

      {state === 'ready' && mode === 'confirm' && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-bg/40 p-3" role="group" aria-label="确认替换官方域名">
          <p className="text-sm font-semibold text-neutral-800">确认替换官方域名列表</p>
          {unchanged ? (
            <p className="text-xs text-neutral-600">与当前登记的完全相同，不需要保存。</p>
          ) : (
            <>
              <DomainChips label="将新增" domains={diff.added} tone="add" />
              <DomainChips label="将移除" domains={diff.removed} tone="remove" />
              <DomainChips label="保持不变" domains={diff.kept} tone="keep" />
              {diff.removed.length > 0 && (
                <p className="text-xs leading-relaxed text-warning-fg">
                  移除后，这家机构链接落在被移除域名下的官方渠道不再在终端显示，机构也不能再启用它们，直到改成仍登记的域名。
                </p>
              )}
              <p className="text-xs text-neutral-500">替换会写入审计日志，依据记为「机构身份核验」。</p>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode('edit')}
              disabled={saving}
              className="rounded-lg border border-neutral-200 bg-surface px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              返回修改
            </button>
            <button
              type="button"
              onClick={() => void confirmReplace()}
              disabled={saving || unchanged}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中…' : '确认替换'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
