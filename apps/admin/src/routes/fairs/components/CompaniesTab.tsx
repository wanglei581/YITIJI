import { useState } from 'react'
import { Card, Drawer } from '@ai-job-print/ui'
import { PencilIcon, PlusIcon } from 'lucide-react'
import { DangerDeleteButton, Field, GhostButton, InlineError, PrimaryButton } from '../../../components/form'
import { errMsg, inputCls } from './shared'
import {
  fairsAdminService,
  type FairCompanyView,
  type SaveFairCompanyInput,
  type SaveFairCompanyPositionInput,
} from '../../../services/api/fairsAdmin'

const EMPTY_COMPANY: SaveFairCompanyInput = { name: '', industry: '', scale: '', description: '', sourceUrl: '', hiringTags: '', jobsCount: 0, positions: [] }

export function CompaniesTab({
  fairId,
  companies,
  onChanged,
}: {
  fairId: string
  companies: FairCompanyView[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<FairCompanyView | 'new' | null>(null)
  const [form, setForm] = useState<SaveFairCompanyInput>(EMPTY_COMPANY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const openNew = () => {
    setForm(EMPTY_COMPANY)
    setError(null)
    setEditing('new')
  }
  const openEdit = (c: FairCompanyView) => {
    setForm({
      name: c.name,
      industry: c.industry ?? '',
      scale: c.scale ?? '',
      description: c.description ?? '',
      sourceUrl: c.sourceUrl ?? '',
      hiringTags: c.hiringTags.join(','),
      jobsCount: c.jobsCount,
      positions: c.positions.map((p) => ({
        title: p.title,
        positionType: p.positionType ?? undefined,
        salary: p.salary ?? undefined,
        headcount: p.headcount,
        education: p.education ?? undefined,
        experience: p.experience ?? undefined,
        location: p.location ?? undefined,
        department: p.department ?? undefined,
        requirements: p.requirements ?? undefined,
      })),
    })
    setError(null)
    setEditing(c)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // 空标题岗位行前端过滤(后端 DTO 对 title 有非空校验);positionType/文本空值转 undefined → 后端落 null。
      const payload: SaveFairCompanyInput = {
        ...form,
        positions: (form.positions ?? [])
          .filter((p) => p.title.trim().length > 0)
          .map((p) => ({
            title: p.title.trim(),
            positionType: p.positionType || undefined,
            salary: p.salary?.trim() || undefined,
            headcount: p.headcount ?? 0,
            education: p.education?.trim() || undefined,
            experience: p.experience?.trim() || undefined,
            location: p.location?.trim() || undefined,
            department: p.department?.trim() || undefined,
            requirements: p.requirements?.trim() || undefined,
          })),
      }
      if (editing === 'new') await fairsAdminService.createCompany(fairId, payload)
      else if (editing) await fairsAdminService.updateCompany(fairId, editing.id, payload)
      setEditing(null)
      onChanged()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (companyId: string) => {
    setBusyId(companyId)
    try {
      await fairsAdminService.deleteCompany(fairId, companyId)
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  const positions = form.positions ?? []
  const setPos = (i: number, patch: Partial<SaveFairCompanyPositionInput>) =>
    setForm((f) => ({ ...f, positions: (f.positions ?? []).map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
  const addPos = () => setForm((f) => ({ ...f, positions: [...(f.positions ?? []), { title: '' }] }))
  const removePos = (i: number) => setForm((f) => ({ ...f, positions: (f.positions ?? []).filter((_, j) => j !== i) }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600">{companies.length} 家参展企业</p>
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
          <PlusIcon className="h-3.5 w-3.5" />
          新增企业
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['企业名称', '行业', '规模', '招聘标签', '岗位数', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {companies.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-xs text-neutral-400">暂无参展企业,点击右上角"新增企业"录入</td></tr>
              ) : (
                companies.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">{c.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{c.industry ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{c.scale ? `${c.scale} 人` : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.hiringTags.length === 0
                          ? <span className="text-xs text-neutral-400">—</span>
                          : c.hiringTags.map((t) => (
                            <span key={t} className="rounded bg-info-bg px-1.5 py-0.5 text-xs text-info-fg">{t}</span>
                          ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{c.jobsCount}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(c)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                        <DangerDeleteButton onConfirm={() => void remove(c.id)} busy={busyId === c.id} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-neutral-400">
        合规说明:企业信息仅用于招聘会现场服务展示,系统不接收求职者简历,不参与招聘闭环。
      </p>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增参展企业' : '编辑参展企业'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setEditing(null)} disabled={saving}>取消</GhostButton>
            <PrimaryButton onClick={save} disabled={saving || !form.name.trim()}>{saving ? '保存中…' : '保存'}</PrimaryButton>
          </div>
        }
      >
        <div className="space-y-4">
          <InlineError message={error} />
          <Field label="企业名称" required>
            <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="行业">
              <input className={inputCls} placeholder="如 互联网/软件" value={form.industry ?? ''} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} />
            </Field>
            <Field label="规模">
              <select className={inputCls} value={form.scale ?? ''} onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value }))}>
                <option value="">未填写</option>
                <option value="<50">&lt;50 人</option>
                <option value="50-500">50-500 人</option>
                <option value="500-2000">500-2000 人</option>
                <option value=">2000">&gt;2000 人</option>
              </select>
            </Field>
          </div>
          <Field label="企业简介">
            <textarea className={`${inputCls} h-20 resize-none`} value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="招聘标签(逗号分隔)">
              <input className={inputCls} placeholder="如 校招,实习" value={form.hiringTags ?? ''} onChange={(e) => setForm((f) => ({ ...f, hiringTags: e.target.value }))} />
            </Field>
            <Field label="岗位数">
              <input
                type="number" min={0} className={inputCls} value={form.jobsCount ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, jobsCount: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              />
            </Field>
          </div>
          <Field label="来源平台企业页链接">
            <input className={inputCls} placeholder="https://…(用户跳转外部平台查看)" value={form.sourceUrl ?? ''} onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))} />
          </Field>

          {/* ── P1-A② 岗位明细(Kiosk 企业详情岗位列表展示用)── */}
          <div className="border-t border-neutral-100 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-neutral-700">岗位明细</p>
              <GhostButton onClick={addPos}>添加岗位</GhostButton>
            </div>
            <p className="mt-0.5 text-xs text-neutral-400">用于 Kiosk 企业详情岗位列表;仅展示信息,不接收简历、不参与平台内投递。保存即全量替换该企业岗位。</p>
          </div>
          {positions.length === 0 && (
            <p className="text-xs text-neutral-400">暂无岗位;点击「添加岗位」录入(标题必填)。</p>
          )}
          {positions.map((pos, i) => (
            <div key={i} className="space-y-2.5 rounded-lg border border-neutral-200 p-3">
              <div className="flex items-center gap-2">
                <input className={`${inputCls} flex-1`} placeholder="岗位标题(必填)" value={pos.title} onChange={(e) => setPos(i, { title: e.target.value })} />
                <button type="button" className="shrink-0 rounded-md px-2 py-1 text-sm text-error-fg hover:bg-error-bg" onClick={() => removePos(i)}>删除</button>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="岗位类型">
                  <select className={inputCls} value={pos.positionType ?? ''} onChange={(e) => setPos(i, { positionType: e.target.value })}>
                    <option value="">未填写</option>
                    <option value="full_time">全职</option>
                    <option value="part_time">兼职</option>
                    <option value="intern">实习</option>
                  </select>
                </Field>
                <Field label="招聘人数">
                  <input
                    type="number" min={0} className={inputCls} value={pos.headcount ?? 0}
                    onChange={(e) => setPos(i, { headcount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                  />
                </Field>
                <Field label="薪资">
                  <input className={inputCls} placeholder="如 15-25K / 面议" value={pos.salary ?? ''} onChange={(e) => setPos(i, { salary: e.target.value })} />
                </Field>
                <Field label="工作地点">
                  <input className={inputCls} value={pos.location ?? ''} onChange={(e) => setPos(i, { location: e.target.value })} />
                </Field>
                <Field label="学历">
                  <input className={inputCls} placeholder="如 本科" value={pos.education ?? ''} onChange={(e) => setPos(i, { education: e.target.value })} />
                </Field>
                <Field label="经验">
                  <input className={inputCls} placeholder="如 3-5年 / 不限" value={pos.experience ?? ''} onChange={(e) => setPos(i, { experience: e.target.value })} />
                </Field>
                <Field label="部门">
                  <input className={inputCls} value={pos.department ?? ''} onChange={(e) => setPos(i, { department: e.target.value })} />
                </Field>
              </div>
              <Field label="岗位要求">
                <textarea className={`${inputCls} h-16 resize-none`} value={pos.requirements ?? ''} onChange={(e) => setPos(i, { requirements: e.target.value })} />
              </Field>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  )
}
