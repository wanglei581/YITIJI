// ============================================================
// 机构详情抽屉里的「内容可信」小节 —— 发布闸门的**唯一人工入口**在后台的落地。
//
// 背景：闸门 services/api/src/common/content-trust.ts 于 2026-08-17 上生产，
// 判据 contentTrustStatus === 'active' && archivedAt == null。端点
// PATCH /admin/orgs/:id/content-trust 当天就存在，但 Admin 前端零控件 ——
// 运营要发第一条内容，只能连数据库或跑维护脚本，绕过审计留痕。本组件补的就是这个。
//
// 本组件刻意做的四件事：
//   1. 把闸门读的东西**原样**显示：状态、谁、什么时候、什么依据、是否已归档。
//      contentTrustReviewedBy 是账号 ID，服务端不回显姓名，这里也不编一个。
//   2. 标 active 必须填依据，且提交前就按服务端同一判据拦住（contentTrustRules.ts）。
//   3. 已归档单独说清：标了也发不出去，且**后台目前没有取消归档的入口**
//      （services/api/src 里 Organization.archivedAt 只有读、没有任何写入路径）。
//      不写这句，运营会以为标完就行。
//   4. 只有 admin 角色能改；非 admin 只读，并说明原因，不给一个点了必然 403 的按钮。
//
// 不做：不新建路由、不新建页面。控件嵌在既有「合作机构 → 机构详情」抽屉里。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { StatusBadge } from '@ai-job-print/ui'
import { ShieldCheckIcon } from 'lucide-react'
import { getUser } from '../../services/auth'
import {
  orgsAdminService,
  type OrgContentTrustView,
} from '../../services/api/orgsAdmin'
import {
  CONTENT_TRUST_UI_PATH,
  ORG_CONTENT_TRUST_STATUSES,
  ORG_CONTENT_TRUST_STATUS_LABELS,
  ORG_CONTENT_TRUST_UNSET_LABEL,
  contentTrustPublishable,
  contentTrustSubmitBlock,
  contentTrustSubmitBlockMessage,
  type OrgContentTrustStatus,
} from './contentTrustRules'

/** 小节标题 = 指路文案路径的最后一段。两处同源，指路文案永远指得到真控件。 */
const SECTION_TITLE = CONTENT_TRUST_UI_PATH[2]

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function statusLabel(status: string | null): string {
  if (status === null) return ORG_CONTENT_TRUST_UNSET_LABEL
  const known = (ORG_CONTENT_TRUST_STATUSES as readonly string[]).includes(status)
  return known ? ORG_CONTENT_TRUST_STATUS_LABELS[status as OrgContentTrustStatus] : status
}

function statusTone(status: string | null): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'suspended' || status === 'revoked') return 'error'
  return 'default'
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }) : iso
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败,请重试'
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-20 shrink-0 text-neutral-400">{label}</span>
      <span className="min-w-0 flex-1 break-words text-neutral-700">{children}</span>
    </div>
  )
}

