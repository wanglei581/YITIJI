import { useRef } from 'react'
import { BriefcaseIcon } from 'lucide-react'
import { ChipRow, Field, GenerateStepHeading } from './ResumeGenerateShell'
import {
  JOB_TYPE_CHIPS,
  PILOT_CITIES,
  POSITION_CHIPS,
  SALARY_CHIPS,
  toggleSingle,
  type IntentionForm,
} from './resumeGenerateModel'

export function ResumeGenerateIntentionStep(props: {
  intention: IntentionForm
  invalidPosition?: boolean
  onChange: (next: IntentionForm) => void
}) {
  const positionRef = useRef<HTMLInputElement>(null)
  const cityRef = useRef<HTMLInputElement>(null)
  const typeRef = useRef<HTMLInputElement>(null)
  const salaryRef = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<IntentionForm>) => props.onChange({ ...props.intention, ...patch })
  return (
    <>
      <GenerateStepHeading icon={<BriefcaseIcon size={26} />} title="求职意向" hint="目标岗位必填" />
      <div className="qx-rg-grid">
        <Field label="目标岗位" required>
          <input
            ref={positionRef}
            className="qx-rd-field"
            placeholder="例：仓储管理员"
            aria-invalid={props.invalidPosition || undefined}
            value={props.intention.position}
            onChange={(event) => set({ position: event.target.value })}
          />
        </Field>
        <Field label="意向城市">
          <input
            ref={cityRef}
            className="qx-rd-field"
            placeholder="例：青岛"
            value={props.intention.city}
            onChange={(event) => set({ city: event.target.value })}
          />
        </Field>
        <Field label="工作类型">
          <input
            ref={typeRef}
            className="qx-rd-field"
            placeholder="点下面的选项，或自己写"
            value={props.intention.jobType}
            onChange={(event) => set({ jobType: event.target.value })}
          />
        </Field>
        <Field label="期望薪资">
          <input
            ref={salaryRef}
            className="qx-rd-field"
            placeholder="不写也行，面谈时再说"
            value={props.intention.salary}
            onChange={(event) => set({ salary: event.target.value })}
          />
        </Field>
      </div>
      <ChipRow title="目标岗位" options={POSITION_CHIPS} current={props.intention.position} testId="resume-generate-chip-position" onToggle={(chip) => set({ position: toggleSingle(props.intention.position, chip) })} onOther={() => positionRef.current?.focus()} />
      <ChipRow title="意向城市" options={PILOT_CITIES} current={props.intention.city} testId="resume-generate-chip-icity" onToggle={(chip) => set({ city: toggleSingle(props.intention.city, chip) })} onOther={() => cityRef.current?.focus()} />
      <ChipRow title="工作类型" options={JOB_TYPE_CHIPS} current={props.intention.jobType} testId="resume-generate-chip-jobtype" onToggle={(chip) => set({ jobType: toggleSingle(props.intention.jobType, chip) })} onOther={() => typeRef.current?.focus()} />
      <ChipRow title="期望薪资" options={SALARY_CHIPS} current={props.intention.salary} testId="resume-generate-chip-salary" onToggle={(chip) => set({ salary: toggleSingle(props.intention.salary, chip) })} onOther={() => salaryRef.current?.focus()} />
    </>
  )
}
