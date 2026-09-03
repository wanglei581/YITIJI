import { useEffect, useState } from 'react'
import {
  MODULE_LABELS,
  ORG_CONTENT_TRUST_STATUS_LABELS,
  ORG_CONTENT_TRUST_UNSET_LABEL,
  PROHIBITED_MODULES,
  SCENE_TEMPLATE_LABELS,
  isOrgContentPublishable,
  type OrgContentTrustStatus,
} from '@ai-job-print/shared'
import { Button, Card, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  Building2Icon,
  CheckCircle2Icon,
  LockIcon,
  PencilIcon,
  SettingsIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react'
import { getOrgProfile, updateOrgProfile, type PartnerOrgProfile } from '../../services/api/orgSelf'

// ─── 机构资料（审计修复：原 MOCK_PROFILE 硬编码已删除，全部走 /partner/profile 真实数据）──
// 机构自助仅可改 联系人/联系电话；名称、类型、场景模板、启用模块由管理员管理（运营边界）。
// 内容信任状态（contentTrustStatus）为发布闸门依据，由平台管理员人工核验与标记。

const ORG_TYPE_LABELS: Record<string, string> = {
  school: '高校 / 院校',
  hr_company: '人力资源公司',
  job_platform: '招聘平台',
  fair_organizer: '招聘会主办方',
  government: '政府 / 公共就业服务机构',
  public_employment_service: '公共就业服务机构',
  aggregator: '数据聚合方',
  other: '其他机构',
}

function trustStatusLabel(status: OrgContentTrustStatus | null | undefined): string {
  if (!status) return ORG_CONTENT_TRUST_UNSET_LABEL
  return ORG_CONTENT_TRUST_STATUS_LABELS[status] ?? status
}

function trustStatusTone(status: OrgContentTrustStatus | null | undefined): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'suspended' || status === 'revoked') return 'error'
  return 'default'
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { hour12: false }) : iso
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<PartnerOrgProfile | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  // 编辑抽屉（仅联系人/联系电话）
  const [editing, setEditing] = useState(false)
  const [contact, setContact] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getOrgProfile()
      .then((p) => {
        if (cancelled) return
        setProfile(p)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const openEdit = () => {
    if (!profile) return
    setContact(profile.contact ?? '')
    setContactPhone(profile.contactPhone ?? '')
    setSaveError(null)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await updateOrgProfile({ contact, contactPhone })
      setProfile(updated)
      setEditing(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') {
    return (
      <Page title="机构资料" subtitle="机构基本信息与合作配置">
        <LoadingState className="py-20" />
      </Page>
    )
  }
  if (state === 'error' || !profile) {
    return (
      <Page title="机构资料" subtitle="机构基本信息与合作配置">
        <ErrorState className="py-20" onRetry={() => setReloadKey((k) => k + 1)} />
      </Page>
    )
  }

  const archived = profile.archived ?? false
  const publishable = isOrgContentPublishable(profile.contentTrustStatus, archived)

  return (
    <Page
      title="机构资料"
      subtitle="机构基本信息与合作配置"
      actions={
        <Button size="sm" variant="outline" className="flex items-center gap-1.5" onClick={openEdit}>
          <PencilIcon className="h-4 w-4" />
          编辑联系方式
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 基本信息（真实数据） */}
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-info-bg">
              <Building2Icon className="h-6 w-6 text-info-fg" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-900">{profile.name}</h2>
              <p className="text-sm text-neutral-500">{ORG_TYPE_LABELS[profile.type] ?? profile.type}</p>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <Row label="联系人" value={profile.contact || <span className="text-neutral-400">未填写</span>} />
            <Row label="联系电话" value={profile.contactPhone || <span className="text-neutral-400">未填写</span>} />
            <Row
              label="合作状态"
              value={
                profile.enabled
                  ? <StatusBadge dot status="success" label="合作中" />
                  : <StatusBadge dot status="error" label="已停用" />
              }
            />
            <Row
              label="内容信任"
              value={
                <div className="flex items-center gap-1.5">
                  <StatusBadge
                    dot
                    status={trustStatusTone(profile.contentTrustStatus)}
                    label={trustStatusLabel(profile.contentTrustStatus)}
                  />
                  {archived && <StatusBadge status="error" label="已归档" />}
                </div>
              }
            />
            <Row label="接入时间" value={profile.createdAt.slice(0, 10)} />
          </div>
        </Card>

        {/* 接入概况（真实计数） */}
        <Card className="p-6">
          <h3 className="mb-3 text-sm font-medium text-neutral-700">接入概况</h3>
          <div className="space-y-3 text-sm">
            <Row label="数据源" value={`${profile.sourceCount} 个`} />
            <Row label="机构账号" value={`${profile.accountCount} 个`} />
          </div>
          <p className="mt-4 rounded-lg bg-neutral-50 px-3 py-2.5 text-xs leading-relaxed text-neutral-500">
            机构名称、类型、场景模板与启用模块由平台管理员维护；如需调整请联系管理员。
            本页仅支持机构自助修改联系人与联系电话。
          </p>
        </Card>
      </div>

      {/* 内容信任与发布权限（发布闸门依据） */}
      <Card className="mt-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheckIcon className="h-4 w-4 text-neutral-500" />
          <h3 className="text-sm font-medium text-neutral-700">内容信任与发布权限</h3>
          <div className="ml-auto flex items-center gap-1.5">
            <StatusBadge
              dot
              status={trustStatusTone(profile.contentTrustStatus)}
              label={trustStatusLabel(profile.contentTrustStatus)}
            />
            {archived && <StatusBadge status="error" label="已归档" />}
          </div>
        </div>

        {/* 状态与发布后果说明 */}
        {publishable ? (
          <div className="rounded-lg border border-success/30 bg-success-bg p-4 text-xs text-success-fg">
            <div className="flex items-start gap-2.5">
              <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" />
              <div>
                <p className="font-semibold text-success-fg">当前状态：内容可信（允许发布）</p>
                <p className="mt-1 leading-relaxed text-neutral-600">
                  机构内容信任核验已通过。审核通过的岗位、招聘会与政策内容可正常在终端发布上屏并对外展示。
                </p>
              </div>
            </div>
          </div>
        ) : archived ? (
          <div className="rounded-lg border border-error/30 bg-error-bg p-4 text-xs text-error-fg">
            <div className="flex items-start gap-2.5">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-error-fg" />
              <div>
                <p className="font-semibold text-error-fg">当前状态：已归档（禁止发布）</p>
                <p className="mt-1 leading-relaxed text-neutral-600">
                  当前机构处于已归档状态。根据平台发布安全闸门（fail-closed），已归档机构即使内容信任为可信，其内容也一律禁止发布上屏，终端用户不可见。
                </p>
              </div>
            </div>
          </div>
        ) : profile.contentTrustStatus === 'pending' ? (
          <div className="rounded-lg border border-warning/30 bg-warning-bg p-4 text-xs text-warning-fg">
            <div className="flex items-start gap-2.5">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" />
              <div>
                <p className="font-semibold text-warning-fg">当前状态：待核验（暂不可发布）</p>
                <p className="mt-1 leading-relaxed text-neutral-600">
                  机构内容信任尚未完成平台核验。根据平台发布安全闸门（fail-closed），在此状态下，<strong>即使单条岗位、招聘会或政策内容已通过审核，也无法在终端发布上屏，终端用户暂不可见</strong>。
                </p>
              </div>
            </div>
          </div>
        ) : profile.contentTrustStatus === 'suspended' ? (
          <div className="rounded-lg border border-error/30 bg-error-bg p-4 text-xs text-error-fg">
            <div className="flex items-start gap-2.5">
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-error-fg" />
              <div>
                <p className="font-semibold text-error-fg">当前状态：已暂停（禁止发布）</p>
                <p className="mt-1 leading-relaxed text-neutral-600">
                  机构内容信任已被平台管理员暂停。暂停期间所有新提交及待发布内容无法发布至终端对外展示。
                </p>
              </div>
            </div>
          </div>
        ) : profile.contentTrustStatus === 'revoked' ? (
          <div className="rounded-lg border border-error/30 bg-error-bg p-4 text-xs text-error-fg">
            <div className="flex items-start gap-2.5">
              <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-error-fg" />
              <div>
                <p className="font-semibold text-error-fg">当前状态：已撤销（禁止发布）</p>
                <p className="mt-1 leading-relaxed text-neutral-600">
                  机构内容信任已被平台管理员撤销。该机构的所有内容均无法发布至终端对外展示。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs text-neutral-700">
            <div className="flex items-start gap-2.5">
              <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
              <div>
                <p className="font-semibold text-neutral-800">当前状态：未标记（暂不可发布）</p>
                <p className="mt-1 leading-relaxed text-neutral-600">
                  机构尚未标记内容信任状态。根据平台发布安全闸门（fail-closed），未标记机构的内容一律禁止发布，即使单条内容审核通过也不会在终端展示。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 详细核验信息 */}
        <div className="mt-4 space-y-2.5 border-t border-neutral-100 pt-4 text-xs">
          <Row label="信任状态" value={trustStatusLabel(profile.contentTrustStatus)} />
          <Row
            label="终端发布"
            value={
              publishable ? (
                <span className="font-medium text-success-fg">允许发布（终端可见）</span>
              ) : (
                <span className="font-medium text-warning-fg">暂不可发布（终端不上屏）</span>
              )
            }
          />
          <Row label="核验时间" value={fmtTime(profile.contentTrustReviewedAt)} />
          <Row label="核验依据" value={profile.contentTrustReason || <span className="text-neutral-400">无</span>} />
        </div>

        {/* 操作指引 */}
        <div className="mt-4 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500">
          <p className="font-medium text-neutral-600">操作指引</p>
          <p className="mt-1 leading-relaxed">
            {publishable
              ? '机构端无需额外操作，正常录入与维护岗位、招聘会或政策内容即可。'
              : archived
                ? '机构处于归档状态，如需恢复供稿与发布，请联系平台管理员解除归档并重新核验。'
                : profile.contentTrustStatus === 'pending' || !profile.contentTrustStatus
                  ? '内容信任由平台管理员依据合作协议与授权资质进行人工核验，请耐心等待平台审核（机构端无需且无法自助操作；如需加急请联系平台管理员）。'
                  : '内容信任状态由平台管理员管理，如需了解详情或申请恢复，请联系平台管理员（机构端无法自助解除）。'}
          </p>
        </div>
      </Card>

      {/* 场景与模块配置（真实数据） */}
      <Card className="mt-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <SettingsIcon className="h-4 w-4 text-neutral-400" />
          <h3 className="text-sm font-medium text-neutral-700">场景与模块配置</h3>
          {profile.sceneTemplate && (
            <span className="ml-auto rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
              {(SCENE_TEMPLATE_LABELS as Record<string, string>)[profile.sceneTemplate] ?? profile.sceneTemplate}
            </span>
          )}
        </div>

        <div className="mb-3">
          <p className="mb-2 text-xs text-neutral-400">当前启用模块</p>
          {profile.enabledModules.length === 0 ? (
            <p className="text-xs text-neutral-400">暂未配置启用模块，请联系平台管理员开通</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {profile.enabledModules.map((m) => (
                <span key={m} className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-600">
                  {(MODULE_LABELS as Record<string, string>)[m] ?? m}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-lg bg-neutral-50 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <LockIcon className="h-3.5 w-3.5 text-neutral-400" />
            <span className="text-xs font-medium text-neutral-500">合规限制 — 永久禁用功能</span>
          </div>
          <p className="mb-2 text-xs text-neutral-400">以下功能属于招聘闭环，无论任何配置均不允许启用：</p>
          <div className="flex flex-wrap gap-1.5">
            {PROHIBITED_MODULES.map((m) => (
              <span key={m} className="rounded bg-error-bg px-2 py-0.5 text-xs text-error-fg line-through">
                {m}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <p className="mt-4 text-xs text-neutral-400">如需修改合作状态或模块配置，请联系平台管理员</p>

      {/* 编辑联系方式抽屉 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-neutral-900">编辑联系方式</h3>
              <button
                type="button"
                onClick={() => setEditing(false)}
                aria-label="关闭"
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block text-neutral-600">联系人</span>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  maxLength={50}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-neutral-600">联系电话</span>
                <input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  maxLength={30}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                />
              </label>
              {saveError && <p className="text-xs text-error-fg">{saveError}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                  取消
                </Button>
                <Button size="sm" onClick={() => void save()} disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </Page>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <span className="text-neutral-700">{value}</span>
    </div>
  )
}