export function OrgContentTrustPanel({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const [trust, setTrust] = useState<OrgContentTrustView | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [status, setStatus] = useState<OrgContentTrustStatus>('active')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // 后端约束:AdminOrgsController 整类挂 @Roles('admin'),partner / kiosk 一律 403。
  // 前端按同一口径:不是 admin 就只读,不渲染一个点下去必然被拒的按钮。
  const canEdit = getUser()?.role === 'admin'

  const load = useCallback(async () => {
    setState('loading')
    try {
      const t = await orgsAdminService.getContentTrust(orgId)
      setTrust(t)
      setStatus(
        (ORG_CONTENT_TRUST_STATUSES as readonly string[]).includes(t.contentTrustStatus ?? '')
          ? (t.contentTrustStatus as OrgContentTrustStatus)
          : 'active',
      )
      setReason('')
      setState('ready')
    } catch {
      setState('error')
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const archived = trust?.archived ?? false
  const block = contentTrustSubmitBlock({ status, reason, archived })
  const publishable = contentTrustPublishable(trust?.contentTrustStatus ?? null, archived)

  const submit = async () => {
    if (block !== null) return
    setSaving(true)
    setError(null)
    try {
      const next = await orgsAdminService.setContentTrust(orgId, {
        status,
        reason: reason.trim() || undefined,
      })
      setTrust(next)
      setReason('')
      setSavedAt(next.contentTrustReviewedAt)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center gap-2">
        <ShieldCheckIcon className="h-4 w-4 text-neutral-500" />
        <p className="text-sm font-semibold text-neutral-800">{SECTION_TITLE}</p>
        {state === 'ready' && (
          <StatusBadge
            dot
            status={statusTone(trust?.contentTrustStatus ?? null)}
            label={statusLabel(trust?.contentTrustStatus ?? null)}
          />
        )}
        {state === 'ready' && archived && <StatusBadge status="error" label="已归档" />}
      </div>

      {state === 'loading' && <p className="text-xs text-neutral-400">读取中…</p>}
      {state === 'error' && (
        <p className="text-xs text-error-fg">
          读取内容信任状态失败。
          <button onClick={() => void load()} className="ml-1 underline">
            重试
          </button>
        </p>
      )}

      {state === 'ready' && trust && (
        <>
          {/* 闸门判据原样回显:运营那句「我标了为什么还发不出去」在这里就有答案 */}
          <p className="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            发布闸门判据:状态为「{ORG_CONTENT_TRUST_STATUS_LABELS.active}」<strong>且</strong>机构未归档,两个条件缺一即拒。
            当前该机构的内容
            {publishable ? (
              <strong className="text-success-fg">允许发布</strong>
            ) : (
              <strong className="text-warning-fg">不允许发布</strong>
            )}
            。本操作只决定「能不能发」,不会自动上架或下架任何已有内容。
          </p>

          <div className="space-y-1.5">
            <Row label="当前状态">
              {statusLabel(trust.contentTrustStatus)}
              <span className="ml-1.5 font-mono text-[11px] text-neutral-400">
                contentTrustStatus={trust.contentTrustStatus ?? 'null'}
              </span>
            </Row>
            <Row label="核验人">
              {trust.contentTrustReviewedBy ? (
                <span className="font-mono text-[11px]">{trust.contentTrustReviewedBy}</span>
              ) : (
                '—'
              )}
              {trust.contentTrustReviewedBy && (
                <span className="ml-1.5 text-neutral-400">(管理员账号 ID,系统不回显姓名)</span>
              )}
            </Row>
            <Row label="核验时间">{fmtTime(trust.contentTrustReviewedAt)}</Row>
            <Row label="核验依据">{trust.contentTrustReason ?? '—'}</Row>
          </div>

          {archived && (
            <p className="rounded bg-error-bg px-3 py-2 text-xs text-error-fg">
              该机构已归档。<strong>归档状态下即使标记为「{ORG_CONTENT_TRUST_STATUS_LABELS.active}」,其内容仍然发布不出去</strong>
              ,服务端会直接拒绝这次标记(ORG_ARCHIVED)。
              取消归档目前<strong>没有后台入口</strong>(后端未提供该接口),需联系平台工程处理后再回来核验。
            </p>
          )}

          {!canEdit ? (
            <p className="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
              当前账号不是管理员,只能查看内容信任状态。标记内容可信是管理员职责,服务端对该端点限定 admin 角色。
            </p>
          ) : (
            <div className="space-y-2 border-t border-neutral-100 pt-3">
              <p className="text-xs font-medium text-neutral-600">变更内容信任状态</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500">目标状态</span>
                  <select
                    className={inputCls}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as OrgContentTrustStatus)}
                  >
                    {ORG_CONTENT_TRUST_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {ORG_CONTENT_TRUST_STATUS_LABELS[s]}({s})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500">
                  核验依据
                  {status === 'active' && <span className="ml-0.5 text-error-fg">*</span>}
                </span>
                <textarea
                  rows={2}
                  className={inputCls}
                  placeholder="凭什么信任这个来源?写清依据:合作协议编号 / 授权函编号 / 公开数据许可出处。这条会进审计日志。"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>

              {block !== null && (
                <p className="rounded bg-warning-bg px-3 py-2 text-xs text-warning-fg">
                  {contentTrustSubmitBlockMessage(block)}
                </p>
              )}
              {error && <p className="rounded bg-error-bg px-3 py-2 text-xs text-error-fg">{error}</p>}
              {savedAt && !error && (
                <p className="text-xs text-success-fg">已提交,服务端记录的核验时间:{fmtTime(savedAt)}(已写审计日志)</p>
              )}

              <div className="flex justify-end">
                <button
                  onClick={() => void submit()}
                  disabled={saving || block !== null}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? '提交中…' : `标记为「${ORG_CONTENT_TRUST_STATUS_LABELS[status]}」`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
