import { IsString, Matches } from 'class-validator'
import { RESTORE_TOKEN_PATTERN } from '../member-restore.service'

/** 同设备恢复凭证（FLOW1c）：换新或作废时出示的那一枚。格式见 RESTORE_TOKEN_PATTERN。 */
export class MemberRestoreDto {
  @IsString()
  @Matches(RESTORE_TOKEN_PATTERN, { message: '恢复凭证格式不正确' })
  restoreToken!: string
}
