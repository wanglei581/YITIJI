import { AI_DECLARATION_NOTE } from './aiDeclarationCopy'

/** 主按钮下的一行声明说明。不新开页面，也不另起大块留白。 */
export function AiDeclarationNote() {
  return (
    <p className="qx-ai-declaration-note" data-ai-declaration-note>
      {AI_DECLARATION_NOTE}
    </p>
  )
}
