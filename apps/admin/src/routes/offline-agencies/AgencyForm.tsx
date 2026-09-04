// ============================================================
// 线下招聘机构 新建 / 编辑表单
//
// ── 为什么有「来源机构」这个字段 ────────────────────────────────────────────
// OfflineAgency.sourceOrgId 是 legacy 线下机构通向治理档案 / 资质核验的**唯一桥**
// （见 services/api/offlineAgencyGovernance.ts 顶部注释：两个模型之间没有外键）。
// 后端 create-offline-agency.dto.ts 与 offline-agencies.service.ts 的
// adminCreate / adminUpdate 一直支持这一列，但本表单此前没有该字段，于是本页新建的
// 每一条机构 sourceOrgId 恒为 null —— GovernanceDrawer 永远停在「没有来源机构」那一态，
// ReviewDialog 里「审核前先核资质」的指引对新行全是空操作。本文件补的就是这一段。
//
// ── 为什么它必须可以留空 ────────────────────────────────────────────────────
// offline-agencies.service.ts adminPublish 的发布闸门只对**有**来源机构的记录生效：
//   if (publishStatus === 'published' && agency.sourceOrgId) assertOrgContentTrustActive(...)
// 没有来源机构的是 Admin 自录的线下机构目录，不存在「来源机构信任」这个决策对象。
// 所以留空是合法业务状态，不是漏填；界面必须如实说清留空的后果，而不是写
// 「建议填写」这类没有信息量的话。
//
// ── 机构列表「拿不到」和「没有」必须分开 ────────────────────────────────────
// 沿用同页 GovernanceDrawer.tsx 已建立的口径：加载失败走红色 LoadFailed 语气 + 重试，
// 确认为空走中性语气，两者措辞与底色都不可混淆。失败时**不渲染下拉**，避免一个空
// 下拉被读成「系统里没有机构可选」。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Drawer } from '@ai-job-print/ui'
import { PARTNER_TYPE_LABELS, type PartnerType } from '@ai-job-print/shared'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import { Field, GhostButton, PrimaryButton } from '../../components/form'
import {
  offlineAgenciesAdminService,
  ORG_TYPE_LABELS,
  type AdminOfflineAgencyDetail,
  type OfflineAgencyInput,
  type OfflineAgencyOrgType,
} from '../../services/api/offlineAgenciesAdmin'
import { orgsAdminService } from '../../services/api/orgsAdmin'
import { MOCK_ORG_SCRIPTS } from '../../services/api/offlineAgencyGovernance'
import { API_MODE, ApiHttpError } from '../../services/api/client'

// ─── 共用样式 ─────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

// ─── 来源机构候选 ─────────────────────────────────────────────────────────────

interface OrgOption {
  id: string
  label: string
  /** Organization.contentTrustStatus；null = 从未标记，发布闸门同样拒绝。 */
  trustStatus: string | null
  archived: boolean
  /** true = 仅 mock 模式下用于演练抽屉状态的剧本项，不是真实机构。 */
  mockScript: boolean
}

