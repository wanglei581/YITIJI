import type { ReactNode } from 'react'
import { useRef } from 'react'
import { SparklesIcon } from 'lucide-react'
import { ChipRow, Field, GenerateStepHeading } from './ResumeGenerateShell'
import { CERT_CHIPS, LIMITS, SKILL_CHIPS, TEXT_LIMITS, listNearLimit, splitList, textNearLimit, toggleMulti } from './resumeGenerateModel'

export function ResumeGenerateStrengthsStep(props: {
  skillsText: string
  certsText: string
  selfIntro: string
  onSkills: (next: string) => void
  onCerts: (next: string) => void
  onIntro: (next: string) => void
  skillsVoice: ReactNode
  certsVoice: ReactNode
  introVoice: ReactNode
}) {
  const skillsRef = useRef<HTMLTextAreaElement>(null)
  const certsRef = useRef<HTMLTextAreaElement>(null)
  const skillCount = splitList(props.skillsText, LIMITS.skills).length
  const certCount = splitList(props.certsText, LIMITS.certificates).length
  return (
    <>
      <GenerateStepHeading icon={<SparklesIcon size={26} />} title="技能与自我评价" hint="只填你真有的" />
      <Field label={`技能（逗号或换行分隔，最多 ${LIMITS.skills} 项 · 当前 ${skillCount} 项）`}>
        <textarea
          ref={skillsRef}
          className="qx-rd-field"
          placeholder="例：Excel、仓储理货、客服沟通"
          value={props.skillsText}
          onChange={(event) => props.onSkills(event.target.value)}
        />
        {listNearLimit(props.skillsText, TEXT_LIMITS.skill) ? <span className="qx-rg-hint">最多 {TEXT_LIMITS.skill} 字</span> : null}
        <div className="qx-rg-voice">{props.skillsVoice}</div>
      </Field>
      <ChipRow
        title="技能"
        options={SKILL_CHIPS}
        current={props.skillsText}
        multi
        testId="resume-generate-chip-skill"
        onToggle={(chip) => props.onSkills(toggleMulti(props.skillsText, chip, LIMITS.skills))}
        onOther={() => skillsRef.current?.focus()}
      />
      <Field label={`证书 / 资质（最多 ${LIMITS.certificates} 项 · 当前 ${certCount} 项 · 只写真拿到手的）`}>
        <textarea
          ref={certsRef}
          className="qx-rd-field"
          placeholder="例：普通话二级甲等"
          value={props.certsText}
          onChange={(event) => props.onCerts(event.target.value)}
        />
        {listNearLimit(props.certsText, TEXT_LIMITS.certificate) ? <span className="qx-rg-hint">最多 {TEXT_LIMITS.certificate} 字</span> : null}
        <div className="qx-rg-voice">{props.certsVoice}</div>
      </Field>
      <ChipRow
        title="证书"
        options={CERT_CHIPS}
        current={props.certsText}
        multi
        testId="resume-generate-chip-cert"
        onToggle={(chip) => props.onCerts(toggleMulti(props.certsText, chip, LIMITS.certificates))}
        onOther={() => certsRef.current?.focus()}
      />
      <Field label="自我评价（选填，AI 会基于它润色个人简介）">
        <textarea
          className="qx-rd-field"
          placeholder="一两句就够：你做事的方式"
          maxLength={TEXT_LIMITS.selfIntro}
          value={props.selfIntro}
          onChange={(event) => props.onIntro(event.target.value)}
        />
        {textNearLimit(props.selfIntro, TEXT_LIMITS.selfIntro) ? <span className="qx-rg-hint">最多 {TEXT_LIMITS.selfIntro} 字</span> : null}
        <div className="qx-rg-voice">{props.introVoice}</div>
      </Field>
    </>
  )
}
