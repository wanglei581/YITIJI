import { useEffect, useState } from 'react'
import { KioskModal } from '@ai-job-print/ui'
import {
  AI_AGE_BLOCKED_TITLE,
  AI_AGE_CONFIRM_LABEL,
  AI_AGE_DECLINE_LABEL,
  AI_AGE_DECLINED_MESSAGE,
  AI_AGE_DIALOG_BODY,
  AI_AGE_DIALOG_TITLE,
  AI_DECLARATION_ACK_LABEL,
  AI_VOICE_BLOCKED_TITLE,
  AI_VOICE_CONFIRM_LABEL,
  AI_VOICE_CONSENT_ITEMS,
  AI_VOICE_DECLINE_LABEL,
  AI_VOICE_DECLINED_MESSAGE,
  AI_VOICE_DIALOG_TITLE,
} from './aiDeclarationCopy'
import {
  currentDeclarationPrompt,
  settleDeclarationPrompt,
  subscribeDeclarationPrompt,
} from './aiDeclarationSession'
import { AGE_14_PLUS_SCOPE, type DeclarationScope } from './aiDeclarationVersions'

type Step = 'ask' | 'explain'

export function AiDeclarationHost() {
  const [prompt, setPrompt] = useState(currentDeclarationPrompt)
  const [step, setStep] = useState<Step>('ask')

  useEffect(() => subscribeDeclarationPrompt(() => {
    setPrompt(currentDeclarationPrompt())
    setStep('ask')
  }), [])

  if (!prompt) return null

  const scope: DeclarationScope = prompt.scope
  const age = scope === AGE_14_PLUS_SCOPE
  const explaining = step === 'explain'

  const decline = () => {
    if (explaining) {
      settleDeclarationPrompt('no')
      return
    }
    setStep('explain')
  }

  return (
    <KioskModal
      open
      title={explaining ? (age ? AI_AGE_BLOCKED_TITLE : AI_VOICE_BLOCKED_TITLE) : (age ? AI_AGE_DIALOG_TITLE : AI_VOICE_DIALOG_TITLE)}
      description={explaining ? (age ? AI_AGE_DECLINED_MESSAGE : AI_VOICE_DECLINED_MESSAGE) : (age ? AI_AGE_DIALOG_BODY : undefined)}
      onClose={decline}
      closeOnBackdrop={!explaining}
      closeOnEscape
      closeLabel={explaining ? AI_DECLARATION_ACK_LABEL : '关闭'}
      actions={explaining ? (
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          data-ai-declaration-scope={scope}
          data-ai-declaration-choice="no"
          onClick={decline}
        >
          {AI_DECLARATION_ACK_LABEL}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="qx-btn"
            data-variant="ghost"
            data-ai-declaration-scope={scope}
            data-ai-declaration-choice="no"
            onClick={decline}
          >
            {age ? AI_AGE_DECLINE_LABEL : AI_VOICE_DECLINE_LABEL}
          </button>
          <button
            type="button"
            className="qx-btn"
            data-variant="primary"
            data-ai-declaration-scope={scope}
            data-ai-declaration-choice="yes"
            onClick={() => settleDeclarationPrompt('yes')}
          >
            {age ? AI_AGE_CONFIRM_LABEL : AI_VOICE_CONFIRM_LABEL}
          </button>
        </>
      )}
    >
      <div data-ai-declaration-dialog={explaining ? 'explain' : 'ask'} data-ai-declaration-scope={scope}>
        {!age && !explaining && (
          <ol className="qx-ai-declaration-items">
            {AI_VOICE_CONSENT_ITEMS.map((item) => <li key={item}>{item}</li>)}
          </ol>
        )}
      </div>
    </KioskModal>
  )
}
