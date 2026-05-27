import { useState } from 'react'
import type { EnabledModule, PartnerCoopStatus, PartnerSceneConfig, PartnerType } from '@ai-job-print/shared'
import {
  MODULE_LABELS,
  PARTNER_TYPE_LABELS,
  PROHIBITED_MODULES,
  PUBLIC_SERVICE_LEVEL_LABELS,
  SCENE_DEFAULT_MODULES,
  SCENE_TEMPLATE_LABELS,
} from '@ai-job-print/shared'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { Building2Icon, LockIcon, MonitorIcon, PencilIcon, SettingsIcon } from 'lucide-react'

// ─── Types & mock ─────────────────────────────────────────────────────────────

interface OrgProfile {
  name: string
  partnerType: PartnerType
  contact: string
  contactPhone: string
  contactEmail: string
  qualification: string
  coopStatus: PartnerCoopStatus
  coopSince: string
  sceneConfig: PartnerSceneConfig
  boundTerminals: { sn: string; location: string }[]
}

const MOCK_PROFILE: OrgProfile = {
  name:         '市人力资源和社会保障局',
  partnerType:  'public_employment_service',
  contact:      '张主任',
  contactPhone: '138****0001',
  contactEmail: 'service@hrss.gov.cn',
  qualification: '公共就业服务机构（人社部备案），合作协议编号：GOV-2026-0101',
  coopStatus:   'active',
  coopSince:    '2026-01-15',
  sceneConfig: {
    sceneTemplate:    'public_employment',
    enabledModules:   SCENE_DEFAULT_MODULES.public_employment,
    jurisdictionArea: '本市全辖区',
    serviceLevel:     'municipal',
    govOrgCode:       'HRSS-2026-0001',
  },
  boundTerminals: [
    { sn: 'KSK-001', location: 'A区人社局大厅' },
    { sn: 'KSK-002', location: 'B区就业服务中心' },
    { sn: 'KSK-003', location: 'C区人才交流中心' },
  ],
}

const COOP_MAP: Record<PartnerCoopStatus, { badge: 'success' | 'error' | 'warning'; label: string }> = {
  active:    { badge: 'success', label: '合作中' },
  suspended: { badge: 'error',   label: '已暂停' },
  pending:   { badge: 'warning', label: '审核中' },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [profile] = useState(MOCK_PROFILE)
  const coop = COOP_MAP[profile.coopStatus]
  const { sceneConfig } = profile

  return (
    <Page
      title="机构资料"
      subtitle="机构基本信息与合作配置"
      actions={
        <Button size="sm" variant="outline" className="flex items-center gap-1.5">
          <PencilIcon className="h-4 w-4" />
          编辑资料
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 基本信息 */}
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50">
              <Building2Icon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">{profile.name}</h2>
              <p className="text-sm text-gray-500">{PARTNER_TYPE_LABELS[profile.partnerType]}</p>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <Row label="联系人"   value={profile.contact} />
            <Row label="联系电话" value={profile.contactPhone} />
            <Row label="联系邮箱" value={profile.contactEmail} />
            <Row label="合作状态" value={<StatusBadge status={coop.badge} label={coop.label} />} />
            <Row label="合作开始" value={profile.coopSince} />
          </div>
        </Card>

        {/* 资质信息 */}
        <Card className="p-6">
          <h3 className="mb-3 text-sm font-medium text-gray-700">资质信息</h3>
          <p className="text-sm text-gray-600 leading-relaxed">{profile.qualification}</p>

          {sceneConfig.serviceLevel && (
            <div className="mt-4 space-y-2 text-sm">
              <Row label="服务层级" value={PUBLIC_SERVICE_LEVEL_LABELS[sceneConfig.serviceLevel]} />
              {sceneConfig.jurisdictionArea && (
                <Row label="辖区范围" value={sceneConfig.jurisdictionArea} />
              )}
              {sceneConfig.govOrgCode && (
                <Row label="单位编码" value={<span className="font-mono text-xs">{sceneConfig.govOrgCode}</span>} />
              )}
            </div>
          )}

          <h3 className="mb-3 mt-6 text-sm font-medium text-gray-700">绑定终端</h3>
          <div className="space-y-2">
            {profile.boundTerminals.map((t) => (
              <div key={t.sn} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                <MonitorIcon className="h-4 w-4 text-gray-400" />
                <span className="font-mono text-xs text-gray-700">{t.sn}</span>
                <span className="text-xs text-gray-500">{t.location}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 场景与模块配置 */}
      <Card className="mt-6 p-6">
        <div className="mb-4 flex items-center gap-2">
          <SettingsIcon className="h-4 w-4 text-gray-400" />
          <h3 className="text-sm font-medium text-gray-700">场景与模块配置</h3>
          <span className="ml-auto rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
            {SCENE_TEMPLATE_LABELS[sceneConfig.sceneTemplate]}
          </span>
        </div>

        <div className="mb-3">
          <p className="mb-2 text-xs text-gray-400">当前启用模块</p>
          <div className="flex flex-wrap gap-2">
            {sceneConfig.enabledModules.map((m: EnabledModule) => (
              <span
                key={m}
                className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-600"
              >
                {MODULE_LABELS[m]}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-gray-50 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <LockIcon className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-xs font-medium text-gray-500">合规限制 — 永久禁用功能</span>
          </div>
          <p className="mb-2 text-xs text-gray-400">
            以下功能属于招聘闭环，无论任何配置均不允许启用：
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROHIBITED_MODULES.map((m) => (
              <span key={m} className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-400 line-through">
                {m}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <p className="mt-4 text-xs text-gray-400">如需修改合作状态或模块配置，请联系平台管理员</p>
    </Page>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-16 shrink-0 text-gray-400">{label}</span>
      <span className="text-gray-700">{value}</span>
    </div>
  )
}
