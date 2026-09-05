import { useEffect, useState } from 'react'
import { Button, Card, Drawer, StatusBadge, LoadingState } from '@ai-job-print/ui'
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
import type { AccessMode, PartnerDataSource, PartnerDataSourceCapabilities, ConnStatus, SyncFrequency, CreateDataSourcePayload, SourceKind } from '../../services/api'
import { API_BASE_URL, ApiHttpError } from '../../services/api/client'
import {
  API_ORIGIN,
  getDataSources,
  toggleDataSource,
  createDataSource,
  archiveDataSource,
  unarchiveDataSource,
} from '../../services/api'
import { formatDateTime, WEBHOOK_SECRET_MIN_LENGTH } from '@ai-job-print/shared'
import { ExcelImportModal } from './ExcelImportModal'
import { omitWebhookSecretOnce } from './omitWebhookSecretOnce'
import { RotateCredentialDrawer } from './RotateCredentialDrawer'
import { usePartnerCapabilities } from '../../services/capabilities'
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog'

/** 使用凭证、因而可以轮换的接入方式。excel/csv/json/manual 没有凭证概念。 */
const CREDENTIAL_ACCESS_MODES: readonly string[] = ['api', 'webhook']

function createSourceErrorMessage(err: unknown): string {
  const code = err instanceof ApiHttpError ? err.code : (err as { code?: string } | undefined)?.code
  const serverMsg = err instanceof ApiHttpError ? err.message.trim() : ''
  if (code === 'WEBHOOK_SECRET_LOW_ENTROPY' || code === 'WEBHOOK_SECRET_TOO_SHORT') {
    return serverMsg || '自定义密钥强度不足，请改用更长的随机密钥或留空由系统生成'
  }
  if (code === 'VALIDATION_FAILED') {
    return serverMsg || '填写内容未通过校验，请检查后重试'
  }
  if (code === 'AUTH_REQUIRED' || code === 'HTTP_401') {
    return '登录已过期，请重新登录后再试'
  }
  if (serverMsg) return serverMsg
  return '创建失败，请检查填写内容或稍后重试'
}

function resolveWebhookUrl(webhookUrl?: string): string {
  if (!webhookUrl) return ''
  if (/^https?:\/\//i.test(webhookUrl)) return webhookUrl
  return `${API_ORIGIN}${webhookUrl}`
}

// ─── Display maps ─────────────────────────────────────────────────────────────

// 接入方式(AccessMode):描述"用什么方式拉取数据"。
// sourceKind(数据由谁提供)留待 B1 阶段加入列与筛选。
const ACCESS_MODE_STYLE: Record<AccessMode, { label: string; style: string }> = {
  api:     { label: 'API',     style: 'bg-info-bg text-info-fg'     },
  excel:   { label: 'Excel',   style: 'bg-success-bg text-success-fg'   },
  csv:     { label: 'CSV',     style: 'bg-success-bg text-success-fg'   },
  json:    { label: 'JSON',    style: 'bg-success-bg text-success-fg'   },
  webhook: { label: 'Webhook', style: 'bg-purple-50 text-purple-600' },
  manual:  { label: '手动',    style: 'bg-neutral-100 text-neutral-600'    },
}
const CONN_MAP: Record<ConnStatus, { badge: 'success' | 'error' | 'default'; label: string }> = {
  connected: { badge: 'success', label: '已连接'  },
  error:     { badge: 'error',   label: '连接异常' },
  disabled:  { badge: 'default', label: '已停用'  },
}
const FREQ_LABELS: Record<SyncFrequency, string> = { realtime: '实时', hourly: '每小时', daily: '每天', weekly: '每周', manual: '手动' }

// ─── Source creation constants ────────────────────────────────────────────────

const SOURCE_KIND_OPTIONS: { value: SourceKind; label: string }[] = [
  { value: 'job_platform',   label: '线上招聘平台'         },
  { value: 'hr_company',     label: '人力资源公司'       },
  { value: 'school',         label: '高校就业中心'       },
  { value: 'fair_organizer', label: '招聘会主办方'       },
  { value: 'aggregator',     label: '第三方数据聚合平台' },
  { value: 'manual',         label: '手动录入'          },
]

// ─── API / Webhook / Excel source creation ───────────────────────────────────

type SourceMode = 'api' | 'webhook' | 'excel'

/**
 * 走「上传文件 + 字段映射」这条导入流程的接入方式。
 *
 * 判据取自服务端:`jobs-excel.service.ts` 的 preview / confirm 都放行
 * `['excel','csv','json']`,而真正的解析器 `partner-import-file.ts`
 * 只认 `.xlsx` 与 `.csv`。所以这里**只列 excel 与 csv**:
 *
 *   - 漏掉 csv 的代价(修复前的实际状态):后端完全支持 CSV,但本页把「字段映射」
 *     按钮只发给 `accessMode === 'excel'` 的源 —— 一个 csv 源建出来之后
 *     在控制台上没有任何入口,运营只能干瞪眼。
 *   - 把 json 加进来的代价:后端没有 JSON 解析器,点进去必然失败。
 *     那属于伪造能力,比少一个入口更糟。json 要能用,得先有解析器。
 */
const FILE_IMPORT_ACCESS_MODES: readonly string[] = ['excel', 'csv']

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
  capabilities: PartnerDataSourceCapabilities
  onCreated: (payload: CreateDataSourcePayload) => Promise<PartnerDataSource>
  onCancel: () => void
}

