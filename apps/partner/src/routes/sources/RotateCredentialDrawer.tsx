import { useEffect, useState } from 'react'
import { Button, Drawer } from '@ai-job-print/ui'
import { AlertTriangleIcon, CopyIcon } from 'lucide-react'
import type { PartnerDataSource, PartnerDataSourceCredentialRotationResult } from '../../services/api'
import { rotateDataSourceCredential } from '../../services/api'

/**
 * 凭证轮换抽屉。
 *
 * 为什么单独成文件：`sources/index.tsx` 已经 560+ 行（CLAUDE.md §8 的"500 行以上新增功能
 * 前必须评估拆分"），而本抽屉是自成一体的一次性密钥交付流程，与列表页没有共享状态。
 * 同目录的 ExcelImportModal 也是同样的拆法。
 *
 * 安全口径（CLAUDE.md §12 / §18）：
 *   - 新密钥只在轮换响应里出现一次，本组件只把它放在 React state 里显示，
 *     **不写 localStorage、不写 URL、不打 console**；抽屉关闭即从内存丢弃。
 *   - 关闭前会要求用户确认已保存，避免重演"以为复制成功其实没有"的老问题。
 */

interface RotateCredentialDrawerProps {
  source: PartnerDataSource | null
  onClose: () => void
  onRotated: () => void
}

type Phase = 'confirm' | 'done'

export function RotateCredentialDrawer({ source, onClose, onRotated }: RotateCredentialDrawerProps) {
  const [phase, setPhase] = useState<Phase>('confirm')
  const [credential, setCredential] = useState('')
  const [result, setResult] = useState<PartnerDataSourceCredentialRotationResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  // 每次切换目标数据源都重置，避免把上一个源的新密钥残留到下一个抽屉里。
  useEffect(() => {
    setPhase('confirm')
    setCredential('')
    setResult(null)
    setSubmitting(false)
    setError('')
    setCopied(null)
    setAcknowledged(false)
  }, [source?.id])

  if (!source) {
    return <Drawer open={false} onClose={onClose} title="轮换凭证"><div /></Drawer>
  }

  const isWebhook = source.accessMode === 'webhook'
  const isApi = source.accessMode === 'api'

  const submit = async () => {
    if (isApi && !credential.trim()) {
      setError('API 数据源必须填写新的凭证：上游 token 只能由贵机构从来源平台取得，平台无法代为签发')
      return
    }
    if (credential.trim() && credential.trim().length < 8) {
      setError('自定义密钥至少 8 位')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const rotated = await rotateDataSourceCredential(
        source.id,
        credential.trim() ? { credential: credential.trim() } : {},
      )
      setResult(rotated)
      setPhase('done')
      setCredential('')
      onRotated()
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(
        code === 'CREDENTIAL_REQUIRED'
          ? 'API 数据源必须提供新的凭证'
          : code === 'DATA_SOURCE_HAS_NO_CREDENTIAL'
            ? '该接入方式不使用凭证，无需轮换'
            : '轮换失败，请检查登录状态或稍后重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const copySecret = () => {
    const secret = result?.webhookSecretOnce
    if (!secret) return
    const promise = navigator.clipboard?.writeText(secret)
    // 与新建流程同一口径：复制失败必须如实说，不能显示"已复制 ✓"骗用户关窗口。
    if (promise) {
      promise.then(() => setCopied('ok')).catch(() => setCopied('failed'))
    } else {
      setCopied('failed')
    }
  }

  const title = `轮换凭证 · ${source.name}`

  if (phase === 'done' && result) {
    return (
      <Drawer
        open
        onClose={acknowledged ? onClose : () => { /* 未确认保存前不允许点遮罩关闭 */ }}
        title={title}
        size="md"
        closeOnBackdrop={false}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" size="md" disabled={!acknowledged} onClick={onClose}>
              完成
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm text-neutral-700">
          {result.webhookSecretOnce ? (
            <>
              <div className="rounded-lg border border-warning/30 bg-warning-bg p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-warning-fg">新签名密钥（仅显示这一次）</div>
                  <button
                    type="button"
                    onClick={copySecret}
                    className="flex items-center gap-1 text-xs text-warning-fg"
                  >
                    <CopyIcon className="h-3 w-3" />
                    {copied === 'ok' ? '已复制 ✓' : copied === 'failed' ? '复制失败，请手动选中' : '复制'}
                  </button>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-warning-fg">{result.webhookSecretOnce}</div>
              </div>
              <div className="rounded-lg border border-error/30 bg-error-bg p-3 text-xs leading-relaxed text-error-fg">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangleIcon className="h-3.5 w-3.5" />
                  旧密钥已立即失效
                </p>
                <p className="mt-1">
                  对接方在用新密钥重新签名之前，推送会一律被拒（401）。请立刻把新密钥交给对方并完成替换。
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-success/30 bg-success-bg p-3 text-xs leading-relaxed text-success-fg">
              新凭证已加密保存到服务端。平台不回显凭证内容，请以贵机构在来源平台侧的记录为准。
              旧凭证已立即失效。
            </div>
          )}

          <p className="text-xs text-neutral-400">
            轮换时间：{new Date(result.rotatedAt).toLocaleString('zh-CN')}
          </p>

          <label className="flex items-start gap-2 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              我已保存{result.webhookSecretOnce ? '新密钥' : '本次变更'}并知悉旧凭证已失效。
              关闭后平台不会再显示该密钥。
            </span>
          </label>
        </div>
      </Drawer>
    )
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="md" onClick={onClose}>取消</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={submitting}>
            {submitting ? '轮换中…' : '确认轮换'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm text-neutral-700">
        <div className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs leading-relaxed text-warning-fg">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            轮换会让旧凭证立即失效
          </p>
          <p className="mt-1">
            没有新旧双密钥并行的过渡期。请先与对接方约好切换时间，再执行轮换。
          </p>
        </div>

        {isWebhook && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-neutral-700">新密钥（可选）</label>
            <input
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              type="password"
              placeholder="留空则由系统随机生成（推荐）"
              className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
            />
            <p className="text-xs text-neutral-400">
              仅当对方系统的密钥不可改时才需要自填；否则留空，由平台生成高强度随机密钥。
            </p>
          </div>
        )}

        {isApi && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-neutral-700">新凭证（必填）</label>
            <input
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              type="password"
              placeholder="从来源平台重新签发的 token"
              className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-sm focus:border-primary-500 focus:outline-none"
            />
            <p className="text-xs text-neutral-400">
              上游 token 只能由贵机构在来源平台侧重新签发，平台无法代为生成，只负责加密保存。
            </p>
          </div>
        )}

        {source.credentialRotatedAt && (
          <p className="text-xs text-neutral-400">
            最近一次下发/轮换：{new Date(source.credentialRotatedAt).toLocaleString('zh-CN')}
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error-fg">{error}</div>
        )}
      </div>
    </Drawer>
  )
}
