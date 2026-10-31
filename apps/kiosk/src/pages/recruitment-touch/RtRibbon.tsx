/**
 * 招聘来源说明：保留群众办理去向；部署及运营限制以正式合规/产品文档为准。
 * 这些页只在托管打开（客户私有化部署）时才挂载；托管关时路由闸门不挂载它们，也就没有这条。
 */
export const RT_RIBBON_TEXT = '信息以标注的来源为准；投递、预约请前往来源平台办理。'

export function RtRibbon() {
  return (
    <div className="rt-ribbon" role="note" data-testid="recruit-private-ribbon">
      {RT_RIBBON_TEXT}
    </div>
  )
}
