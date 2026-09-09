import { IsIn } from 'class-validator'

/**
 * 契约源:`packages/shared/src/types/admin.ts` 的 PublishAction / PublishActionPayload。
 * services/api 是 CommonJS,shared 是 ESM,运行时不可互通,故此处保留本地副本。
 */
export type PublishAction = 'publish' | 'unpublish'

export class PublishActionDto {
  @IsIn(['publish', 'unpublish'])
  action!: PublishAction
}

/**
 * 合作机构侧的「上下架」请求体。只接受 `unpublish`。
 *
 * 为什么单独一个 DTO,而不是复用上面的 `PublishActionDto`:
 * 合作机构**只能下架不能上架**,这是角色边界,不是尚未实现的功能——
 * 上架必须先过管理员审核与内容可信核验(`assertOrgContentTrustActive`,
 * 全部调用点都在 `@Roles('admin')` 路由后面)。规范出处:
 *   - docs/product/role-boundary.md:79「下架自己的岗位 / 招聘会(只能下架本机构的)」
 *   - docs/reviews/four-chain-data-integrity-ledger-2026-08.md:45
 *     「Partner 侧只能『申请收录 / 提交更新』,不能发布、不能改排序」
 *
 * 改这里之前先读那两份文档:**放开 'publish' 等于给合作机构开了绕过审核的上架口**。
 *
 * 此前四个 partner 端点复用 `PublishActionDto`,`@IsIn(['publish','unpublish'])`
 * 放行 `publish`,handler 再把整个 body 丢掉(形参写成 `_dto`)强制下架。
 * 边界是守住了,但请求方发 `{action:'publish'}` 会拿到 **200 + 内容被下架** ——
 * 回了成功却做了相反的事,违反 CLAUDE.md §9「不伪造能力」。现在显式回 400。
 */
export class PartnerUnpublishActionDto {
  @IsIn(['unpublish'], {
    message: '合作机构只能下架本机构内容;上架需由管理员审核后发布,请改用「提交更新」后等待审核',
  })
  action!: 'unpublish'
}
