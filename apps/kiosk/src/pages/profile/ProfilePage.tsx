import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, EmptyState, PageHeader } from '@ai-job-print/ui'
import { useMemberAuth } from '../../auth/MemberAuthContext'
import {
  CheckCircleIcon,
  FileInputIcon,
  FileTextIcon,
  PrinterIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'

// ─── Data types ────────────────────────────────────────────────────────────

interface ResumeItem {
  id: string
  name: string
  size: string
  format: string
  savedAt: string
}

interface ScanItem {
  id: string
  name: string
  size: string
  pages: number
  format: string
  savedAt: string
}

interface PrintOrder {
  id: string
  fileName: string
  pages: number
  copies: number
  status: 'done' | 'failed' | 'cancelled'
  completedAt: string
}

interface AIRecord {
  id: string
  type: 'diagnosis' | 'optimization' | 'scan-ocr'
  label: string
  detail: string
  fileName: string
  createdAt: string
}

// ─── Incoming state from other pages ──────────────────────────────────────

interface IncomingState {
  savedFile?: { name: string; size: string; pages: number; format: string }
  savedAt?: string
  savedResume?: { name: string; size: string; format: string }
  savedResumeAdvice?: {
    file?: { name: string; size: string; format: string }
    suggestions: unknown[]
    savedAt: string
  }
}

// 初始列表均为空；实际数据通过页面跳转 location.state 传入（从简历/打印/AI 流程跳回）
const EMPTY_RESUMES: ResumeItem[] = []
const EMPTY_SCANS:   ScanItem[]   = []
const EMPTY_ORDERS:  PrintOrder[] = []
const EMPTY_AI:      AIRecord[]   = []

// ─── Utilities ────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  const d = new Date(iso)
  const M = d.getMonth() + 1
  const D = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${M}月${D}日 ${h}:${m}`
}

const STATUS_STYLES = {
  done:      { bg: 'bg-green-100', text: 'text-green-700', label: '已完成' },
  failed:    { bg: 'bg-red-100',   text: 'text-red-600',   label: '失败' },
  cancelled: { bg: 'bg-gray-100',  text: 'text-gray-500',  label: '已取消' },
}

const AI_TYPE_LABELS = {
  diagnosis:    'AI 简历诊断',
  optimization: '优化建议',
  'scan-ocr':   '扫描识别',
}

// ─── Component ────────────────────────────────────────────────────────────

export function ProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const incoming = (location.state ?? {}) as IncomingState
  const { isAuthenticated, user, logout } = useMemberAuth()

  // ── Lists ────────────────────────────────────────────────────
  const [resumes, setResumes] = useState<ResumeItem[]>(() => {
    if (incoming.savedResume) {
      const item: ResumeItem = {
        id: `new-${Date.now()}`,
        ...incoming.savedResume,
        savedAt: incoming.savedAt ?? new Date().toISOString(),
      }
      return [item, ...EMPTY_RESUMES]
    }
    return EMPTY_RESUMES
  })

  const [scans, setScans] = useState<ScanItem[]>(() => {
    if (incoming.savedFile) {
      const f = incoming.savedFile
      const item: ScanItem = {
        id: `new-${Date.now()}`,
        name: f.name,
        size: f.size,
        pages: f.pages,
        format: f.format,
        savedAt: incoming.savedAt ?? new Date().toISOString(),
      }
      return [item, ...EMPTY_SCANS]
    }
    return EMPTY_SCANS
  })

  const [orders] = useState<PrintOrder[]>(EMPTY_ORDERS)

  const [aiRecords, setAiRecords] = useState<AIRecord[]>(() => {
    if (incoming.savedResumeAdvice) {
      const adv = incoming.savedResumeAdvice
      const item: AIRecord = {
        id: `new-${Date.now()}`,
        type: 'optimization',
        label: '优化建议',
        detail: `${adv.suggestions.length} 条建议`,
        fileName: adv.file?.name ?? '简历',
        createdAt: adv.savedAt,
      }
      return [item, ...EMPTY_AI]
    }
    return EMPTY_AI
  })

  // ── Toast ────────────────────────────────────────────────────
  const [toastMsg, setToastMsg] = useState<string | null>(() => {
    if (incoming.savedResume) return '简历已保存'
    if (incoming.savedFile) return '扫描文件已保存'
    if (incoming.savedResumeAdvice) return '优化建议已保存'
    return null
  })

  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3500)
    return () => clearTimeout(t)
  }, [toastMsg])

  // ── Handlers ─────────────────────────────────────────────────
  const printFile = (file: { name: string; size: string; pages?: number }) => {
    // 跳到打印设置页（/print/preview），让用户自行设置参数，而不是跳到确认页绕过参数设置
    navigate('/print/preview', {
      state: {
        file: { name: file.name, size: file.size, pages: file.pages ?? 1 },
      },
    })
  }

  return (
    <div className="relative flex min-h-full flex-col p-6">
      <PageHeader title="我的记录" subtitle="记录 · 订单 · 文件" />

      {/* 账号栏 */}
      {isAuthenticated && user ? (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-primary-50 px-4 py-2.5">
          <span className="text-sm text-neutral-700">
            已登录 · <span className="font-medium">{user.phoneMasked}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void logout()
            }}
          >
            退出登录
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-4 py-2.5">
          <span className="text-xs text-gray-400">游客模式 · 当前记录仅保存在本设备，登录后可跨设备查看</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/login', { state: { from: '/profile' } })}
          >
            登录
          </Button>
        </div>
      )}

      {/* 保存成功 toast */}
      {toastMsg && (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-green-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          <CheckCircleIcon className="h-4 w-4 shrink-0" />
          {toastMsg}
          <button
            onClick={() => setToastMsg(null)}
            className="ml-1 rounded-full p-0.5 hover:bg-green-500"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="mt-6 flex flex-1 flex-col gap-6">
        {/* ── 我的简历 ── */}
        <section>
          <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2">
            <FileTextIcon className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-medium text-gray-500">我的简历</h2>
          </div>
          {resumes.length === 0 ? (
            <EmptyState
              icon={FileTextIcon}
              title="暂无简历"
              description="上传或扫描后的简历将显示在这里"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {resumes.map((r) => (
                <Card key={r.id} className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                    <FileTextIcon className="h-5 w-5 text-primary-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-400">
                      {r.size} · {r.format} · {formatTime(r.savedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => printFile(r)}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                      title="打印"
                    >
                      <PrinterIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setResumes((prev) => prev.filter((x) => x.id !== r.id))}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title="删除"
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── 扫描文件 ── */}
        <section>
          <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2">
            <FileInputIcon className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-medium text-gray-500">扫描文件</h2>
          </div>
          {scans.length === 0 ? (
            <EmptyState
              icon={FileInputIcon}
              title="暂无扫描文件"
              description="扫描保存后的 PDF 将显示在这里"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {scans.map((s) => (
                <Card key={s.id} className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                    <FileInputIcon className="h-5 w-5 text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400">
                      {s.pages} 页 · {s.size} · {s.format} · {formatTime(s.savedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => printFile(s)}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                      title="打印"
                    >
                      <PrinterIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setScans((prev) => prev.filter((x) => x.id !== s.id))}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title="删除"
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── 打印订单 ── */}
        <section>
          <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2">
            <PrinterIcon className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-medium text-gray-500">打印订单</h2>
          </div>
          {orders.length === 0 ? (
            <EmptyState
              icon={PrinterIcon}
              title="暂无订单"
              description="打印完成后的记录将显示在这里"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {orders.map((o) => {
                const s = STATUS_STYLES[o.status]
                return (
                  <Card key={o.id} className="flex items-center gap-4 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                      <PrinterIcon className="h-5 w-5 text-gray-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{o.fileName}</p>
                      <p className="text-xs text-gray-400">
                        {o.pages} 页 · {o.copies} 份 · {formatTime(o.completedAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
                    >
                      {s.label}
                    </span>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {/* ── AI 服务记录 ── */}
        <section>
          <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2">
            <SparklesIcon className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-medium text-gray-500">AI 服务记录</h2>
          </div>
          {aiRecords.length === 0 ? (
            <EmptyState
              icon={SparklesIcon}
              title="暂无记录"
              description="AI简历诊断和优化建议记录将显示在这里"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {aiRecords.map((a) => (
                <Card key={a.id} className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                    <SparklesIcon className="h-5 w-5 text-primary-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        {AI_TYPE_LABELS[a.type] ?? a.label}
                      </p>
                      <span className="rounded bg-primary-50 px-1.5 py-0.5 text-xs font-medium text-primary-600">
                        {a.detail}
                      </span>
                    </div>
                    <p className="truncate text-xs text-gray-400">
                      {a.fileName} · {formatTime(a.createdAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => setAiRecords((prev) => prev.filter((x) => x.id !== a.id))}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    title="删除"
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* 合规说明 */}
        <p className="pb-8 text-center text-xs text-gray-400">
          文件可在本机记录中管理，后续将支持自动清理
        </p>
      </div>
    </div>
  )
}
