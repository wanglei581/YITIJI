import { useCallback, useEffect, useState } from 'react'
import { Card } from '@ai-job-print/ui'
import type { AdminBranding, UpdateBrandingInput } from '@ai-job-print/shared'
import { API_MODE } from '../../services/api/client'
import { BrandLogoField } from '../../components/branding/BrandLogoField'
import { brandingAdmin, brandingError, validateBrand, validateFiling } from '../../services/api/brandingAdmin'

type FilingKey = keyof AdminBranding['filing']
const filingFields: { key: FilingKey; label: string; url: boolean }[] = [
  { key: 'icp', label: 'ICP 备案号', url: false }, { key: 'icpUrl', label: 'ICP 备案查询链接', url: true },
  { key: 'police', label: '公安联网备案号', url: false }, { key: 'policeUrl', label: '公安联网备案查询链接', url: true },
]
export function BrandingCard() {
  const [original, setOriginal] = useState<AdminBranding | null>(null)
  const [draft, setDraft] = useState<AdminBranding | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const data = await brandingAdmin.get(); setOriginal(data); setDraft(structuredClone(data)) }
    catch (e) { setError(brandingError(e, '品牌与备案暂时没读到')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  async function save() {
    if (!draft || !original) return
    const problem = validateBrand(draft.brandName ?? '', draft.brandMark ?? '') ??
      filingFields.map(({ key, url }) => validateFiling(draft.filing[key] ?? '', url)).find(Boolean)
    setNotice(null)
    if (problem) { setError(problem); return }
    const input: UpdateBrandingInput = {}
    for (const key of ['brandName', 'brandMark', 'brandLogoAssetId'] as const) {
      const next = draft[key]?.trim() || null
      if (next !== original[key]) input[key] = next
    }
    const filing: NonNullable<UpdateBrandingInput['filing']> = {}
    for (const { key } of filingFields) {
      const next = draft.filing[key]?.trim() || null
      if (next !== original.filing[key]) filing[key] = next
    }
    if (Object.keys(filing).length) input.filing = filing
    if (Object.keys(input).length === 0) { setError(null); setNotice('没有改动，不用保存。'); return }
    setSaving(true); setError(null)
    try {
      const data = await brandingAdmin.save(input); setOriginal(data); setDraft(structuredClone(data))
      setNotice('已保存。一体机更新到支持贴牌的版本后，最迟 5 分钟内按这里显示。')
    } catch (e) { setError(brandingError(e, '保存失败，请稍后重试')) } finally { setSaving(false) }
  }
  return <Card className="mb-4 p-4">
    <h2 className="text-sm font-semibold text-neutral-900">品牌与备案</h2>
    <p className="mt-1 text-xs text-neutral-500">贴牌只换展示：品牌名、字标和 Logo 用于一体机上的显示。隐私政策与用户协议的主体、备案主体、AI 生成内容的制作方标识、短信签名仍是我方，不随品牌改变。备案号只按平台配置，不随机构品牌变化。</p>
    {API_MODE === 'mock' && <p className="mt-2 text-xs text-neutral-500">演示模式：更改只保存在当前页面会话中。</p>}
    {loading ? <p className="mt-3">正在加载…</p> : !draft ? <div className="mt-3"><p role="alert" className="text-red-600">{error}</p><button type="button" className="min-h-11 rounded border px-3" onClick={() => void load()}>重试</button></div> :
      <div className="mt-3 grid gap-3">
        {(['brandName', 'brandMark'] as const).map((key) => <label key={key} className="block text-sm">{key === 'brandName' ? '品牌名' : '字标'}
          <input className="mt-1 w-full rounded-lg border px-3 py-2" value={draft[key] ?? ''} placeholder={draft.defaults[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          <span className="block text-xs text-neutral-500">留空用默认：{draft.defaults[key]}</span>
        </label>)}
        <BrandLogoField url={draft.logoUrl} onChange={(id, url) => setDraft({ ...draft, brandLogoAssetId: id, logoUrl: url })} />
        <p className="text-xs text-neutral-500">不用 Logo 时，一体机显示字标。</p>
        {filingFields.map(({ key, label }) => <label key={key} className="block text-sm">{label}
          <input className="mt-1 w-full rounded-lg border px-3 py-2" value={draft.filing[key] ?? ''} placeholder={draft.defaults.filing[key]} onChange={(e) => setDraft({ ...draft, filing: { ...draft.filing, [key]: e.target.value } })} />
          <span className="block break-all text-xs text-neutral-500">留空用默认：{draft.defaults.filing[key]}</span>
        </label>)}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {notice && <p role="status" className="text-sm text-neutral-700">{notice}</p>}
        <div><button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-60">{saving ? '保存中…' : '保存'}</button></div>
      </div>}
  </Card>
}
