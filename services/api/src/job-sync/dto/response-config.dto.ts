import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator'

const RESPONSE_FIELD_KEYS = new Set([
  'externalId', 'title', 'company', 'city', 'sourceUrl', 'salary', 'description', 'requirements',
  'industry', 'workType', 'tags', 'educationRequirement', 'experienceRequirement', 'skills', 'benefits',
  'salaryMin', 'salaryMax', 'salaryUnit', 'validThrough', 'headcount',
  'startAt', 'endAt', 'venue', 'companyCount',
])

@ValidatorConstraint({ name: 'responseFieldMap', async: false })
class ResponseFieldMapConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined) return true
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length <= 64 && entries.every(([key, sourceKey]) =>
      RESPONSE_FIELD_KEYS.has(key) &&
      typeof sourceKey === 'string' &&
      sourceKey.trim().length > 0 &&
      sourceKey.length <= 120 &&
      !sourceKey.includes('\0') &&
      !['__proto__', 'prototype', 'constructor'].includes(sourceKey),
    )
  }

  defaultMessage(): string {
    return 'fields must map supported field names to non-empty source keys (max 120 characters)'
  }
}

export class UpdateResponseConfigDto {
  @IsIn(['job', 'fair'])
  dataType!: 'job' | 'fair'

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9_.-]+$/)
  rootPath?: string

  @IsOptional()
  @IsObject()
  @Validate(ResponseFieldMapConstraint)
  fields?: Record<string, string>
}
