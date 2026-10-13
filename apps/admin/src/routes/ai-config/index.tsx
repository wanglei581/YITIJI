// ============================================================
// Admin AI 大模型配置页
//
// 管理员选择/配置对话大模型（DeepSeek / 通义千问 / MiniMax / 鱼人 / 腾讯混元 TokenHub）：
//   - 按功能配置 assistant_chat / resume_diagnosis / planned 能力
//   - 选择厂商 → 自动套用 baseURL/默认模型
//   - 填写 API Key（写入后端加密保存，不回显）
//   - 设置系统人设提示词、角色范围、禁用词、温度、启用开关
//   - 连通性测试
//
// 合规：API Key 只存服务端，前端不回显（仅显示"已配置"）。
// ============================================================

import './ai-config.css'
import { useCallback, useEffect, useState } from 'react'
import { Card, Button, LoadingState, ErrorState } from '@ai-job-print/ui'
import { CheckCircle2Icon, XCircleIcon, KeyRoundIcon, SparklesIcon, ShieldCheckIcon } from 'lucide-react'
import { Page } from '../Page'
import {
  aiConfigApi,
  type AiModelFeatureKey,
  type AiModelFeatureMeta,
  type AiConfigView,
  type LlmPreset,
  type LlmVendor,
} from '../../services/api/aiConfig'
import { useRecruitmentHosting } from '../components/recruitment/useRecruitmentHosting'
import { userMessageOf } from '../../services/api/userErrorMessage'

/**
 * 依赖招聘内容托管的 AI 功能：托管关闭时服务端对它们的接口回 403（岗位、招聘会在我们云上不开放），
 * 这里就不能照样标「已接入」。只改标签，不改配置能力——b 版本打开托管后照常使用。
 */
const RECRUITMENT_HOSTED_FEATURES: ReadonlySet<AiModelFeatureKey> = new Set<AiModelFeatureKey>(['fair_visit_plan', 'job_recommend', 'job_explain'])

/** 与侧栏「AI大模型」统一：AI 与中文功能名之间不留空格。 */
function featureText(text: string): string { return text.replace(/AI\s+(?=[\u4e00-\u9fff])/g, 'AI') }

function hostOf(value: string): string {
  try { return new URL(value).hostname } catch { return '' }
}

