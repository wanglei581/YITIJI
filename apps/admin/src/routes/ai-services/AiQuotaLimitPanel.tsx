import { useEffect, useState } from 'react'
import {
  AI_QUOTA_LIMITS_DEMO,
  getAiQuotaLimits,
  resetAiQuotaLimits,
  updateAiQuotaLimits,
  type AiQuotaLimitBucketName,
  type AiQuotaLimitConfig,
  type AiQuotaLimitSource,
} from '../../services/api/aiQuotaLimits'
import { ApiHttpError } from '../../services/api/client'
import { userMessageOf } from '../../services/api/userErrorMessage'

const BUCKETS: ReadonlyArray<{ bucket: AiQuotaLimitBucketName; label: string }> = [
  { bucket: 'ai_resume', label: '简历类' },
  { bucket: 'ai_assistant', label: '小青' },
  { bucket: 'ai_interview', label: '模拟面试' },
]

const SOURCE_LABEL: Record<AiQuotaLimitSource, string> = {
  admin: '后台保存的',
  env: '服务器配置',
  default: '缺省',
}

const INVALID_MESSAGE = '每天的免费次数须是 0 到 1000 的整数'
const PRIMARY_BTN = 'min-h-12 rounded-lg bg-primary-700 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60'
const NEUTRAL_BTN = 'min-h-12 rounded-lg border border-neutral-200 px-4 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40'

type Phase = 'loading' | 'error' | 'ready' | 'saving'

function draftsFrom(config: AiQuotaLimitConfig): Record<AiQuotaLimitBucketName, string> {
  return {
    ai_resume: String(config.buckets.find((item) => item.bucket === 'ai_resume')?.effective ?? ''),
    ai_assistant: String(config.buckets.find((item) => item.bucket === 'ai_assistant')?.effective ?? ''),
    ai_interview: String(config.buckets.find((item) => item.bucket === 'ai_interview')?.effective ?? ''),
  }
}

function parseDrafts(drafts: Record<AiQuotaLimitBucketName, string>) {
  const input = {} as Record<AiQuotaLimitBucketName, number>
  for (const { bucket } of BUCKETS) {
    const text = drafts[bucket].trim()
    if (!/^\d+$/.test(text)) return null
    const value = Number(text)
    if (!Number.isInteger(value) || value < 0 || value > 1000) return null
    input[bucket] = value
  }
  return input
}

export function AiQuotaLimitPanel({ onChanged }: { onChanged?: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [config, setConfig] = useState<AiQuotaLimitConfig | null>(null)
  const [drafts, setDrafts] = useState<Record<AiQuotaLimitBucketName, string>>({
    ai_resume: '',
    ai_assistant: '',
    ai_interview: '',
  })
  const [alert, setAlert] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (AI_QUOTA_LIMITS_DEMO) return
    let cancelled = false
    setPhase('loading')
    setAlert(null)
    getAiQuotaLimits().then(
      (next) => {
        if (cancelled) return
        setConfig(next)
        setDrafts(draftsFrom(next))
        setPhase('ready')
      },
      (error: unknown) => {
        if (cancelled) return
        setPhase('error')
        setAlert(error instanceof ApiHttpError && error.status === 403
          ? '只有管理员可以修改每天的免费次数'
          : userMessageOf(error, '每天的免费次数读取失败，请稍后重试'))
      },
    )
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  async function onSave() {
    const input = parseDrafts(drafts)
    if (!input) {
      setNotice(null)
      setAlert(INVALID_MESSAGE)
      return
    }
    setPhase('saving')
    setAlert(null)
    setNotice(null)
    try {
      const next = await updateAiQuotaLimits(input)
      setConfig(next)
      setDrafts(draftsFrom(next))
      setNotice('已保存，并记入审计。')
      setPhase('ready')
      onChanged?.()
    } catch (error) {
      setAlert(userMessageOf(error, '保存失败'))
      setPhase(config ? 'ready' : 'error')
    }
  }

  async function onReset() {
    setPhase('saving')
    setAlert(null)
    setNotice(null)
    try {
      const next = await resetAiQuotaLimits()
      setConfig(next)
      setDrafts(draftsFrom(next))
      setNotice('已恢复默认，并记入审计。')
      setPhase('ready')
      onChanged?.()
    } catch (error) {
      setAlert(userMessageOf(error, '保存失败'))
      setPhase(config ? 'ready' : 'error')
    }
  }

  if (AI_QUOTA_LIMITS_DEMO) {
    return (
      <section aria-labelledby="ai-quota-limit-title" className="mt-4 border-t border-neutral-100 pt-4">
        <h3 id="ai-quota-limit-title" className="text-[13px] font-bold text-neutral-700">每天的免费次数</h3>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">演示模式不连接每天的免费次数，请连接真实后端后再改。</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="ai-quota-limit-title" className="mt-4 border-t border-neutral-100 pt-4">
      <h3 id="ai-quota-limit-title" className="text-[13px] font-bold text-neutral-700">每天的免费次数</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        简历类、小青、模拟面试三个用途分开计数。这里改的是每人每天可以用的次数。没在这里保存过时，用服务器上原来的配置；都没配时用默认次数。
      </p>
      {phase === 'loading' && <p className="mt-3 text-sm text-neutral-400" role="status">正在读取…</p>}
      {alert && <p className="mt-3 rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">{alert}</p>}
      {notice && <p className="mt-3 text-sm text-success-fg" role="status">{notice}</p>}
      {config && phase !== 'loading' && (
        <div className="mt-3 space-y-3">
          {BUCKETS.map(({ bucket, label }) => {
            const row = config.buckets.find((item) => item.bucket === bucket)
            return (
              <label key={bucket} className="block text-sm text-neutral-800" htmlFor={`quota-limit-${bucket}`}>
                {label}
                <input
                  id={`quota-limit-${bucket}`}
                  value={drafts[bucket]}
                  inputMode="numeric"
                  disabled={phase === 'saving'}
                  aria-label={`${label}每天的免费次数`}
                  onChange={(event) => setDrafts((current) => ({ ...current, [bucket]: event.target.value }))}
                  className="mt-1 min-h-12 w-full rounded-lg border border-neutral-200 px-3 text-sm"
                />
                {row && (
                  <span className="mt-1 block text-[12px] leading-relaxed text-neutral-500">
                    当前生效 {row.effective} 次，来源：{SOURCE_LABEL[row.source]}，默认 {row.fallback} 次
                  </span>
                )}
              </label>
            )
          })}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY_BTN} disabled={phase === 'saving'} onClick={() => { void onSave() }}>
              {phase === 'saving' ? '保存中…' : '保存'}
            </button>
            <button type="button" className={NEUTRAL_BTN} disabled={phase === 'saving'} onClick={() => { void onReset() }}>
              恢复默认
            </button>
            <button type="button" className={NEUTRAL_BTN} disabled={phase === 'saving'} onClick={() => setReloadKey((value) => value + 1)}>
              重新读取
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
