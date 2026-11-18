import { IsOptional } from 'class-validator'

/** 复印与材料包只读列表的筛选。状态是否认得由服务端白名单决定，这里不放行别的字段。 */
export class ListFulfillmentQueryDto {
  @IsOptional()
  status?: string

  @IsOptional()
  terminalId?: string

  @IsOptional()
  page?: string

  @IsOptional()
  pageSize?: string
}