export default function AiConfigPage() {
  const hosting = useRecruitmentHosting()
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [presets, setPresets] = useState<LlmPreset[]>([])
  const [features, setFeatures] = useState<AiModelFeatureMeta[]>([])
  const [configs, setConfigs] = useState<Record<AiModelFeatureKey, AiConfigView> | null>(null)
  const [cfg, setCfg]         = useState<AiConfigView | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<AiModelFeatureKey>('assistant_chat')

  // 表单状态
  const [vendor, setVendor]             = useState<LlmVendor>('deepseek')
  const [model, setModel]               = useState('')
  const [baseURL, setBaseURL]           = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [roleScope, setRoleScope]       = useState('')
  const [forbiddenWordsText, setForbiddenWordsText] = useState('')
  const [temperature, setTemperature]   = useState(0.7)
  const [enabled, setEnabled]           = useState(false)
  const [apiKey, setApiKey]             = useState('')   // 留空=不修改

  const [saving, setSaving]   = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; reply?: string; error?: string } | null>(null)
  const [savedTip, setSavedTip]     = useState(false)

  const currentPreset = presets.find((p) => p.vendor === vendor)
  const needsApiKey = Boolean(cfg && (vendor !== cfg.vendor || hostOf(baseURL) !== hostOf(cfg.baseURL)))
  const currentFeature = features.find((f) => f.key === selectedFeature)
  const inheritedFeature = cfg?.inheritedFrom
    ? features.find((feature) => feature.key === cfg.inheritedFrom)
    : null

  const applyConfig = useCallback((c: AiConfigView) => {
    setCfg(c)
    setVendor(c.vendor)
    setModel(c.model)
    setBaseURL(c.baseURL)
    setSystemPrompt(c.systemPrompt)
    setRoleScope(c.roleScope)
    setForbiddenWordsText(c.forbiddenWords.join('\n'))
    setTemperature(c.temperature)
    setEnabled(c.enabled)
    setApiKey('')
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await aiConfigApi.get()
      setPresets(data.presets)
      setFeatures(data.features)
      setConfigs(data.configs)
      applyConfig(data.configs[selectedFeature] ?? data.config)
    } catch (e) {
      setError(userMessageOf(e, '模型配置加载失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }, [applyConfig, selectedFeature])

  function onFeatureChange(feature: AiModelFeatureKey) {
    setSelectedFeature(feature)
    setTestResult(null)
    setSavedTip(false)
    const next = configs?.[feature]
    if (next) applyConfig(next)
  }

  useEffect(() => { void load() }, [load])

  // 切换厂商：套用该厂商默认 baseURL/模型
  function onVendorChange(v: LlmVendor) {
    setVendor(v)
    const preset = presets.find((p) => p.vendor === v)
    if (preset) {
      setBaseURL(preset.baseURL)
      setModel(preset.defaultModel)
    }
  }

  function parseForbiddenWords(): string[] {
    const seen = new Set<string>()
    const words: string[] = []

    for (const item of forbiddenWordsText.split(/[\n,，]/)) {
      const word = item.trim()
      const key = word.toLocaleLowerCase().replace(/\s+/g, '')
      if (!word || seen.has(key)) continue
      seen.add(key)
      words.push(word)
    }

    return words
  }

  function confirmIndependentConfig(action: string): boolean {
    if (!cfg?.inheritedFrom) return true
    const parentLabel = inheritedFeature?.label ?? cfg.inheritedFrom
    return window.confirm(
      `当前功能仍继承「${parentLabel}」的配置。${action}会为当前功能创建独立配置，之后不再自动跟随父配置。确认继续？`,
    )
  }

  async function onSave() {
    if (!confirmIndependentConfig('保存')) return
    setSaving(true)
    setSavedTip(false)
    setError(null)
    try {
      const updated = await aiConfigApi.update({
        feature: selectedFeature, vendor, model, baseURL, systemPrompt, roleScope, forbiddenWords: parseForbiddenWords(), temperature, enabled,
        ...(apiKey ? { apiKey } : {}),
      })
      setConfigs((prev) => prev ? { ...prev, [selectedFeature]: updated } : prev)
      applyConfig(updated)
      setSavedTip(true)
      setTimeout(() => setSavedTip(false), 2500)
    } catch (e) {
      setError(userMessageOf(e, '模型配置没有保存，请检查后重试'))
    } finally {
      setSaving(false)
    }
  }

  async function onTest() {
    if (!confirmIndependentConfig('保存并测试')) return
    setTesting(true)
    setTestResult(null)
    setError(null)
    let updated: AiConfigView
    try {
      updated = await aiConfigApi.update({
        feature: selectedFeature, vendor, model, baseURL, systemPrompt, roleScope, forbiddenWords: parseForbiddenWords(), temperature, enabled,
        ...(apiKey ? { apiKey } : {}),
      })
    } catch (e) {
      setError(`未保存：${userMessageOf(e, '保存失败，请稍后重试')}`)
      setTesting(false)
      return
    }
    setConfigs((prev) => prev ? { ...prev, [selectedFeature]: updated } : prev)
    applyConfig(updated)
    try {
      const r = await aiConfigApi.test(selectedFeature)
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: userMessageOf(e, '测试失败，请稍后重试') })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <Page title="AI大模型"><LoadingState /></Page>
  if (error && !cfg) return <Page title="AI大模型"><ErrorState message={error} onRetry={load} /></Page>

  const labelCls = 'block text-sm font-medium text-neutral-700 mb-1.5'
  const inputCls = 'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20'

  return (
    <Page
      title="AI大模型"
      subtitle="按功能配置大模型。API Key 仅保存在服务端，前端不回显。"
    >
      <div className="w-full min-w-0 space-y-5">

        {/* 功能选择 */}
        <Card className="p-4">
          <div className="mb-3">
            <p className="text-sm font-medium text-neutral-900">功能配置</p>
            <p className="mt-1 text-xs text-neutral-500">已接入的功能保存后生效；标为「未接入」的功能可以先保存配置，接入前不影响一体机。</p>
          </div>
          <div className="ai-feature-grid grid gap-3">
            {features.map((feature) => {
              const featureConfig = configs?.[feature.key]
              const configured = Boolean(featureConfig?.enabled && featureConfig.apiKeyConfigured)
              const inheritedFrom = featureConfig?.inheritedFrom
                ? features.find((candidate) => candidate.key === featureConfig.inheritedFrom)
                : null
              return (
                <button
                  key={feature.key}
                  type="button"
                  onClick={() => onFeatureChange(feature.key)}
                  className={`flex h-full min-w-0 flex-col items-stretch rounded-lg border p-3 text-left transition-colors ${selectedFeature === feature.key
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-neutral-200 bg-surface hover:bg-neutral-50'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-neutral-900">{featureText(feature.label)}</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {featureConfig?.inheritedFrom && (
                        <span className="whitespace-nowrap rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-medium text-info-fg">
                          继承自 {featureText(inheritedFrom?.label ?? featureConfig.inheritedFrom)}
                        </span>
                      )}
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${configured ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-500'}`}>
                        {configured ? '配置可用' : '未启用'}
                      </span>
                      {RECRUITMENT_HOSTED_FEATURES.has(feature.key) && hosting.status !== 'ready' ? (
                        // 托管状态没读到时按关闭处理：不说「已接入」，也不冒充「托管关闭」
                        <span className="whitespace-nowrap rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
                          {hosting.status === 'error' ? '托管状态未读到' : '正在确认托管状态'}
                        </span>
                      ) : RECRUITMENT_HOSTED_FEATURES.has(feature.key) && hosting.status === 'ready' && !hosting.enabled ? (
                        <span className="whitespace-nowrap rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-medium text-warning-fg">托管关闭，不可用</span>
                      ) : (
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${feature.status === 'active'
                          ? 'bg-info-bg text-info-fg'
                          : 'bg-warning-bg text-warning-fg'}`}
                        >
                          {feature.status === 'active' ? '已接入' : '未接入'}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{featureText(feature.description)}</p>
                  <p className="mt-1 truncate font-mono text-[11px] text-neutral-400" title={featureConfig ? `${featureConfig.vendor} · ${featureConfig.model} · ${featureConfig.baseURL}` : feature.runtimeNote}>
                    {featureConfig ? `${featureConfig.vendor} · ${featureConfig.model} · ${featureConfig.baseURL}` : feature.runtimeNote}
                  </p>
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    API Key：{featureConfig?.apiKeyConfigured ? '已配置' : '未配置'} · {featureText(feature.runtimeNote)}
                  </p>
                </button>
              )
            })}
          </div>
        </Card>

        {/* 状态卡 */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <SparklesIcon className="h-5 w-5 text-primary-600" />
              <div>
                <p className="text-sm font-medium text-neutral-900">当前功能模型：{featureText(currentFeature?.label ?? selectedFeature)}</p>
                <p className="text-xs text-neutral-500">
                  {currentPreset?.label ?? vendor} · {cfg?.model}
                  {cfg?.enabled ? '' : '（未启用，相关功能会明确失败或走既有默认应答）'}
                </p>
                {cfg?.inheritedFrom && (
                  <p className="mt-1 text-xs font-medium text-info-fg">
                    当前配置继承自「{featureText(inheritedFeature?.label ?? cfg.inheritedFrom)}」；保存或测试会创建独立配置。
                  </p>
                )}
              </div>
            </div>
            <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium
              ${cfg?.enabled && cfg?.apiKeyConfigured ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-500'}`}>
              {cfg?.enabled && cfg?.apiKeyConfigured ? '已启用' : '未启用'}
            </span>
          </div>
        </Card>

        {/* 配置表单 */}
        <Card className="p-5 space-y-4">
          {/* 厂商 */}
          <div>
            <label className={labelCls}>模型厂商</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {presets.map((p) => (
                <button
                  key={p.vendor}
                  type="button"
                  onClick={() => onVendorChange(p.vendor)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors
                    ${vendor === p.vendor
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-neutral-200 bg-surface text-neutral-600 hover:bg-neutral-50'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {currentPreset && (
              <a href={currentPreset.docsUrl} target="_blank" rel="noreferrer"
                 className="mt-1.5 inline-block text-xs text-primary-600 hover:underline">
                获取 {currentPreset.label} API Key →
              </a>
            )}
          </div>

          {/* 模型 */}
          <div>
            <label className={labelCls}>模型</label>
            <input
              list="model-options"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputCls}
              placeholder={currentPreset?.defaultModel ?? '请输入模型标识'}
            />
            <datalist id="model-options">
              {currentPreset?.models.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>

          {/* API Key */}
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1">
                <KeyRoundIcon className="h-3.5 w-3.5" />
                API Key
                {cfg?.apiKeyConfigured && (
                  <span className="ml-1 rounded bg-success-bg px-1.5 py-0.5 text-[11px] text-success-fg">已配置</span>
                )}
              </span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={inputCls}
              placeholder={needsApiKey ? '请重新填写这一家的 API Key' : cfg?.apiKeyConfigured ? '已保存，留空则不修改' : '请输入 API Key'}
              autoComplete="off"
            />
            {needsApiKey && !apiKey && (
              <p className="mt-1 text-xs text-neutral-500">换了模型服务地址，需要重新填写这一家的 API Key</p>
            )}
          </div>

          {/* baseURL */}
          <div>
            <label className={labelCls}>API 地址（baseURL）</label>
            <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} className={inputCls} />
          </div>

          {/* 系统人设 */}
          <div>
            <label className={labelCls}>AI 人设提示词（System Prompt）</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              className={`${inputCls} resize-none leading-relaxed`}
            />
            <p className="mt-1 text-xs text-neutral-400">
              {currentFeature?.allowCustomSystemPrompt === false
                ? '此功能目前使用服务器固定的提示词；这里填写的自定义提示词暂不生效，以保证结果格式稳定。'
                : '建议保留合规红线说明，避免引导用户在本系统内完成招聘闭环。'}
            </p>
          </div>

          {/* 角色范围 */}
          <div>
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1">
                <ShieldCheckIcon className="h-3.5 w-3.5" />
                角色范围
              </span>
            </label>
            <textarea
              value={roleScope}
              onChange={(e) => setRoleScope(e.target.value)}
              rows={4}
              className={`${inputCls} resize-none leading-relaxed`}
              placeholder="限定 AI 助手只能回答哪些领域的问题"
            />
            <p className="mt-1 text-xs text-neutral-400">超出该范围的问题，将由系统提示词要求模型拒绝并回到本终端服务范围。</p>
          </div>

          {/* 禁用词 */}
          <div>
            <label className={labelCls}>禁用词</label>
            <textarea
              value={forbiddenWordsText}
              onChange={(e) => setForbiddenWordsText(e.target.value)}
              rows={4}
              className={`${inputCls} resize-none leading-relaxed`}
              placeholder="每行一个词，也支持用逗号分隔"
            />
            <p className="mt-1 text-xs text-neutral-400">模型回复命中任一禁用词时，后端会替换为范围内兜底回复；简历诊断中仍作用于 suggestions。</p>
          </div>

          {/* 温度 + 启用 */}
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <label className={labelCls}>回复发散度（temperature {temperature.toFixed(1)}）</label>
              <input
                type="range" min={0} max={1.5} step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-primary-600"
              />
              <div className="flex justify-between text-[11px] text-neutral-400">
                <span>严谨 0</span><span>发散 1.5</span>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer pt-5">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
                     className="h-5 w-5 rounded accent-primary-600" />
              <span className="text-sm font-medium text-neutral-700">启用当前功能模型</span>
            </label>
          </div>
        </Card>

        {/* 测试结果 */}
        {testResult && (
          <Card className={`p-4 ${testResult.ok ? 'border-success/30 bg-success-bg/50' : 'border-error/30 bg-error-bg/50'}`}>
            <div className="flex items-start gap-2">
              {testResult.ok
                ? <CheckCircle2Icon className="h-5 w-5 shrink-0 text-success-fg" />
                : <XCircleIcon className="h-5 w-5 shrink-0 text-error-fg" />}
              <div className="text-sm">
                <p className={`font-medium ${testResult.ok ? 'text-success-fg' : 'text-error-fg'}`}>
                  {testResult.ok ? '连通正常' : '连通失败'}
                </p>
                <p className="mt-0.5 text-neutral-600">
                  {testResult.ok ? testResult.reply : testResult.error}
                </p>
              </div>
            </div>
          </Card>
        )}

        {error && cfg && <p className="text-sm text-error-fg">{error}</p>}

        {/* 操作 */}
        <div className="flex items-center gap-3">
          <Button onClick={() => void onSave()} disabled={saving}>
            {saving ? '保存中…' : '保存配置'}
          </Button>
          <Button variant="outline" onClick={() => void onTest()} disabled={testing}>
            {testing ? '测试中…' : '保存并测试连通'}
          </Button>
          {savedTip && <span className="text-sm text-success-fg">✓ 已保存</span>}
        </div>
      </div>
    </Page>
  )
}
