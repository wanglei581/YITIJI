import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Card, EmptyState } from '@ai-job-print/ui'
import {
  BotIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  FileInputIcon,
  FileTextIcon,
  HelpCircleIcon,
  LogOutIcon,
  PrinterIcon,
  ScanLineIcon,
  SettingsIcon,
  SparklesIcon,
  Trash2Icon,
  UserIcon,
  XIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'

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

const EMPTY_RESUMES: ResumeItem[] = []
const EMPTY_SCANS:   ScanItem[]   = []
const EMPTY_ORDERS:  PrintOrder[] = []
const EMPTY_AI:      AIRecord[]   = []

// ─── Quick nav definition ─────────────────────────────────────────────────

const QUICK_NAV = [
  { icon: FileTextIcon, label: '简历服务', path: '/resume',       bg: 'bg-primary-50', color: 'text-primary-600' },
  { icon: PrinterIcon,  label: '文档打印', path: '/print/upload', bg: 'bg-gray-100',   color: 'text-gray-700'   },
  { icon: ScanLineIcon, label: '材料扫描', path: '/scan/start',   bg: 'bg-emerald-50', color: 'text-emerald-600'},
  { icon: BotIcon,      label: 'AI 助手',  path: '/assistant',    bg: 'bg-violet-50',  color: 'text-violet-600' },
] as const

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
  failed:    { bg: 'bg-red-100',   text: 'text-red-600',   label: '失败'   },
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
  const { isLoggedIn, displayName, logout } = useAuth()

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
    navigate('/print/preview', {
      state: { file: { name: file.name, size: file.size, pages: file.pages ?? 1 } },
    })
  }

  return (
    <div className="flex min-h-full flex-col">

      {/* Toast — fixed, renders outside layout flow */}
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

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div style={{ backgroundColor: '#0B2A5B' }} className="px-6 pb-10 pt-8">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
            <UserIcon className="h-8 w-8 text-white/80" aria-hidden="true" />
          </div>
          <div>
            {isLoggedIn ? (
              <>
                <p className="text-xl font-semibold text-white">{displayName}</p>
                <p className="mt-0.5 text-sm text-blue-200">已登录 · 本次会话身份已识别</p>
              </>
            ) : (
              <>
                <p className="text-xl font-semibold text-white">游客模式</p>
                <p className="mt-0.5 text-sm text-blue-200">登录后可识别身份，后续将接入服务记录</p>
              </>
            )}
          </div>
        </div>
        {isLoggedIn ? (
          <button
            type="button"
            onClick={logout}
            className="mt-4 flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-sm font-medium text-white active:bg-white/20"
          >
            <LogOutIcon className="h-4 w-4" aria-hidden="true" />
            退出登录
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="mt-4 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-primary-700 active:bg-gray-100"
          >
            立即登录
          </button>
        )}
      </div>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="relative z-10 -mt-6 flex flex-1 flex-col gap-6 rounded-t-3xl bg-canvas px-6 pt-7 pb-10">

        {/* 快捷服务 */}
        <section aria-label="快捷服务">
          <h2 className="mb-3 text-sm font-medium text-gray-500">快捷服务</h2>
          <div className="grid grid-cols-4 gap-3">
            {QUICK_NAV.map(({ icon: Icon, label, path, bg, color }) => (
              <button
                key={path}
                type="button"
                onClick={() => navigate(path)}
                className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white shadow-sm active:bg-gray-50"
              >
                <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${bg}`}>
                  <Icon className={`h-6 w-6 ${color}`} aria-hidden="true" />
                </div>
                <span className="text-xs font-medium text-gray-700">{label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── 我的简历 ── */}
        <section>
          <div className="mb-3 flex items-center gap-2 border-b border-gray-100 pb-2">
            <FileTextIcon className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-medium text-gray-500">我的简历</h2>
          </div>
          {resumes.length === 0 ? (
            <EmptyState icon={FileTextIcon} title="暂无简历" description="上传或扫描后的简历将显示在这里" />
          ) : (
            <div className="flex flex-col gap-3">
              {resumes.map((r) => (
                <Card key={r.id} className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                    <FileTextIcon className="h-5 w-5 text-primary-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-400">{r.size} · {r.format} · {formatTime(r.savedAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => printFile(r)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50" title="打印">
                      <PrinterIcon className="h-4 w-4" />
                    </button>
                    <button onClick={() => setResumes((prev) => prev.filter((x) => x.id !== r.id))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500" title="删除">
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
            <EmptyState icon={FileInputIcon} title="暂无扫描文件" description="扫描保存后的 PDF 将显示在这里" />
          ) : (
            <div className="flex flex-col gap-3">
              {scans.map((s) => (
                <Card key={s.id} className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                    <FileInputIcon className="h-5 w-5 text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-400">{s.pages} 页 · {s.size} · {s.format} · {formatTime(s.savedAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => printFile(s)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50" title="打印">
                      <PrinterIcon className="h-4 w-4" />
                    </button>
                    <button onClick={() => setScans((prev) => prev.filter((x) => x.id !== s.id))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500" title="删除">
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
            <EmptyState icon={PrinterIcon} title="暂无订单" description="打印完成后的记录将显示在这里" />
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
                      <p className="text-xs text-gray-400">{o.pages} 页 · {o.copies} 份 · {formatTime(o.completedAt)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
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
            <EmptyState icon={SparklesIcon} title="暂无记录" description="AI简历诊断和优化建议记录将显示在这里" />
          ) : (
            <div className="flex flex-col gap-3">
              {aiRecords.map((a) => (
                <Card key={a.id} className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                    <SparklesIcon className="h-5 w-5 text-primary-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{AI_TYPE_LABELS[a.type] ?? a.label}</p>
                      <span className="rounded bg-primary-50 px-1.5 py-0.5 text-xs font-medium text-primary-600">{a.detail}</span>
                    </div>
                    <p className="truncate text-xs text-gray-400">{a.fileName} · {formatTime(a.createdAt)}</p>
                  </div>
                  <button onClick={() => setAiRecords((prev) => prev.filter((x) => x.id !== a.id))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500" title="删除">
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ── 账户与服务 ── */}
        <section aria-label="账户与服务">
          <h2 className="mb-2 text-sm font-medium text-gray-500">账户与服务</h2>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            <button
              type="button"
              onClick={() => navigate('/assistant')}
              className="flex h-14 w-full items-center gap-3 px-4 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
            >
              <HelpCircleIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
              <span className="flex-1 text-left">帮助中心</span>
              <ChevronRightIcon className="h-4 w-4 text-gray-300" aria-hidden="true" />
            </button>
            <div className="flex h-14 items-center gap-3 px-4">
              <SettingsIcon className="h-5 w-5 text-gray-300" aria-hidden="true" />
              <span className="flex-1 text-sm text-gray-400">账号设置</span>
              <span className="text-xs text-gray-400">即将上线</span>
            </div>
          </div>
        </section>

        <p className="pb-4 text-center text-xs text-gray-400">
          文件可在本机记录中管理，后续将支持自动清理
        </p>
      </div>
    </div>
  )
}
