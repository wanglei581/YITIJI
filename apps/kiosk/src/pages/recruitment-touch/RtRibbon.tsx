/**
 * 私有化版标识条：第 11 包所有页面（岗位、招聘会、企业、校园招聘）的最上面一条，逐字照稿。
 * 这些页只在托管打开（客户私有化部署）时才挂载；托管关时路由闸门不挂载它们，也就没有这条。
 */
export const RT_RIBBON_TEXT = '私有化部署版 · 仅供持有人力资源服务许可证的客户自行运营 · 我方云上不出现 · 不得用于对外宣传'

export function RtRibbon() {
  return (
    <div className="rt-ribbon" role="note" data-testid="recruit-private-ribbon">
      {RT_RIBBON_TEXT}
    </div>
  )
}
