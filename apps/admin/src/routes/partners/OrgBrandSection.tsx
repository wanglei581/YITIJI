import { useEffect, useId, useState } from 'react'
import type { AdminBranding, OrgBrandOverride } from '@ai-job-print/shared'
import { BrandLogoField } from '../../components/branding/BrandLogoField'
import { brandingAdmin, brandingError, validateBrand } from '../../services/api/brandingAdmin'
import { API_MODE } from '../../services/api/client'
import { orgsAdminService, type AdminOrgDetail } from '../../services/api/orgsAdmin'

export function OrgBrandSection({ detail, onChanged }: { detail: AdminOrgDetail; onChanged: () => void }) {
  const uid = useId()
  const [platform, setPlatform] = useState<AdminBranding | null>(null)
  const [draft, setDraft] = useState<OrgBrandOverride>(() => API_MODE === 'mock' ? brandingAdmin.getMockOrg(detail.id) : {
    brandName: detail.brandName ?? null, brandMark: detail.brandMark ?? null,
    brandLogoAssetId: detail.brandLogoAssetId ?? null, brandLogoUrl: detail.brandLogoUrl ?? null,
  })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    brandingAdmin.get().then((data) => { if (!cancelled) { setPlatform(data); setError(null) } })
      .catch((e) => { if (!cancelled) setError(brandingError(e, '平台品牌暂时没读到')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [retry])
  async function save() {
    const problem = validateBrand(draft.brandName ?? '', draft.brandMark ?? '')
    setNotice(null)
    if (problem) { setError(problem); return }
    const input = { brandName: draft.brandName?.trim() || null, brandMark: draft.brandMark?.trim() || null, brandLogoAssetId: draft.brandLogoAssetId }
    setSaving(true); setError(null)
    try {
      await orgsAdminService.updateOrg(detail.id, input)
      if (API_MODE === 'mock') brandingAdmin.saveMockOrg(detail.id, input)
      setNotice('已保存。一体机更新到支持贴牌的版本后，本机构名下的终端最迟 5 分钟内按这里显示。')
      onChanged()
    } catch (e) { setError(brandingError(e, '保存失败，请稍后重试')) } finally { setSaving(false) }
  }
  return <section className="space-y-3 border-t pt-4">
    <h3 className="text-sm font-semibold text-neutral-800">机构品牌</h3>
    <p className="text-xs text-neutral-500">只改本机构名下终端上显示的品牌；不填就用平台品牌。备案号不随机构变化。</p>
    {API_MODE === 'mock' && <p className="text-xs text-neutral-500">演示模式：更改只保存在当前页面会话中。</p>}
    {loading ? <p>正在加载…</p> : !platform ? <div><p role="alert" className="text-red-600">{error}</p><button type="button" className="min-h-11 rounded border px-3" onClick={() => { setLoading(true); setRetry((n) => n + 1) }}>重试</button></div> : <>
      {(['brandName', 'brandMark'] as const).map((key) => <div key={key} className="text-sm">
        <label htmlFor={`${uid}-${key}`} className="block">{key === 'brandName' ? '品牌名' : '字标'}</label>
        <input id={`${uid}-${key}`} aria-describedby={`${uid}-${key}-hint`} className="mt-1 w-full rounded-lg border px-3 py-2" value={draft[key] ?? ''} placeholder={platform[key] || platform.defaults[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
        <span id={`${uid}-${key}-hint`} className="block text-xs text-neutral-500">留空用平台品牌：{platform[key] || platform.defaults[key]}</span>
      </div>)}
      <BrandLogoField url={draft.brandLogoUrl} onChange={(id, url) => setDraft({ ...draft, brandLogoAssetId: id, brandLogoUrl: url })} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-neutral-700">{notice}</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-60">{saving ? '保存中…' : '保存机构品牌'}</button>
    </>}
  </section>
}
