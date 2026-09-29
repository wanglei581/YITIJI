import { IsIn } from 'class-validator'
import type { AdminScreenProfile } from './console-screen.types'

export class AdminScreenQueryDto {
  @IsIn(['gov', 'ops'])
  profile!: AdminScreenProfile
}

/** 空白名单：forbidNonWhitelisted 会把 ?orgId= / ?mode= / ?token= 直接 400。 */
export class PartnerScreenQueryDto {}
