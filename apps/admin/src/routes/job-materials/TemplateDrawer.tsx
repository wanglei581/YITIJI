import { useEffect, useState } from 'react'
import { Drawer } from '@ai-job-print/ui'
import type {
  JobMaterialTemplateField,
  JobMaterialTemplateType,
  ResumeTemplateLayoutPreset,
} from '@ai-job-print/shared'
import {
  createJobMaterialTemplate,
  updateJobMaterialTemplate,
  type JobMaterialTemplateAdminInput,
  type JobMaterialTemplateAdminRow,
} from '../../services/api/jobMaterials'
import { JOB_MATERIAL_TYPE_OPTIONS } from './constants'

/** 新建时的默认表单字段骨架：与种子模板同一套 key，方便运营直接改文案。 */
const DEFAULT_FIELDS_JSON = JSON.stringify(
  [
    {
      key: 'applicantName',
      label: '姓名',
      required: true,
      maxLength: 40,
      placeholder: '例：王同学',
    },
    {
      key: 'targetRole',
      label: '目标岗位',
      required: true,
      maxLength: 60,
      placeholder: '例：前端开发工程师',
    },
    {
      key: 'targetOrganization',
      label: '目标单位',
      required: false,
      maxLength: 80,
      placeholder: '例：某科技公司 / 某高校招聘会',
    },
    {
      key: 'keyStrengths',
      label: '核心亮点',
      required: false,
      maxLength: 280,
      multiline: true,
      placeholder: '例：React 项目经验、校级竞赛',
    },
    {
      key: 'notes',
      label: '补充说明',
      required: false,
      maxLength: 220,
      multiline: true,
      placeholder: '例：希望语气稳重',
    },
  ],
  null,
  2
)

const DEFAULT_PRESET_JSON = JSON.stringify(
  {
    style: 'clean',
    defaultLayout: {
      fontScale: 'standard',
      lineSpacing: 'standard',
      margin: 'normal',
      columns: 1,
      accent: 'blue',
    },
    sectionOrder: [
      'header',
      'summary',
      'education',
      'experience',
      'projects',
      'skills',
      'certificates',
    ],
  },
  null,
  2
)

interface Props {
  open: boolean
  mode: 'create' | 'edit'
  template: JobMaterialTemplateAdminRow | null
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  type: JobMaterialTemplateType
  title: string
  description: string
  tagsText: string
  recommendedFor: string
  outputFilename: string
  sortOrderText: string
  fieldsJson: string
  presetJson: string
}

function formFrom(template: JobMaterialTemplateAdminRow | null): FormState {
  if (!template) {
    return {
      type: 'cover_letter',
      title: '',
      description: '',
      tagsText: '',
      recommendedFor: '',
      outputFilename: '求职材料.pdf',
      sortOrderText: '99',
      fieldsJson: DEFAULT_FIELDS_JSON,
      presetJson: DEFAULT_PRESET_JSON,
    }
  }
  return {
    type: template.type,
    title: template.title,
    description: template.description,
    tagsText: template.tags.join('，'),
    recommendedFor: template.recommendedFor,
    outputFilename: template.outputFilename,
    sortOrderText: String(template.sortOrder),
    fieldsJson: JSON.stringify(template.fields, null, 2),
    presetJson: template.resumeLayoutPreset
      ? JSON.stringify(template.resumeLayoutPreset, null, 2)
      : DEFAULT_PRESET_JSON,
  }
}

