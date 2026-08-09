import { Equals, IsBoolean, IsString } from 'class-validator'

export class UpdateSourceEnabledDto {
  @IsBoolean()
  enabled!: boolean
}

export class UnpublishSourceContentDto {
  @IsString()
  @Equals('UNPUBLISH_SOURCE_CONTENT')
  confirmation!: 'UNPUBLISH_SOURCE_CONTENT'
}
