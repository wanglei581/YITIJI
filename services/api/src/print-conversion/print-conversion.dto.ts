import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class ConvertImageSourceDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class ConvertImagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConvertImageSourceDto)
  sources!: ConvertImageSourceDto[]
}
