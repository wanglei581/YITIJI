import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

const SHA256 = /^[A-Fa-f0-9]{64}$/
const AUTHENTICODE_THUMBPRINT = /^[A-Fa-f0-9]{40}$/

export class ReleaseObservationTargetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  terminalId!: string
}

export class CreateReleaseObservationPlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  artifactVersion!: string

  @IsString()
  @Matches(SHA256, { message: 'packageSha256 必须是 64 位 SHA-256 十六进制摘要' })
  packageSha256!: string

  @IsString()
  @Matches(SHA256, { message: 'runtimeManifestSha256 必须是 64 位 SHA-256 十六进制摘要' })
  runtimeManifestSha256!: string

  @IsIn(['unsigned_internal', 'internal_self_signed', 'enterprise_signed'])
  signerTrustLevel!: 'unsigned_internal' | 'internal_self_signed' | 'enterprise_signed'

  @IsOptional()
  @IsString()
  @Matches(AUTHENTICODE_THUMBPRINT, { message: 'signerCertificateThumbprint 必须是 40 位 Windows Authenticode 证书指纹' })
  signerCertificateThumbprint?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  targetPlatform?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string

  @IsDateString()
  observationEndsAt!: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReleaseObservationTargetDto)
  targets!: ReleaseObservationTargetDto[]
}
