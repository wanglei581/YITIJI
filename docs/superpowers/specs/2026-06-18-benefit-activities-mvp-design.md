# 权益活动中心 MVP 设计规格

> 状态：待用户确认
> 日期：2026-06-18
> 基线分支：`codex/profile-notifications-feedback-p1`
> 目标分支：`codex/profile-benefit-activities-p2`

## 1. 设计结论

第一版 `权益活动` 不做支付、不做套餐购买、不做招聘会报名或签到凭证。它只做一个可控的权益发放闸门：Admin 先配置活动，用户在 Kiosk 领取，后端生成 `BenefitGrant`，用户在 `/me/benefits` 查看。

核心链路：

```text
Admin 配置 BenefitActivity
→ Kiosk 展示活动
→ 用户点击领取
→ 后端写 BenefitClaim 防重
→ 后端生成 BenefitGrant
→ 用户在 /me/benefits 查看
→ Admin 查看领取记录
```

这保持现有 P0/P1 的成果不被推翻：`BenefitGrant` 仍是权益资产唯一承载物，`/me/benefits` 仍是本人权益查看入口，Admin `/member-benefits` 仍是人工发放与撤销入口。

## 2. 用户页面设计

### 2.1 入口

`ProfilePage` 中的 `权益活动` 入口接到新路由 `/activities`。

当前存在两处 `权益活动`：

1. `招聘会与活动` 分组。
2. `权益活动与服务套餐` 分组。

第一版不新增入口，也不把现有入口伪装成新功能。两个现有入口都接到同一个活动中心，但带不同筛选：

1. `招聘会与活动` 分组里的 `权益活动` 接 `/activities?source=fair`，只展示与招聘会、校园活动、现场服务相关的权益活动；它不能生成报名、签到或投递凭证。
2. `权益活动与服务套餐` 分组里的 `权益活动` 接 `/activities`，展示全部可领取权益活动。

这样既不新增卡片，也避免两个按钮在体验上完全重复。

### 2.2 活动列表页 `/activities`

列表页展示已发布、未过期、未下架的活动。

每张活动卡片展示：

1. 活动标题。
2. 活动类型标签：平台活动、校园活动、政策提示、招聘会服务活动、合作机构活动。
3. 权益类型标签：优惠券、免费次数、套餐权益、政策资格提示。
4. 有效期。
5. 库存状态：可领取、即将领完、已领完。
6. 当前用户状态：未领取、已领取。
7. 操作按钮。

按钮状态：

| 状态 | 按钮 | 行为 |
|---|---|---|
| 未登录 | 登录后领取 | 跳转 `/login`，登录后可返回活动页 |
| 可领取 | 立即领取 | 调用领取 API |
| 已领取 | 查看我的权益 | 跳转 `/me/benefits` |
| 已领完 | 已领完 | 禁用 |
| 已过期 | 已结束 | 禁用 |

### 2.3 活动详情页 `/activities/:id`

详情页展示：

1. 活动标题、类型、有效期。
2. 权益内容说明。
3. 活动规则。
4. 合规说明。
5. 领取按钮。
6. 领取成功后的 `查看我的权益` 按钮。

`subsidy_eligibility_hint` 类型必须展示信息提示口径：本系统仅提供政策信息和材料提示，具体申请、审核、到账以官方渠道为准。

## 3. Admin 页面设计

### 3.1 活动列表 `/admin/benefit-activities`

列表展示：

1. 活动标题。
2. 活动类型。
3. 权益类型。
4. 状态：草稿、已发布、已下架、已结束。
5. 有效期。
6. 库存：不限量或已领数量/总量。
7. 创建时间。
8. 操作：编辑、发布、下架、查看领取记录。

### 3.2 新建和编辑活动

表单字段：

1. 活动标题。
2. 活动说明。
3. 活动规则。
4. 活动类型 `sourceType`：platform、campus、gov、fair、partner。
5. 权益类型 `benefitType`：coupon、free_quota、package_entitlement、subsidy_eligibility_hint。
6. 权益额度 `quantityTotal`。
7. 单人领取上限，第一版固定为 1。
8. 总库存，可为空表示不限量。
9. 活动开始时间。
10. 活动结束时间。
11. 领取后权益有效期，可为空，默认跟随活动结束时间。

编辑规则：

1. 草稿状态可编辑全部字段。
2. 已发布后不可修改权益类型、额度、库存总量等影响发放结果的字段。
3. 已发布后只允许下架，不做物理删除。

### 3.3 领取记录

领取记录展示：

1. 用户脱敏手机号。
2. 领取时间。
3. 关联 `BenefitGrant.id`。
4. 权益当前状态：active、used_up、expired、revoked。
5. 活动来源。

后台不得显示明文手机号，不得显示任何支付凭证。

## 4. 后端数据设计

### 4.1 新增 `BenefitActivity`

活动是权益发放模板和领取闸门。

字段建议：

```text
id
title
description
rulesText
benefitType
sourceType
quantityTotal
stockTotal
stockRemaining
claimLimitPerUser
status
validFrom
validUntil
grantValidDays
createdById
createdAt
updatedAt
```

状态：

```text
draft | published | ended
```

`stockTotal = null` 表示不限量；有限库存必须维护 `stockRemaining`。

### 4.2 新增 `BenefitClaim`

