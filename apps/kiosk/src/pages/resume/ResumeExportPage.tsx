// ============================================================
// ResumeExportPage — 简历导出 / 打印（/resume/export）
//
// 区分三种输出类型：原简历 / 优化版简历 / 诊断报告。
//   - 原简历：来源文件（始终可用）
//   - 优化版简历：仅在用户"采纳建议生成优化版"后出现（state.optimizedGenerated）
//   - 诊断报告：仅在已生成诊断（state.taskId）后出现
//
// 每种输出可：保存到我的简历 / 打印。底部"返回 AI 简历服务"。
//
// 合规：无真实优化文件时使用安全前端占位，不伪造后端成功；
//       不向企业发送任何文件。
// ============================================================

import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY, makePrintParams } from '@ai-job-print/shared'
import { FileTextIcon, PrinterIcon, SaveIcon, SparklesIcon, ClipboardListIcon } from 'lucide-react'

interface ResumeFile {
  name: string
  size: string
  format: string
}

interface OutputItem {
  key: 'original' | 'optimized' | 'report'
  title: string
  hint: string
  fileName: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  badge?: string
}

export function ResumeExportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null

  const rawFile = state?.file as ResumeFile | undefined
  const file: ResumeFile = rawFile ?? { name: '我的简历.pdf', size: '248 KB', format: 'PDF' }

  const baseName = file.name.replace(/\.[^.]+$/, '') || '我的简历'
  const optimizedGenerated = state?.optimizedGenerated === true
  const hasReport = typeof state?.taskId === 'string' || Boolean(state?.report)

  const outputs: OutputItem[] = [
    {
      key: 'original',
      title: '原简历',
      hint: `${file.size} · ${file.format}`,
      fileName: file.name,
      icon: FileTextIcon,
      iconBg: 'bg-primary-50',
      iconColor: 'text-primary-600',
    },
  ]
  if (optimizedGenerated) {
    outputs.push({
      key: 'optimized',
      title: '优化版简历（采纳建议）',
      hint: '已采纳 AI 优化建议整理，打印前请核对最终内容',
      fileName: `${baseName}_优化版.pdf`,
      icon: SparklesIcon,
      iconBg: 'bg-plum-soft',
      iconColor: 'text-plum',
      badge: '采纳建议',
    })
  }
  if (hasReport) {
    outputs.push({
      key: 'report',
      title: '诊断报告',
      hint: '参考评分与可执行建议',
      fileName: `诊断报告_${baseName}.pdf`,
      icon: ClipboardListIcon,
      iconBg: 'bg-warning-bg',
      iconColor: 'text-warning-fg',
    })
  }

  const handleSave = (item: OutputItem) => {
    navigate('/profile', {
      state: {
        savedResume: { name: item.fileName, size: file.size, format: 'PDF' },
        savedKind: item.key,
        savedAt: new Date().toISOString(),
      },
    })
  }

  const handlePrint = (item: OutputItem) => {
    navigate('/print/confirm', {
      state: {
        file: { name: item.fileName, size: file.size, pages: 1 },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="导出与打印"
        subtitle="选择要保存或打印的内容"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            返回
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4">
        {outputs.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.key} className="p-5">
              <div className="flex items-center gap-4">
                <div className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-lg', item.iconBg].join(' ')}>
                  <Icon className={['h-6 w-6', item.iconColor].join(' ')} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-neutral-900">{item.title}</p>
                    {item.badge && (
                      <span className="rounded-full bg-plum-soft px-2 py-0.5 text-xs font-medium text-plum">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-neutral-500">{item.hint}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button size="lg" className="flex items-center justify-center gap-2" onClick={() => handleSave(item)}>
                  <SaveIcon className="h-4 w-4" />
                  保存到我的简历
                </Button>
                {/* 2B 安全收口:本页无真实文件生成链路,禁止假文件进打印;
                    真实打印请走优化页「导出 PDF → 去打印」 */}
                <Button
                  size="lg"
                  variant="secondary"
                  className="flex items-center justify-center gap-2"
                  disabled
                  title="请在优化页使用「导出 PDF」生成真实文件后打印"
                  onClick={() => handlePrint(item)}
                >
                  <PrinterIcon className="h-4 w-4" />
                  打印(走优化导出)
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      <p className="mt-4 text-center text-xs text-neutral-400">
        {COMPLIANCE_COPY.KIOSK_RESUME_NO_SEND_ENTERPRISE}
      </p>

      <div className="mt-4">
        <Button size="lg" variant="secondary" className="w-full" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>
      <div className="h-2" />
    </div>
  )
}