function buildInput(form: FormState): JobMaterialTemplateAdminInput {
  const sortOrder = Number.parseInt(form.sortOrderText, 10)
  if (!Number.isInteger(sortOrder) || sortOrder < 0) throw new Error('排序值必须是 ≥ 0 的整数')
  const title = form.title.trim()
  if (!title) throw new Error('标题不能为空')
  const outputFilename = form.outputFilename.trim()
  if (!outputFilename) throw new Error('输出文件名不能为空')

  const tags = form.tagsText
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
  if (tags.length > 20) throw new Error('标签最多 20 个（逗号分隔）')

  let fields: unknown
  try {
    fields = JSON.parse(form.fieldsJson)
  } catch {
    throw new Error('fields 不是合法 JSON，请检查格式（可先在 JSON 校验器里过一遍）')
  }
  if (!Array.isArray(fields)) throw new Error('fields 必须是 JSON 数组')
  for (const field of fields as Array<Record<string, unknown>>) {
    if (!field || typeof field !== 'object') throw new Error('fields 每一项必须是对象')
    if (typeof field.key !== 'string' || !field.key) throw new Error('fields 每一项都需要非空 key')
    if (typeof field.label !== 'string' || !field.label)
      throw new Error('fields 每一项都需要非空 label')
    if (typeof field.required !== 'boolean')
      throw new Error(`fields[${String(field.key)}].required 必须是布尔值`)
    if (typeof field.maxLength !== 'number' || field.maxLength < 1)
      throw new Error(`fields[${String(field.key)}].maxLength 必须是 ≥ 1 的整数`)
  }

  let preset: ResumeTemplateLayoutPreset | undefined
  if (form.type === 'resume_template') {
    let parsed: unknown
    try {
      parsed = JSON.parse(form.presetJson)
    } catch {
      throw new Error('resumeLayoutPreset 不是合法 JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('resumeLayoutPreset 必须是 JSON 对象')
    preset = parsed as ResumeTemplateLayoutPreset
  }

  return {
    type: form.type,
    title,
    description: form.description.trim(),
    tags,
    recommendedFor: form.recommendedFor.trim(),
    outputFilename,
    sortOrder,
    fields: fields as JobMaterialTemplateField[],
    ...(preset ? { resumeLayoutPreset: preset } : {}),
  }
}

export function TemplateDrawer({ open, mode, template, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => formFrom(null))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(formFrom(mode === 'edit' ? template : null))
      setError(null)
      setSubmitting(false)
    }
  }, [open, mode, template])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const title = mode === 'create' ? '新建求职材料模板' : '编辑求职材料模板'
  const aria = `${title}（发布前保存为未发布状态，需在列表中点发布后对用户可见）`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    let input: JobMaterialTemplateAdminInput
    try {
      input = buildInput(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : '表单校验失败')
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'create') {
        await createJobMaterialTemplate(input)
      } else if (template) {
        await updateJobMaterialTemplate(template.id, input)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'
  const labelClass = 'mb-1.5 block text-sm font-medium text-neutral-700'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={title}
      ariaLabel={aria}
      footer={
        <div className="flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-sm text-error-fg">{error}</p>}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            取消
          </button>
          <button
            type="submit"
            form="job-material-template-form"
            disabled={submitting}
            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? '保存中…' : '保存'}
          </button>
        </div>
      }
    >
      <form id="job-material-template-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="jmType" className={labelClass}>
            类型{' '}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </label>
          <select
            id="jmType"
            value={form.type}
            onChange={(e) => set('type', e.target.value as JobMaterialTemplateType)}
            className={inputClass}
          >
            {JOB_MATERIAL_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="jmTitle" className={labelClass}>
            标题{' '}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </label>
          <input
            id="jmTitle"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={120}
            className={inputClass}
            placeholder="例：校招自荐信"
          />
        </div>

        <div>
          <label htmlFor="jmDescription" className={labelClass}>
            描述
          </label>
          <textarea
            id="jmDescription"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            maxLength={500}
            className={inputClass}
            placeholder="例：适合应届生在校招现场快速生成一页自荐材料。"
          />
        </div>

        <div>
          <label htmlFor="jmTags" className={labelClass}>
            标签
          </label>
          <input
            id="jmTags"
            value={form.tagsText}
            onChange={(e) => set('tagsText', e.target.value)}
            className={inputClass}
            placeholder="例：校招，通用（逗号分隔，最多 20 个）"
          />
        </div>

        <div>
          <label htmlFor="jmRecommendedFor" className={labelClass}>
            适用场景
          </label>
          <input
            id="jmRecommendedFor"
            value={form.recommendedFor}
            onChange={(e) => set('recommendedFor', e.target.value)}
            maxLength={300}
            className={inputClass}
            placeholder="例：应届毕业生、校园招聘会"
          />
        </div>

        <div>
          <label htmlFor="jmOutputFilename" className={labelClass}>
            输出文件名{' '}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </label>
          <input
            id="jmOutputFilename"
            value={form.outputFilename}
            onChange={(e) => set('outputFilename', e.target.value)}
            maxLength={120}
            className={inputClass}
            placeholder="例：校招自荐信.pdf"
          />
        </div>

        <div>
          <label htmlFor="jmSortOrder" className={labelClass}>
            排序值
          </label>
          <input
            id="jmSortOrder"
            type="number"
            min={0}
            max={9999}
            value={form.sortOrderText}
            onChange={(e) => set('sortOrderText', e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-neutral-500">
            越小越靠前；公开接口按该值升序返回已发布模板。
          </p>
        </div>

        <div>
          <label htmlFor="jmFieldsJson" className={labelClass}>
            fields（JSON 数组）{' '}
            <span aria-hidden="true" className="text-red-500">
              *
            </span>
          </label>
          <textarea
            id="jmFieldsJson"
            value={form.fieldsJson}
            onChange={(e) => set('fieldsJson', e.target.value)}
            rows={10}
            spellCheck={false}
            className={`${inputClass} font-mono text-xs`}
          />
          <p className="mt-1 text-xs text-neutral-500">
            每项结构：key（applicantName / targetRole / targetOrganization / keyStrengths /
            notes）、label、required、maxLength、可选 multiline 与 placeholder。
          </p>
        </div>

        {form.type === 'resume_template' && (
          <div>
            <label htmlFor="jmPresetJson" className={labelClass}>
              resumeLayoutPreset（JSON 对象）{' '}
              <span aria-hidden="true" className="text-red-500">
                *
              </span>
            </label>
            <textarea
              id="jmPresetJson"
              value={form.presetJson}
              onChange={(e) => set('presetJson', e.target.value)}
              rows={8}
              spellCheck={false}
              className={`${inputClass} font-mono text-xs`}
            />
            <p className="mt-1 text-xs text-neutral-500">
              版式预置：style / defaultLayout / sectionOrder，结构参考种子简历模板。
            </p>
          </div>
        )}
      </form>
    </Drawer>
  )
}