领取流水用于防重、审计和后台反查。

字段建议：

```text
id
activityId
endUserId
benefitGrantId
createdAt
```

必须添加唯一约束：

```text
unique(activityId, endUserId)
```

第一版单用户单活动只能领取一次。

### 4.3 复用 `BenefitGrant`

领取成功后生成 `BenefitGrant`：

```text
benefitType       = BenefitActivity.benefitType
title             = BenefitActivity.title
description       = BenefitActivity.description
quantityTotal     = BenefitActivity.quantityTotal
quantityRemaining = BenefitActivity.quantityTotal
status            = active
sourceType        = BenefitActivity.sourceType
sourceRef         = BenefitActivity.id
validFrom         = 当前时间
validUntil        = grantValidDays 或活动结束时间
```

`subsidy_eligibility_hint` 必须强制 `quantityTotal = null`，只生成信息提示权益。

## 5. API 设计

### 5.1 Kiosk API

列表和详情允许游客查看，便于一体机现场浏览活动内容；如果请求带会员 token，服务端返回本人是否已领取。领取接口必须会员登录，使用 `EndUserAuthGuard`。

```text
GET /api/v1/activities
GET /api/v1/activities/:id
POST /api/v1/activities/:id/claim
```

列表和详情返回服务端计算好的状态：

```text
claimable
claimed
soldOut
ended
```

前端只渲染状态，不自行判断领取资格。

### 5.2 Admin API

使用 Admin 鉴权和角色控制。

```text
GET /api/v1/admin/benefit-activities
POST /api/v1/admin/benefit-activities
PATCH /api/v1/admin/benefit-activities/:id
PATCH /api/v1/admin/benefit-activities/:id/publish
PATCH /api/v1/admin/benefit-activities/:id/end
GET /api/v1/admin/benefit-activities/:id/claims
```

所有写操作都写 `AuditLog`：

```text
benefit_activity.create
benefit_activity.update
benefit_activity.publish
benefit_activity.end
benefit_activity.claim
```

## 6. 领取事务

领取必须在事务内完成：

1. 校验用户已登录且账号可用。
2. 查询活动，必须是 `published` 且当前时间在有效期内。
3. 尝试创建 `BenefitClaim`，依赖 `unique(activityId, endUserId)` 防止重复领取。
4. 若活动有库存，执行原子扣减，条件是 `stockRemaining > 0`。
5. 创建 `BenefitGrant`。
6. 回填 `BenefitClaim.benefitGrantId`。
7. 写 `AuditLog`。
8. 返回生成的权益。

重复请求返回明确业务错误，不得生成第二条权益。

## 7. 合规边界

必须拦截以下文案或语义：

```text
到账
已发放金额
保证
通过率
录用
面试
候选人推荐
平台投递
一键投递
立即投递
```

保存草稿和发布活动时都要校验。发布时二次校验是必须项。

招聘会相关活动只能表达“凭活动领取平台服务权益”或“查看官方/第三方来源信息”，不能生成报名成功、签到成功、入场凭证、投递状态。

## 8. 与现有功能的关系

### 不应影响

1. `/me/benefits`：继续读取 `BenefitGrant`。
2. Admin `/member-benefits`：继续手动发放/撤销。
3. `/me/notifications`：第一版不强依赖通知。
4. `/me/feedback`：不改反馈流程。
5. 招聘会页面：不接报名或签到凭证。

### 可选增强

领取成功后可以生成一条本人通知，但第一版不作为必须项。若实现，必须复用现有 `MemberNotification`，不新增推送或短信。

## 9. 延后范围

以下内容不进入第一版：

1. 支付。
2. 套餐购买。
3. 套餐订单。
4. 权益核销。
5. 招聘会扫码凭证。
6. 招聘会签到核销。
7. 机构端活动配置。
8. 活动审核流。
9. 活动定时发布和自动下架。
10. 按身份、学校、地区精准投放。

## 10. 验收标准

1. 点击 `我的 → 权益活动` 能进入活动列表。
2. 未登录用户点击领取会进入登录流程。
3. 已登录用户可领取已发布、有效、未售罄的活动。
4. 领取成功后生成一条 `BenefitGrant`。
5. `/me/benefits` 能看到刚领取的权益。
6. 同一用户重复领取同一活动只能成功一次。
7. 有库存活动不会超发。
8. 草稿、下架、过期活动不能在 Kiosk 领取。
9. Admin 可创建、编辑草稿、发布、下架活动。
10. Admin 可查看领取记录，手机号只展示脱敏值。
11. 活动保存和发布都能拦截违规文案。
12. `subsidy_eligibility_hint` 不能配置权益额度。
13. 招聘会相关活动不产生报名、签到、投递结果。
14. 现有 `/me/benefits`、Admin `/member-benefits`、消息通知、意见反馈验证不回退。

## 11. 专家会审摘要

Claude 与 Antigravity 只读评审结论一致：

1. 活动应是 `BenefitGrant` 的发放闸门，不应新建第二套权益资产。
2. MVP 必须解决幂等领取和库存原子扣减。
3. 活动文案的合规校验风险高于手动发放，保存和发布都要校验。
4. 活动与招聘会报名、签到、投递必须结构性解耦。
5. 支付、套餐购买、凭证核销、机构端配置应明确后置。
