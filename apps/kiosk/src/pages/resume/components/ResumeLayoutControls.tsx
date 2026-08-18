import type { ResumeLayoutSettings } from '@ai-job-print/shared'

type LayoutKey = keyof ResumeLayoutSettings

type Choice<T extends string | number> = {
  value: T
  label: string
}

type ResumeLayoutControlsProps = {
  layout: Required<ResumeLayoutSettings>
  onChange: (next: Required<ResumeLayoutSettings>) => void
  disabled?: boolean
}

const groups: Array<{
  key: LayoutKey
  label: string
  choices: Choice<string | number>[]
}> = [
  { key: 'fontScale', label: '字号', choices: [
    { value: 'compact', label: '紧凑' },
    { value: 'standard', label: '标准' },
    { value: 'large', label: '放大' },
  ] },
  { key: 'lineSpacing', label: '行距', choices: [
    { value: 'compact', label: '紧凑' },
    { value: 'standard', label: '标准' },
    { value: 'relaxed', label: '舒展' },
  ] },
  { key: 'margin', label: '页边距', choices: [
    { value: 'narrow', label: '窄' },
    { value: 'normal', label: '标准' },
    { value: 'wide', label: '宽' },
  ] },
  { key: 'accent', label: '主色', choices: [
    { value: 'blue', label: '蓝' },
    { value: 'green', label: '绿' },
    { value: 'slate', label: '灰' },
  ] },
  { key: 'columns', label: '栏数', choices: [
    { value: 1, label: '单栏' },
    { value: 2, label: '双栏' },
  ] },
]

/**
 * 排版分段控件。**每组一行**，不再把 5 组并排塞进侧栏。
 *
 * 事故原样（2026-08-18 走查，1080×1920 实测）：外层原本是一个五列 grid，
 * 5 组控件并排挤在 348px 宽的侧栏里 → 每组只剩约 60px，组内再切 3 列 →
 * **14 个按钮实测各宽 18px**，「紧凑」被压成上下两个字竖排。硬约束要求
 * 可点区 ≥48px（CLAUDE.md §9），27 寸触控屏上手指点不中任何一个。
 *
 * 现在每组独占一行、组内按钮等分整行宽度，实测每个按钮约 100px 宽 × 56px 高。
 * `min-w-[48px]` / `min-h-[48px]` 是兜底：将来这块被放进更窄的容器时，
 * 按钮会换行而不是再被压成竖条。
 */
export function ResumeLayoutControls({ layout, onChange, disabled = false }: ResumeLayoutControlsProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.key}>
            <p className="mb-1.5 text-xs font-semibold text-gray-500">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.choices.map((choice) => {
                const active = layout[group.key] === choice.value
                return (
                  <button
                    key={`${group.key}-${choice.value}`}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => onChange({ ...layout, [group.key]: choice.value })}
                    className={[
                      'min-h-[48px] min-w-[48px] flex-1 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      active ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600',
                    ].join(' ')}
                  >
                    {choice.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