function SourceConnectPanel({ capabilities, onCreated, onCancel }: SourceConnectPanelProps) {
  const availableModes = MODE_OPTIONS.filter((option) => capabilities.allowedAccessModes.includes(option.value))
  const availableSourceKinds = SOURCE_KIND_OPTIONS.filter((option) => capabilities.allowedSourceKinds.includes(option.value))
  const [mode, setMode] = useState<SourceMode>(() => availableModes[0]?.value ?? 'excel')
  const [name, setName] = useState('')
  const [sourceKind, setSourceKind] = useState<SourceKind>(capabilities.defaultSourceKind)
  const [endpoint, setEndpoint] = useState('')
  const [authType, setAuthType] = useState<CreateDataSourcePayload['authType']>('bearer')
  const [credential, setCredential] = useState('')
  const [syncFreq, setSyncFrequency] = useState<SyncFrequency>('manual')
  const [created, setCreated] = useState<PartnerDataSource | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) { setError('请填写数据源名称'); return }
    if (mode === 'api' && !endpoint.trim()) { setError('API 直连必须填写 Endpoint'); return }
    if (mode === 'webhook' && credential.trim() && credential.trim().length < WEBHOOK_SECRET_MIN_LENGTH) {
      setError(`自定义 Webhook 密钥至少 ${WEBHOOK_SECRET_MIN_LENGTH} 位；更短的密钥可被离线撞库，推荐留空由系统生成`)
      return
    }
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
    } catch (err) {
      setError(createSourceErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const copy = (text?: string) => {
    if (!text) return
    void navigator.clipboard?.writeText(text)
  }

  const copySecret = (text?: string) => {
    if (!text) return
    const promise = navigator.clipboard?.writeText(text)
    const markCopied = () => {
      setCopied('secret')
      setTimeout(() => setCopied((prev) => (prev === 'secret' ? null : prev)), 2000)
    }
    // 2026-08-11（CLAUDE.md §9）：原实现在 Clipboard API 不可用时直接 markCopied()，
    // 复制失败也吞掉——**没有任何复制动作却标成「已复制 ✓」**。
    // webhookSecret 是一次性明文（创建后 GET 不再回显），用户据此以为已存好，
    // 关掉弹窗密钥就永久丢失。现在失败时明确提示手动复制。
    if (promise) {
      promise.then(markCopied).catch(() => setCopied('secret-failed'))
    } else {
      setCopied('secret-failed')
    }
  }

  return (
    <Card className="mt-6 p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">新增数据来源</h2>
          <p className="mt-1 text-sm text-neutral-500">选择对方最容易配合的方式接入岗位或招聘会展示数据。</p>
        </div>
        <button type="button" onClick={onCancel} className="text-neutral-400 hover:text-neutral-600">
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {availableModes.map((option) => {
          const Icon = option.icon
          const active = mode === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => { setMode(option.value); setCreated(null); setError('') }}
              className={`min-h-[96px] rounded-xl border p-4 text-left transition ${
                active ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-100' : 'border-neutral-200 bg-surface hover:border-neutral-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`rounded-lg p-2 ${active ? 'bg-primary-100 text-primary-600' : 'bg-neutral-100 text-neutral-500'}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="font-medium text-neutral-900">{option.title}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-neutral-500">{option.desc}</p>
            </button>
          )
        })}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">数据源名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none" placeholder="例：某企业 ATS Webhook" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-700">来源类型</label>
              <select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as SourceKind)} className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none">
                {availableSourceKinds.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {mode === 'api' && (
            <div className="space-y-4 rounded-xl border border-info/20 bg-info-bg/40 p-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">Endpoint</label>
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="h-12 w-full rounded-lg border border-neutral-300 px-3 font-mono text-sm focus:border-primary-500 focus:outline-none" placeholder="https://api.example.com/v1/jobs" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">鉴权方式</label>
                  <select value={authType} onChange={(e) => setAuthType(e.target.value as CreateDataSourcePayload['authType'])} className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none">
                    <option value="bearer">Bearer Token</option>
                    <option value="api_key">API Key</option>
                    <option value="oauth2">OAuth2</option>
                    <option value="basic">Basic</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-neutral-700">同步频率</label>
                  <select value={syncFreq} onChange={(e) => setSyncFrequency(e.target.value as SyncFrequency)} className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none">
                    <option value="hourly">每小时</option>
                    <option value="daily">每天</option>
                    <option value="manual">手动</option>
                    <option value="weekly">每周</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">凭证</label>
                <input value={credential} onChange={(e) => setCredential(e.target.value)} className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none" placeholder="只保存到服务端，前端不会回显" type="password" />
              </div>
            </div>
          )}

          {mode === 'webhook' && (
            <div className="space-y-3 rounded-xl border border-purple-100 bg-purple-50/40 p-4">
              <p className="text-sm text-neutral-700">系统将生成接收地址和签名密钥。把它交给对方 ATS / 招聘系统，数据更新时由对方主动推送到本平台。</p>
              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-700">自定义密钥（可选）</label>
                <input value={credential} onChange={(e) => setCredential(e.target.value)} className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none" placeholder={`留空则由系统自动生成（自填至少 ${WEBHOOK_SECRET_MIN_LENGTH} 位）`} type="password" />
              </div>
              <div className="rounded-lg bg-surface px-4 py-3 text-xs text-neutral-500">
                签名规则：<span className="font-mono">HMAC-SHA256(secret, timestamp + '.' + rawBody)</span>，请求必须携带 timestamp / nonce / signature。
              </div>
            </div>
          )}

          {mode === 'excel' && (
            <div className="rounded-xl border border-success/20 bg-success-bg/40 p-4 text-sm text-neutral-700">
              创建 Excel 数据源后，可继续使用下方字段映射、导入预览和待审核流程。Excel 不需要接口凭证。
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" size="md" onClick={onCancel}>取消</Button>
            <Button variant="primary" size="md" onClick={submit} disabled={submitting}>
              {submitting ? '创建中...' : mode === 'webhook' ? '生成接收地址' : mode === 'api' ? '保存 API 连接' : '创建 Excel 数据源'}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-5">
          <DatabaseIcon className="h-9 w-9 rounded-full bg-surface p-2 text-neutral-400" />
          <h3 className="mt-4 font-semibold text-neutral-900">接入结果</h3>
          {!created ? (
            <p className="mt-2 text-sm leading-6 text-neutral-500">创建后这里会显示数据源 ID、接收地址或配置状态。敏感密钥只显示一次。</p>
          ) : (
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-lg bg-surface p-3">
                <div className="text-xs text-neutral-400">数据源 ID</div>
                <div className="mt-1 font-mono text-xs text-neutral-700">{created.id}</div>
              </div>
              {created.activationManagedBy === 'admin' && (
                <div className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs leading-5 text-warning-fg">
                  通道已保存但尚未启用。管理员完成来源、地址、凭证和字段映射检查后才能接收或拉取数据。
                </div>
              )}
              {created.webhookUrl && (() => {
                const fullUrl = resolveWebhookUrl(created.webhookUrl)
                return (
                  <div className="rounded-lg bg-surface p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-neutral-400">Webhook 接收地址</div>
                      <button type="button" onClick={() => copy(fullUrl)} className="text-xs text-primary-600">复制</button>
                    </div>
                    <div className="mt-1 break-all font-mono text-xs text-neutral-700">{fullUrl}</div>
                  </div>
                )
              })()}
              {created.webhookSecretOnce && (
                <div className="rounded-lg border border-warning/30 bg-warning-bg p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-warning-fg">签名密钥（仅显示一次）</div>
                    <button type="button" onClick={() => copySecret(created.webhookSecretOnce)} className="flex items-center gap-1 text-xs text-warning-fg"><CopyIcon className="h-3 w-3" />{copied === 'secret' ? '已复制 ✓' : copied === 'secret-failed' ? '复制失败，请手动选中' : '复制'}</button>
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-warning-fg">{created.webhookSecretOnce}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-0.5 border-t border-neutral-100 pt-4 text-xs text-neutral-400">
        <p>· 只接收岗位/招聘会展示字段，不接收简历、候选人、面试、Offer 等招聘闭环数据</p>
        <p>· Webhook/API 凭证只保存在服务端，前端只显示是否已配置</p>
        <p>· 所有导入岗位默认待审核（pending + draft），管理员审核发布后才展示</p>
      </div>
    </Card>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const { capabilities } = usePartnerCapabilities()
  const [sources,    setSources]    = useState<PartnerDataSource[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(false)
  const [showWizard, setShowWizard] = useState(false)
  const [excelSource, setExcelSource] = useState<PartnerDataSource | null>(null)
  // Webhook 接入说明抽屉(审计修复:原「查看接入」死按钮)
  const [webhookGuide, setWebhookGuide] = useState<PartnerDataSource | null>(null)
  const [togglingId,   setTogglingId]   = useState<string | null>(null)
  const [toggleError,  setToggleError]  = useState<string | null>(null)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  // 凭证轮换(修复"密钥丢了只能删源重建"——而平台从不做物理删除)
  const [rotateTarget, setRotateTarget] = useState<PartnerDataSource | null>(null)
  const [archivingId,  setArchivingId]  = useState<string | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<PartnerDataSource | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<PartnerDataSource | null>(null)

  const fetchSources = () =>
    getDataSources()
      .then((data) => {
        setSources(data)
        setError(false)
      })
      .catch(() => setError(true))

  useEffect(() => {
    let cancelled = false
    getDataSources()
      .then((data) => {
        if (cancelled) return
        setSources(data)
        setError(false)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleToggle = (id: string) => {
    if (togglingId) return
    setTogglingId(id)
    setConfirmToggle(null)
    setToggleError(null)
    toggleDataSource(id)
      .then((updated) => {
        setSources((prev) => prev.map((s) => s.id === id ? updated : s))
      })
      .catch(() => {
        setToggleError(id)
        setTimeout(() => setToggleError((prev) => (prev === id ? null : prev)), 3000)
      })
      .finally(() => {
        setTogglingId(null)
      })
  }

  /**
   * 归档 / 取消归档。
   *
   * 归档是本平台数据源的退役路径——**没有物理删除**：数据源上挂着同步日志、导入批次和
   * 字段映射规则（非空外键），还挂着已导入岗位/招聘会的来源链，硬删会毁掉合规要求留存的记录。
   * 详见服务端 JobsPartnerService.archivePartnerDataSource 的注释。
   */
  const handleArchive = (source: PartnerDataSource, archived: boolean) => {
    if (archivingId) return
    setArchivingId(source.id)
    setArchiveError(null)
    setConfirmArchive(null)
    const run = archived ? archiveDataSource(source.id) : unarchiveDataSource(source.id)
    run
      .then((updated) => {
        setSources((prev) => prev.map((s) => s.id === source.id ? updated : s))
      })
      .catch(() => {
        setArchiveError(source.id)
        setTimeout(() => setArchiveError((prev) => (prev === source.id ? null : prev)), 3000)
      })
      .finally(() => setArchivingId(null))
  }

  const handleSourceCreated = async (payload: CreateDataSourcePayload) => {
    const newSource = await createDataSource(payload)
    // 一次性明文密钥只留在 SourceConnectPanel 自己的 `created` state 里。
    const listSafe = omitWebhookSecretOnce(newSource)
    setSources((prev) => {
      const exists = prev.some((s) => s.id === listSafe.id)
      return exists ? prev.map((s) => s.id === listSafe.id ? listSafe : s) : [listSafe, ...prev]
    })
    return newSource
  }

  if (loading) {
    return (
      <Page title="数据源管理" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="数据源管理" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <DatabaseIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
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
            disabled={!capabilities}
            title={capabilities ? undefined : '正在确认本机构接入能力，确认后再新增'}
            onClick={() => { if (capabilities) setShowWizard(true) }}
          >
            <PlusIcon className="h-4 w-4" />
            新增数据来源
          </Button>
        )
      }
    >
      {showWizard && capabilities && (
        <SourceConnectPanel
          capabilities={capabilities}
          onCreated={handleSourceCreated}
          onCancel={() => setShowWizard(false)}
        />
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['数据源名称', '接入方式', '说明', '同步频率', '最近同步', '连接状态', '成功数', '失败数', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {sources.map((s) => {
                const st   = ACCESS_MODE_STYLE[s.accessMode]
                const conn = CONN_MAP[s.connStatus]
                return (
                  <tr key={s.id} className={`hover:bg-neutral-50 ${s.connStatus === 'disabled' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3 font-medium text-neutral-800">
                      <div className="flex items-center gap-2">
                        <DatabaseIcon className="h-4 w-4 text-neutral-400" />
                        {s.name}
                        {s.archived && (
                          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600">
                            已归档
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${st.style}`}>{st.label}</span>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs text-neutral-500">
                      <span className={s.connStatus === 'error' ? 'text-error-fg' : ''}>{s.description}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{FREQ_LABELS[s.syncFreq]}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{formatDateTime(s.lastSyncTime)}</td>
                    <td className="px-4 py-3"><StatusBadge dot status={conn.badge} label={s.activationManagedBy === 'admin' && s.connStatus === 'disabled' ? '待管理员启用' : conn.label} /></td>
                    <td className="px-4 py-3 text-center font-medium text-success-fg">{s.successCount}</td>
                    <td className="px-4 py-3 text-center font-medium text-error-fg">{s.failCount}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-2">
                          {/* 「测试连接」已移除:后端暂无连通性测试端点,不放死按钮(审计修复) */}
                          {FILE_IMPORT_ACCESS_MODES.includes(s.accessMode) && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
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
                          {/* 轮换密钥：凭证丢失/泄露的唯一补救路径。
                              归档源不给轮换入口——已经不进数据了，轮换没有意义。 */}
                          {CREDENTIAL_ACCESS_MODES.includes(s.accessMode) && !s.archived && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                              type="button"
                              onClick={() => setRotateTarget(s)}
                            >
                              轮换密钥
                            </button>
                          )}
                          {s.archived ? (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-success-fg hover:bg-success-bg disabled:cursor-not-allowed disabled:opacity-50"
                              type="button"
                              disabled={archivingId === s.id}
                              onClick={() => handleArchive(s, false)}
                            >
                              {archivingId === s.id ? '处理中…' : '取消归档'}
                            </button>
                          ) : (
                            <>
                              {s.activationManagedBy === 'admin' ? (
                                <span
                                  className="rounded bg-warning-bg px-2 py-1 text-xs font-medium text-warning-fg"
                                  title="紧急停止接收请归档，不会下架已发布内容。启停由管理员管理。"
                                >
                                  {s.connStatus === 'disabled' ? '等待管理员启用' : '管理员管理启停'}
                                </span>
                              ) : <button
                                className={`rounded px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                                  s.connStatus === 'disabled'
                                    ? 'text-success-fg hover:bg-success-bg'
                                    : 'text-warning-fg hover:bg-warning-bg'
                                }`}
                                type="button"
                                disabled={togglingId === s.id}
                                onClick={() => setConfirmToggle(s)}
                              >
                                {togglingId === s.id ? '处理中…' : s.connStatus === 'disabled' ? '启用' : '停用'}
                              </button>}
                              <button
                                className="rounded px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                                type="button"
                                disabled={archivingId === s.id}
                                onClick={() => setConfirmArchive(s)}
                              >
                                {archivingId === s.id ? '处理中…' : '归档'}
                              </button>
                            </>
                          )}
                        </div>
                        {toggleError === s.id && (
                          <span className="text-xs text-error-fg">操作失败，请重试</span>
                        )}
                        {archiveError === s.id && (
                          <span className="text-xs text-error-fg">归档操作失败，请重试</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {importNotice && (
        <p className="mt-3 text-xs text-success-fg" role="status">
          {importNotice}
        </p>
      )}

      {excelSource && (
        <ExcelImportModal
          sourceId={excelSource.id}
          sourceName={excelSource.name}
          onClose={() => setExcelSource(null)}
          onImported={(count) => {
            setImportNotice(`文件导入完成，共 ${count} 条（默认待审核，管理员发布后才会在终端展示）`)
            void fetchSources()
          }}
        />
      )}

      {/* Webhook 接入说明(只读指引;密钥不回显,遗失走轮换而不是删除——平台不做物理删除) */}
      <Drawer
        open={Boolean(webhookGuide)}
        onClose={() => setWebhookGuide(null)}
        title={webhookGuide ? `Webhook 接入说明 · ${webhookGuide.name}` : 'Webhook 接入说明'}
        size="md"
      >
        {webhookGuide && (
          <div className="space-y-3 text-sm text-neutral-700">
            <div>
              <p className="mb-1 text-xs text-neutral-400">推送地址(POST)</p>
              <code className="block break-all rounded bg-neutral-50 px-3 py-2 font-mono text-xs">
                {`${API_BASE_URL}/sync/webhook?source=${webhookGuide.id}`}
              </code>
            </div>
            <div className="rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600">
              <p className="mb-1 font-medium text-neutral-700">签名要求(请求方实现)</p>
              <p>Header 携带 <code className="font-mono">x-webhook-signature</code>(HMAC-SHA256,密钥为本数据源的 webhookSecret)、
              <code className="font-mono">x-webhook-timestamp</code>(5 分钟内有效)与 <code className="font-mono">x-webhook-nonce</code>(防重放)。</p>
              <p className="mt-1.5">
                密钥只在下发那一次显示,平台不保存明文也不再回显。
                <strong className="font-medium text-neutral-700">如遗失,请用列表里的「轮换密钥」重新生成</strong>,不需要也无法删除数据源重建。
              </p>
              <p className="mt-1.5 text-warning-fg">
                注意:轮换会让旧密钥<strong className="font-medium">立即失效</strong>,请先和对接方约好切换时间。
                API/Webhook 由管理员启停；若密钥被盗、需要立刻停止接收推送，请用列表里的「归档」（不会下架已发布内容）。
              </p>
              {webhookGuide.credentialRotatedAt && (
                <p className="mt-1.5 text-neutral-400">
                  最近一次密钥下发/轮换:{new Date(webhookGuide.credentialRotatedAt).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
            <p className="text-xs text-neutral-400">payload 字段规范见对接文档;推送数据默认进入待审核,管理员审核通过后才会在终端展示。</p>
          </div>
        )}
      </Drawer>

      {/* 轮换密钥确认 + 新密钥一次性展示 */}
      <RotateCredentialDrawer
        source={rotateTarget}
        onClose={() => setRotateTarget(null)}
        onRotated={() => { void fetchSources() }}
      />

      {/* 归档确认。文案只写系统真正会做的事:停止进数据、保留记录、可撤销;
          不写"删除",因为平台不做物理删除(见 handleArchive 注释)。 */}
      <Drawer
        open={Boolean(confirmArchive)}
        onClose={() => setConfirmArchive(null)}
        title={confirmArchive ? `归档数据源 · ${confirmArchive.name}` : '归档数据源'}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="outline" size="md" onClick={() => setConfirmArchive(null)}>取消</Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => confirmArchive && handleArchive(confirmArchive, true)}
            >
              确认归档
            </Button>
          </div>
        }
      >
        {confirmArchive && (
          <div className="space-y-3 text-sm text-neutral-700">
            <p>归档后，这个数据源会：</p>
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-neutral-600">
              <li>停止接收 Webhook 推送、停止 API 拉取（同时置为停用）</li>
              <li>保留同步日志、导入批次和字段映射规则，历史可追溯</li>
              <li>保留已导入内容的来源信息，岗位/招聘会详情仍能显示来源机构</li>
            </ul>
            <p className="rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600">
              <strong className="font-medium text-neutral-700">已发布的岗位/招聘会不会被自动下架。</strong>
              需要下架已发布内容，请另行联系管理员执行批量下架。
            </p>
            <p className="text-xs text-neutral-400">归档可以撤销：在列表里点「取消归档」即可，但不会自动恢复启用。</p>
          </div>
        )}
      </Drawer>

      <ConfirmActionDialog
        open={confirmToggle !== null}
        title={confirmToggle?.connStatus === 'disabled' ? '确认启用数据源' : '确认停用数据源'}
        description={confirmToggle
          ? confirmToggle.connStatus === 'disabled'
            ? `启用「${confirmToggle.name}」后将恢复该来源的采集（仍受管理员启停策略约束）。`
            : `停用「${confirmToggle.name}」后将停止采集。已发布内容不会自动下架。`
          : ''}
        confirmLabel={confirmToggle?.connStatus === 'disabled' ? '确认启用' : '确认停用'}
        busy={togglingId !== null}
        onCancel={() => setConfirmToggle(null)}
        onConfirm={() => confirmToggle && handleToggle(confirmToggle.id)}
      />
    </Page>
  )
}
