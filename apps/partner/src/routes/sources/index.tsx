import { useEffect, useState } from 'react'
import { Button, Card, Drawer, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  CopyIcon,
  DatabaseIcon,
  FileSpreadsheetIcon,
  GlobeIcon,
  LinkIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import type { AccessMode, PartnerDataSource, ConnStatus, SyncFrequency, CreateDataSourcePayload, SourceKind } from '../../services/api'
import { API_BASE_URL } from '../../services/api/client'
import { API_ORIGIN, getDataSources, toggleDataSource, createDataSource } from '../../services/api'
import { ExcelImportModal } from './ExcelImportModal'

function resolveWebhookUrl(webhookUrl?: string): string {
  if (!webhookUrl) return ''
  if (/^https?:\/\//i.test(webhookUrl)) return webhookUrl
  return `${API_ORIGIN}${webhookUrl}`
}

// ─── Display maps ─────────────────────────────────────────────────────────────

// 接入方式(AccessMode):描述"用什么方式拉取数据"。
// sourceKind(数据由谁提供)留待 B1 阶段加入列与筛选。
const ACCESS_MODE_STYLE: Record<AccessMode, { label: string; style: string }> = {
  api:     { label: 'API',     style: 'bg-blue-50 text-blue-600'     },
  excel:   { label: 'Excel',   style: 'bg-green-50 text-green-600'   },
  csv:     { label: 'CSV',     style: 'bg-green-50 text-green-600'   },
  json:    { label: 'JSON',    style: 'bg-green-50 text-green-600'   },
  webhook: { label: 'Webhook', style: 'bg-purple-50 text-purple-600' },
  manual:  { label: '手动',    style: 'bg-gray-100 text-gray-600'    },
}
const CONN_MAP: Record<ConnStatus, { badge: 'success' | 'error' | 'default'; label: string }> = {
  connected: { badge: 'success', label: '已连接'  },
  error:     { badge: 'error',   label: '连接异常' },
  disabled:  { badge: 'default', label: '已停用'  },
}
const FREQ_LABELS: Record<SyncFrequency, string> = { realtime: '实时', hourly: '每小时', daily: '每天', weekly: '每周', manual: '手动' }

// ─── Source creation constants ────────────────────────────────────────────────

const SOURCE_KIND_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: 'hr_company',     label: '人力资源公司'       },
  { value: 'school',         label: '高校就业中心'       },
  { value: 'fair_organizer', label: '招聘会主办方'       },
  { value: 'aggregator',     label: '第三方数据聚合平台' },
  { value: 'manual',         label: '手动录入'          },
]

// ─── API / Webhook / Excel source creation ───────────────────────────────────

type SourceMode = 'api' | 'webhook' | 'excel'

const MODE_OPTIONS: Array<{
  value: SourceMode
  title: string
  desc: string
  icon: typeof GlobeIcon
}> = [
  { value: 'api', title: 'API 直连', desc: '适合招聘平台、ATS、政府/学校开放接口', icon: GlobeIcon },
  { value: 'webhook', title: 'Webhook 推送', desc: '适合对方系统有数据更新时主动推送', icon: LinkIcon },
  { value: 'excel', title: 'Excel / CSV 导入', desc: '适合中小机构、学校、人社批量表格', icon: FileSpreadsheetIcon },
]

interface SourceConnectPanelProps {
  onCreated: (payload: CreateDataSourcePayload) => Promise<PartnerDataSource>
  onCancel: () => void
}

