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

export function ResumeLayoutControls({ layout, onChange, disabled = false }: ResumeLayoutControlsProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-5">
        {groups.map((group) => (
          <div key={group.key}>
            <p className="mb-2 text-xs font-semibold text-gray-500">{group.label}</p>
            <div className="grid grid-cols-3 gap-1">
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
                      'min-h-[36px] rounded-lg border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
