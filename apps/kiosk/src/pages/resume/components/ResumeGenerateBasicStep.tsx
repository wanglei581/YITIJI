import { useRef } from 'react'
import { UserRoundIcon } from 'lucide-react'
import { ChipRow, Field, GenerateStepHeading, MiniPair } from './ResumeGenerateShell'
import { PILOT_CITIES, toggleSingle, type BasicForm } from './resumeGenerateModel'

export function ResumeGenerateBasicStep(props: {
  basic: BasicForm
  invalidName?: boolean
  onChange: (next: BasicForm) => void
}) {
  const cityRef = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<BasicForm>) => props.onChange({ ...props.basic, ...patch })
  return (
    <>
      <GenerateStepHeading icon={<UserRoundIcon size={26} />} title="基本信息" hint="姓名必填，其余可空" />
      <div className="qx-rg-grid">
        <Field label="姓名" required>
          <input
            className="qx-rd-field"
            aria-invalid={props.invalidName || undefined}
            value={props.basic.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Field label="所在城市">
          <input
            ref={cityRef}
            className="qx-rd-field"
            placeholder="例：青岛"
            value={props.basic.city}
            onChange={(event) => set({ city: event.target.value })}
          />
        </Field>
        <Field label="手机号">
          <input
            className="qx-rd-field"
            aria-label="联系电话"
            inputMode="tel"
            placeholder="写在简历上给对方联系你"
            value={props.basic.phone}
            onChange={(event) => set({ phone: event.target.value })}
          />
        </Field>
        <Field label="邮箱">
          <input
            className="qx-rd-field"
            inputMode="email"
            placeholder="没有可以空着"
            value={props.basic.email}
            onChange={(event) => set({ email: event.target.value })}
          />
        </Field>
      </div>
      <ChipRow
        title="所在城市"
        options={PILOT_CITIES}
        current={props.basic.city}
        testId="resume-generate-chip-city"
        onToggle={(chip) => set({ city: toggleSingle(props.basic.city, chip) })}
        onOther={() => cityRef.current?.focus()}
      />
      <MiniPair
        left={{ title: '这几项印在最上面', body: <>姓名和联系方式是对方找到你的唯一入口。<b>写错一个数字，后面全白做</b>。这一栏值得你自己核一遍。</> }}
        right={{ title: '除了姓名都能空着', body: <>城市、手机号、邮箱空着也能往下走。空着的话，生成之后会算一条提示让你回来补，<b>AI 不会替你编一个</b>。</> }}
      />
    </>
  )
}
