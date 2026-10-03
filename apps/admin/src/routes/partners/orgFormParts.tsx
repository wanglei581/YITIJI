import { useEffect, useState } from 'react'
import { MODULE_LABELS, SCENE_TEMPLATE_LABELS, type SceneTemplate } from '@ai-job-print/shared'
import { isParkedModule, moduleLabel } from './orgPresentation'

export const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {label}
        {required && <span className="ml-0.5 text-error-fg">*</span>}
      </span>
      {children}
    </label>
  )
}

export function InlineError({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">{message}</p>
}

/** 两步确认按钮(停用机构/账号等影响登录的操作,防误点)。 */
export function TwoStepButton({
  label,
  confirmLabel,
  className,
  confirmClassName,
  onConfirm,
  disabled,
}: {
  label: string
  confirmLabel: string
  className: string
  confirmClassName: string
  onConfirm: () => void
  disabled?: boolean
}) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), 5000)
    return () => clearTimeout(t)
  }, [arming])
  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (arming) {
          setArming(false)
          onConfirm()
        } else {
          setArming(true)
        }
      }}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${arming ? confirmClassName : className}`}
    >
      {arming ? confirmLabel : label}
    </button>
  )
}

/** 启用模块多选(招聘闭环模块不在选项里,服务端同样硬拒绝)。 */
export function ModulesPicker({ value, onChange, showRecruitment = true }: { value: string[]; onChange: (modules: string[]) => void; showRecruitment?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {Object.entries(MODULE_LABELS).map(([key]) => (
        <label key={key} className="flex items-center gap-2 rounded-lg border border-neutral-100 px-2.5 py-1.5 text-xs text-neutral-700">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-neutral-300"
            checked={value.includes(key)}
            onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((m) => m !== key))}
          />
          <span className={!showRecruitment && isParkedModule(key) ? 'text-neutral-400' : undefined}>{moduleLabel(key, showRecruitment)}</span>
        </label>
      ))}
    </div>
  )
}

/** 场景模板只读展示——由机构类型决定，不提供选择控件 */
export function SceneTemplateReadonly({ sceneTemplate }: { sceneTemplate: SceneTemplate | null }) {
  return (
    <Field label="场景模板">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
        {sceneTemplate ? (
          <>
            {SCENE_TEMPLATE_LABELS[sceneTemplate]}
            <span className="ml-2 text-xs text-neutral-500">由机构类型决定</span>
          </>
        ) : (
          <>
            无终端场景
            <span className="ml-2 text-xs text-neutral-500">该类型为纯内容供给方，不拥有终端</span>
          </>
        )}
      </div>
    </Field>
  )
}