type OrgOptions =
  | { kind: 'loading' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ready'; data: OrgOption[] }

/**
 * mock 模式下的剧本机构。
 *
 * 它顶替的是 offlineAgenciesAdmin.ts mock createAgency 里被删掉的
 * MOCK_SOURCE_ORG_ROTATION —— 那段逻辑会把「管理员明确留空」篡改成「系统替你绑一个」，
 * 必须删；但它承载的能力（让 GovernanceDrawer 的五态都能被人工点到）是有价值的，
 * 于是搬到这里，变成管理员**显式选择**的剧本项。
 * 只在 API_MODE !== 'http' 时出现；真后端下这几项一个都不会渲染。
 */
const MOCK_SCRIPT_ORGS: OrgOption[] = [
  { id: MOCK_ORG_SCRIPTS.full,            label: 'mock 剧本 · 有治理档案且有资质',  trustStatus: 'active', archived: false, mockScript: true },
  { id: MOCK_ORG_SCRIPTS.noQualification, label: 'mock 剧本 · 有档案但零资质',      trustStatus: null,     archived: false, mockScript: true },
  { id: MOCK_ORG_SCRIPTS.noProfile,       label: 'mock 剧本 · 无档案但有资质',      trustStatus: null,     archived: false, mockScript: true },
  { id: MOCK_ORG_SCRIPTS.missing,         label: 'mock 剧本 · 机构不存在（404）',   trustStatus: null,     archived: false, mockScript: true },
  { id: MOCK_ORG_SCRIPTS.unstable,        label: 'mock 剧本 · 接口失败（503）',     trustStatus: null,     archived: false, mockScript: true },
]

function orgLabel(name: string, type: string): string {
  const typeLabel = PARTNER_TYPE_LABELS[type as PartnerType] ?? type
  return typeLabel ? `${name}（${typeLabel}）` : name
}

/** 与 services/api/src/common/content-trust.ts 同一条判据：active 且未归档才发得出去。 */
function trustSummary(option: OrgOption): { publishable: boolean; text: string } {
  if (option.archived) return { publishable: false, text: '该机构已归档，绑定后本机构将无法发布' }
  if (option.trustStatus === 'active') return { publishable: true, text: '该机构内容信任为 active 且未归档，满足发布闸门' }
  return {
    publishable: false,
    text: `该机构内容信任状态为「${option.trustStatus ?? '未标记'}」，绑定后本机构发布会被拒（ORG_CONTENT_TRUST_REQUIRED）`,
  }
}

// ─── 表单状态 ─────────────────────────────────────────────────────────────────

interface FormState {
  name: string
  orgType: string
  address: string
  phone: string
  contactEmail: string
  description: string
  website: string
  logoUrl: string
  /** '' = 不绑定来源机构（写回后端是 null，不是 undefined）。 */
  sourceOrgId: string
}

const EMPTY_FORM: FormState = {
  name: '', orgType: 'recruitment', address: '', phone: '',
  contactEmail: '', description: '', website: '', logoUrl: '', sourceOrgId: '',
}

function detailToForm(d: AdminOfflineAgencyDetail): FormState {
  return {
    name: d.name,
    orgType: d.orgType,
    address: d.address ?? '',
    phone: d.phone ?? '',
    contactEmail: d.contactEmail ?? '',
    description: d.description ?? '',
    website: d.website ?? '',
    logoUrl: d.logoUrl ?? '',
    sourceOrgId: d.sourceOrgId ?? '',
  }
}

function validateForm(f: FormState): string | null {
  if (!f.name.trim() || f.name.trim().length < 2 || f.name.trim().length > 80) {
    return '机构名称长度需为 2–80 个字符'
  }
  if (!f.orgType) return '请选择机构类型'
  if (!f.address.trim()) return '请填写机构地址'
  if (f.website.trim() && !/^https?:\/\//.test(f.website.trim())) {
    return '官网链接必须以 http:// 或 https:// 开头'
  }
  if (f.logoUrl.trim() && !/^https?:\/\//.test(f.logoUrl.trim())) {
    return 'Logo 图片地址必须以 http:// 或 https:// 开头'
  }
  if (f.description.length > 2000) return '机构简介不能超过 2000 字'
  return null
}

function formToInput(f: FormState): OfflineAgencyInput {
  const s = (v: string) => (v.trim() ? v.trim() : null)
  return {
    name: f.name.trim(),
    orgType: f.orgType as OfflineAgencyOrgType,
    address: f.address.trim(),
    phone: s(f.phone),
    contactEmail: s(f.contactEmail),
    description: s(f.description),
    website: s(f.website),
    logoUrl: s(f.logoUrl),
    // 显式 null 而不是省略：DTO 的 @IsOptional 放行 null，adminUpdate 会把这一列清空。
    // 省略（undefined）在后端语义是「不修改」，那样就取消不了已有的绑定。
    sourceOrgId: s(f.sourceOrgId),
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AgencyFormProps {
  open: boolean
  editing: AdminOfflineAgencyDetail | null // null = 新建
  onClose: () => void
  onSaved: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgencyForm({ open, editing, onClose, onSaved }: AgencyFormProps) {
  const [form, setForm]     = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [orgs, setOrgs]     = useState<OrgOptions>({ kind: 'loading' })

  // 复用既有端点 GET /admin/orgs（orgsAdminService.listOrgs），不新增后端端点。
  const loadOrgs = useCallback(async () => {
    setOrgs({ kind: 'loading' })
    try {
      const list = await orgsAdminService.listOrgs()
      const real: OrgOption[] = list.map((o) => ({
        id: o.id,
        label: orgLabel(o.name, o.type),
        trustStatus: o.contentTrustStatus,
        archived: o.archived,
        mockScript: false,
      }))
      setOrgs({ kind: 'ready', data: API_MODE === 'http' ? real : [...real, ...MOCK_SCRIPT_ORGS] })
    } catch (e) {
      const code = e instanceof ApiHttpError ? e.code : 'UNKNOWN'
      const message = e instanceof Error ? e.message : '未知错误'
      setOrgs({ kind: 'error', code, message })
    }
  }, [])

  // 打开时初始化表单
  useEffect(() => {
    if (open) {
      setForm(editing ? detailToForm(editing) : EMPTY_FORM)
      setError(null)
      void loadOrgs()
    }
  }, [open, editing, loadOrgs])

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const handleSubmit = async () => {
    const err = validateForm(form)
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    try {
      const input = formToInput(form)
      if (editing) {
        await offlineAgenciesAdminService.updateAgency(editing.id, input)
      } else {
        await offlineAgenciesAdminService.createAgency(input)
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  // 已绑定但不在候选列表里的 ID：绝不能被下拉悄悄吞掉（sourceOrgId 无外键，
  // 指向已删除 Organization 的历史数据真实存在，正是抽屉里「机构不存在」那一态）。
  const known = orgs.kind === 'ready' ? orgs.data.find((o) => o.id === form.sourceOrgId) : undefined
  const dangling = orgs.kind === 'ready' && form.sourceOrgId !== '' && !known
  const originalSourceOrgId = editing?.sourceOrgId ?? ''
  const changedBinding = !!editing && form.sourceOrgId !== originalSourceOrgId

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? '编辑机构' : '新建线下招聘机构'}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <GhostButton disabled={busy} onClick={onClose}>取消</GhostButton>
          <PrimaryButton disabled={busy} onClick={() => void handleSubmit()}>
            {busy ? '保存中…' : editing ? '保存' : '创建'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <Field label="机构名称" required>
          <input className={inputCls} placeholder="如：XX 招聘服务有限公司" value={form.name} onChange={set('name')} />
        </Field>

        <Field label="机构类型" required>
          <select className={inputCls} value={form.orgType} onChange={set('orgType')}>
            {(Object.entries(ORG_TYPE_LABELS) as [OfflineAgencyOrgType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>

        <Field label="地址" required>
          <input className={inputCls} placeholder="如：北京市朝阳区 XX 路 XX 号" value={form.address} onChange={set('address')} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="联系电话">
            <input className={inputCls} placeholder="手机或固话" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="联系邮箱">
            <input className={inputCls} placeholder="contact@example.com" value={form.contactEmail} onChange={set('contactEmail')} />
          </Field>
        </div>

        {/* ── 来源机构（可留空）───────────────────────────────────────────── */}
        <section className="rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-3">
          <p className="text-xs font-medium text-neutral-600">来源机构（可留空）</p>

          {orgs.kind === 'loading' && (
            <p className="mt-2 text-xs text-neutral-400">正在读取机构列表…</p>
          )}

          {/* 「没拿到」：红色语气 + 错误码 + 重试，且**不渲染下拉** */}
          {orgs.kind === 'error' && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-700">
                <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0" />
                未能获取机构列表，无法确认有哪些来源机构可选
              </p>
              <p className="mt-1 text-[11px] text-red-600">
                {orgs.message}（{orgs.code}）。这<strong className="font-semibold">不是</strong>「系统里没有机构可选」；
                在列表恢复之前请勿据此判断该机构没有来源机构。
                {form.sourceOrgId
                  ? `已保存的绑定（${form.sourceOrgId}）不会因为这次失败被清空。`
                  : ''}
              </p>
              <button
                onClick={() => void loadOrgs()}
                className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
              >
                <RefreshCwIcon className="h-3 w-3" />
                重试
              </button>
            </div>
          )}

          {/* 「查过了，就是没有」：中性语气，与失败完全不同 */}
          {orgs.kind === 'ready' && orgs.data.length === 0 && (
            <div className="mt-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
              <p className="text-xs font-medium text-neutral-700">机构表里目前没有任何机构，暂无可绑定的来源机构</p>
              <p className="mt-1 text-[11px] text-neutral-500">
                接口已正常返回，机构数为 0。可先在「合作机构」页建好机构再回来绑定；本次保存将按「不绑定来源机构」处理。
              </p>
            </div>
          )}

          {orgs.kind === 'ready' && orgs.data.length > 0 && (
            <select
              className={`${inputCls} mt-2`}
              value={form.sourceOrgId}
              onChange={set('sourceOrgId')}
            >
              <option value="">不绑定来源机构（管理员自录的线下机构目录）</option>
              {orgs.data.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
              {dangling && (
                <option value={form.sourceOrgId}>
                  {form.sourceOrgId}（该 ID 不在机构列表中）
                </option>
              )}
            </select>
          )}

          {/* 留空的后果：如实写清，不写「建议填写」 */}
          {form.sourceOrgId === '' ? (
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
              留空 = 本机构不绑定来源机构：发布时<strong className="font-semibold">不会</strong>校验来源机构的内容信任状态
              （不套发布闸门），治理档案与资质抽屉也<strong className="font-semibold">没有可核验的对象</strong>，
              会一直显示「本机构没有来源机构，因此不存在可核验的资质档案」。
              适用于管理员自录、不来自外部供稿链路的线下机构目录。
            </p>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
              已绑定 <code className="rounded bg-neutral-100 px-1 py-0.5">{form.sourceOrgId}</code>：
              资质抽屉将按该 ID 读取治理档案与资质；发布本机构时必须该机构内容信任为 active 且未归档。
            </p>
          )}

          {known && (
            <p className={`mt-1 text-[11px] ${trustSummary(known).publishable ? 'text-neutral-500' : 'text-warning-fg'}`}>
              {trustSummary(known).text}
              {known.mockScript && ' · 这是 mock 剧本项，仅用于本地演练抽屉状态，不是真实机构'}
            </p>
          )}

          {dangling && (
            <p className="mt-1 text-[11px] text-warning-fg">
              该 ID 不在机构列表里（sourceOrgId 无外键，可能指向已删除的机构）。保留原值不会自动清空，
              但资质抽屉会报「来源机构在机构表中不存在」；如需解绑请显式选择「不绑定来源机构」。
            </p>
          )}

          {changedBinding && (
            <p className="mt-1 text-[11px] text-warning-fg">
              已改变来源机构绑定（原：{originalSourceOrgId || '未绑定'} → {form.sourceOrgId || '未绑定'}）。
              保存后发布闸门的判定对象随之改变；另外后端对任何内容编辑都会把审核状态重置为待审核、发布状态重置为草稿。
            </p>
          )}
        </section>

        <p className="text-xs text-warning-fg">
          资质证照将在 P1 的独立核验模块中维护；当前表单不代表资质核验通过。
        </p>

        <Field label="官网链接" hint="以 http:// 或 https:// 开头">
          <input className={inputCls} placeholder="https://" value={form.website} onChange={set('website')} />
        </Field>

        <Field label="Logo 图片地址" hint="以 http:// 或 https:// 开头">
          <input className={inputCls} placeholder="https://" value={form.logoUrl} onChange={set('logoUrl')} />
        </Field>

        <Field label="机构简介" hint={`${form.description.length}/2000`}>
          <textarea
            className={`${inputCls} h-24 resize-none`}
            placeholder="简要介绍机构背景、服务范围等"
            value={form.description}
            onChange={set('description')}
          />
        </Field>

        <p className="text-xs text-neutral-400">
          线下机构仅作信息展示用途，不参与平台内简历投递或招聘闭环。
        </p>
      </div>
    </Drawer>
  )
}
