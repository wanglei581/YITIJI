import { IsIn, IsOptional, IsString, Length } from 'class-validator'
import type { KioskAppPlacementView, ToolboxLaunchActionView } from '../terminal-toolbox.types'

const TOOLBOX_LAUNCH_ACTIONS: ToolboxLaunchActionView[] = [
  'show_qr',
  'open_external_notice',
  'open_external_confirmed',
  'cancel_external',
]

const TOOLBOX_PLACEMENTS: KioskAppPlacementView[] = ['toolbox', 'smart_campus']

export class RecordToolboxLaunchEventDto {
  @IsString()
  @Length(1, 64)
  itemKey!: string

  @IsIn(TOOLBOX_LAUNCH_ACTIONS)
  action!: ToolboxLaunchActionView

  @IsOptional()
  @IsIn(TOOLBOX_PLACEMENTS)
  placement?: KioskAppPlacementView
}