function SourceConnectPanel({ onCreated, onCancel }: SourceConnectPanelProps) {
  const [mode, setMode] = useState<SourceMode>('webhook')
  const [name, setName] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceKind>('hr_company')
  const [endpoint, setEndpoint] = useState('')
  const [authType, setAuthType] = useState<CreateDataSourcePayload['authType']>('bearer')
  const [credential, setCredential] = useState('')
  const [syncFreq, setSyncFrequency] = useState<SyncFrequency>('manual')
  const [created, setCreated] = useState<PartnerDataSource | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim()) { setError('请填写数据源名称'); return }
    if (mode === 'api' && !endpoint.trim()) { setError('API 直连必须填写 Endpoint'); return }
    setSubmitting(true)
    setError('')
    try {
      const result = await onCreated({
        name: name.trim(),
        sourceKind,
        accessMode: mode,
        syncFreq: mode === 'api' ? syncFreq : 'manual',
        endpoint: mode === 'api' ? endpoint.trim() : undefined,
        authType: mode === 'api' ? authType : undefined,
        credential: credential.trim() || undefined,
        description: mode === 'webhook'
          ? '等待外部系统通过 Webhook 推送岗位数据'
          : mode === 'api'
            ? `API 直连：${endpoint.trim()}`
            : 'Excel / CSV 文件导入，支持字段映射和导入预览',
      })
      setCreated(result)
    } catch {
      setError('创建失败，请检查登录状态或稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const copy = (text?: string) => {
    if (!text) return
    void navigator.clipboard?.writeText(text)
  }

  return (
    <Card className="mt-6 p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">新增数据来源</h2>
          <p className="mt-1 text-sm text-gray-500">选择对方最容易配合的方式接入岗位或招聘会展示数据。</p>
        </div>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {MODE_OPTIONS.map((option) => {
          const Icon = option.icon
          const active = mode === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => { setMode(option.value); setCreated(null); setError('') }}
              className={`min-h-[96px] rounded-xl border p-4 text-left transition ${
                active ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-100' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`rounded-lg p-2 ${active ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-500'}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="font-medium text-gray-900">{option.title}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-500">{option.desc}</p>
            </button>
          )
        })}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">数据源名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="h-12 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none" placeholder="例：某企业 ATS Webhook" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">来源类型</label>
              <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as SourceKind)} className="h-12 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none">
                {SOURCE_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {mode === 'api' && (
            <div className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Endpoint</label>
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="h-12 w-full rounded-lg border border-gray-300 px-3 font-mono text-sm focus:border-primary-500 focus:outline-none" placeholder="https://api.example.com/v1/jobs" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">鉴权方式</label>
                  <select value={authType} onChange={(e) => setAuthType(e.target.value as CreateDataSourcePayload['authType'])} className="h-12 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none">
                    <option value="bearer">Bearer Token</option>
                    <option value="api_key">API Key</option>
                    <option value="oauth2">OAuth2</option>
                    <option value="basic">Basic</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">同步频率</label>
                  <select value={syncFreq} onChange={(e) => setSyncFrequency(e.target.value as SyncFrequency)} className="h-12 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none">
                    <option value="hourly">每小时</option>
                    <option value="daily">每天</option>
                    <option value="manual">手动</option>
                    <option value="weekly">每周</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">凭证</label>
                <input value={credential} onChange={(e) => setCredential(e.target.value)} className="h-12 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none" placeholder="只保存到服务端，前端不会回显" type="password" />
              </div>
            </div>
          )}

          {mode === 'webhook' && (
            <div className="space-y-3 rounded-xl border border-purple-100 bg-purple-50/40 p-4">
              <p className="text-sm text-gray-700">系统将生成接收地址和签名密钥。把它交给对方 ATS / 招聘系统，数据更新时由对方主动推送到本平台。</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">自定义密钥（可选）</label>
                <input value={credential} onChange={(e) => setCredential(e.target.value)} className="h-12 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-primary-500 focus:outline-none" placeholder="留空则由系统自动生成" type="password" />
              </div>
              <div className="rounded-lg bg-white px-4 py-3 text-xs text-gray-500">
                签名规则：<span className="font-mono">HMAC-SHA256(secret, timestamp + '.' + rawBody)</span>，请求必须携带 timestamp / nonce / signature。
              </div>
            </div>
          )}

          {mode === 'excel' && (
            <div className="rounded-xl border border-green-100 bg-green-50/40 p-4 text-sm text-gray-700">
              创建 Excel 数据源后，可继续使用下方字段映射、导入预览和待审核流程。Excel 不需要接口凭证。
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" size="md" onClick={onCancel}>取消</Button>
            <Button variant="primary" size="md" onClick={submit} disabled={submitting}>
              {submitting ? '创建中...' : mode === 'webhook' ? '生成接收地址' : mode === 'api' ? '保存 API 连接' : '创建 Excel 数据源'}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5">
          <DatabaseIcon className="h-9 w-9 rounded-full bg-white p-2 text-gray-400" />
          <h3 className="mt-4 font-semibold text-gray-900">接入结果</h3>
          {!created ? (
            <p className="mt-2 text-sm leading-6 text-gray-500">创建后这里会显示数据源 ID、接收地址或配置状态。敏感密钥只显示一次。</p>
          ) : (
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-lg bg-white p-3">
                <div className="text-xs text-gray-400">数据源 ID</div>
                <div className="mt-1 font-mono text-xs text-gray-700">{created.id}</div>
              </div>
              {created.webhookUrl && (() => {
                const fullUrl = resolveWebhookUrl(created.webhookUrl)
                return (
                  <div className="rounded-lg bg-white p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-400">Webhook 接收地址</div>
                      <button type="button" onClick={() => copy(fullUrl)} className="text-xs text-primary-600">复制</button>
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-gray-700">{fullUrl}</div>
                  </div>
                )
              })()}
              {created.webhookSecretOnce && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-orange-700">签名密钥（仅显示一次）</div>
                    <button type="button" onClick={() => copy(created.webhookSecretOnce)} className="flex items-center gap-1 text-xs text-orange-700"><CopyIcon className="h-3 w-3" />复制</button>
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-orange-800">{created.webhookSecretOnce}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-0.5 border-t border-gray-100 pt-4 text-xs text-gray-400">
        <p>· 只接收岗位/招聘会展示字段，不接收简历、候选人、面试、Offer 等招聘闭环数据</p>
        <p>· Webhook/API 凭证只保存在服务端，前端只显示是否已配置</p>
        <p>· 所有导入岗位默认待审核（pending + draft），管理员审核发布后才展示</p>
      </div>
    </Card>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const [sources,    setSources]    = useState<PartnerDataSource[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [excelSource, setExcelSource] = useState<PartnerDataSource | null>(null)
  // Webhook 接入说明抽屉(审计修复:原「查看接入」死按钮)
  const [webhookGuide, setWebhookGuide] = useState<PartnerDataSource | null>(null)

  useEffect(() => {
    let cancelled = false
    getDataSources()
      .then((data) => { if (!cancelled) setSources(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleToggle = (id: string) => {
    toggleDataSource(id).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
    })
  }

  const handleSourceCreated = async (payload: CreateDataSourcePayload) => {
    const newSource = await createDataSource(payload)
    setSources((prev) => {
      const exists = prev.some((s) => s.id === newSource.id)
      return exists ? prev.map((s) => s.id === newSource.id ? newSource : s) : [newSource, ...prev]
    })
    return newSource
  }

  if (loading) {
    return (
      <Page title="数据源管理" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="数据源管理" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <DatabaseIcon className="h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="数据源管理"
      subtitle={`共 ${sources.length} 个数据源`}
      actions={
        !showWizard && (
          <Button
            size="sm"
            variant="primary"
            className="flex items-center gap-1.5"
            onClick={() => setShowWizard(true)}
          >
            <PlusIcon className="h-4 w-4" />
            新增数据来源
          </Button>
        )
      }
    >
      {showWizard && (
        <SourceConnectPanel
          onCreated={handleSourceCreated}
          onCancel={() => setShowWizard(false)}
        />
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['数据源名称', '接入方式', '说明', '同步频率', '最近同步', '连接状态', '成功数', '失败数', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sources.map((s) => {
                const st   = ACCESS_MODE_STYLE[s.accessMode]
                const conn = CONN_MAP[s.connStatus]
                return (
                  <tr key={s.id} className={`hover:bg-gray-50 ${s.connStatus === 'disabled' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      <div className="flex items-center gap-2">
                        <DatabaseIcon className="h-4 w-4 text-gray-400" />
                        {s.name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${st.style}`}>{st.label}</span>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs text-gray-500">
                      <span className={s.connStatus === 'error' ? 'text-red-500' : ''}>{s.description}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{FREQ_LABELS[s.syncFreq]}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{s.lastSyncTime}</td>
                    <td className="px-4 py-3"><StatusBadge status={conn.badge} label={conn.label} /></td>
                    <td className="px-4 py-3 text-center font-medium text-green-600">{s.successCount}</td>
                    <td className="px-4 py-3 text-center font-medium text-red-500">{s.failCount}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        {/* 「测试连接」已移除:后端暂无连通性测试端点,不放死按钮(审计修复) */}
                        {s.accessMode === 'excel' && (
                          <button
                            className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
                            type="button"
                            onClick={() => setExcelSource(s)}
                          >
                            字段映射
                          </button>
                        )}
                        {s.accessMode === 'webhook' && (
                          <button
                            className="rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50"
                            type="button"
                            onClick={() => setWebhookGuide(s)}
                          >
                            查看接入
                          </button>
                        )}
                        <button
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            s.connStatus === 'disabled'
                              ? 'text-green-600 hover:bg-green-50'
                              : 'text-orange-500 hover:bg-orange-50'
                          }`}
                          type="button"
                          onClick={() => handleToggle(s.id)}
                        >
                          {s.connStatus === 'disabled' ? '启用' : '停用'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-gray-400">接入后端后实时展示数据源状态</p>

      {excelSource && (
        <ExcelImportModal
          sourceId={excelSource.id}
          sourceName={excelSource.name}
          onClose={() => setExcelSource(null)}
          onImported={(count) => {
            // TODO: refresh partner jobs list / show toast
            console.info(`Excel 导入完成，共 ${count} 条`)
            setExcelSource(null)
          }}
        />
      )}

      {/* Webhook 接入说明(只读指引;webhookSecret 创建时一次性下发,不再回显) */}
      <Drawer
        open={Boolean(webhookGuide)}
        onClose={() => setWebhookGuide(null)}
        title={webhookGuide ? `Webhook 接入说明 · ${webhookGuide.name}` : 'Webhook 接入说明'}
        size="md"
      >
        {webhookGuide && (
          <div className="space-y-3 text-sm text-gray-700">
            <div>
              <p className="mb-1 text-xs text-gray-400">推送地址(POST)</p>
              <code className="block break-all rounded bg-gray-50 px-3 py-2 font-mono text-xs">
                {`${API_BASE_URL}/sync/webhook?source=${webhookGuide.id}`}
              </code>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
              <p className="mb-1 font-medium text-gray-700">签名要求(请求方实现)</p>
              <p>Header 携带 <code className="font-mono">x-signature</code>(HMAC-SHA256,密钥为创建数据源时下发的 webhookSecret)、
              <code className="font-mono">x-timestamp</code>(5 分钟内有效)与 <code className="font-mono">x-nonce</code>(防重放)。</p>
              <p className="mt-1.5">webhookSecret 仅在创建时下发一次,平台不再回显;如遗失请删除数据源后重建。</p>
            </div>
            <p className="text-xs text-gray-400">payload 字段规范见对接文档;推送数据默认进入待审核,管理员审核通过后才会在终端展示。</p>
          </div>
        )}
      </Drawer>
    </Page>
  )
}
