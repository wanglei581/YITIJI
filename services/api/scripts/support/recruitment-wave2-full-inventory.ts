import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import {
  parseDomainPolicy,
  validateLandingUrl,
} from '../../src/recruitment-content/recruitment-content-readiness'
import type { RecruitmentWave2DatabaseIdentity, QueryRows } from './recruitment-wave2-readonly-db'
import type { PublicEntity, PublicIdSets } from './recruitment-wave2-public-snapshot'
import { isPublicAddress } from './recruitment-wave2-public-snapshot'

const MAX_IDS = 50_000

export interface FullInventorySnapshot {
  identity: RecruitmentWave2DatabaseIdentity
  ruleVersion: 'recruitment-wave2-full-inventory-v1'
  queryPlanSha256: string
  counts: Record<string, number>
  grouped: Record<string, Array<{ key: string; count: number }>>
  issues: Record<string, string[]>
  currentReaderIds: PublicIdSets
  targetSafeIds: PublicIdSets
  targetSafeSupport: Record<
    PublicEntity | 'onlinePlatformDirectories' | 'offlineAgencyProfiles',
    string
  >
  snapshotDigest: string
}

const COUNT_SQL = {
  organizations: 'SELECT COUNT(*)::int AS count FROM "Organization"',
  jobSources: 'SELECT COUNT(*)::int AS count FROM "JobSource"',
  jobs: 'SELECT COUNT(*)::int AS count FROM "Job"',
  jobFairs: 'SELECT COUNT(*)::int AS count FROM "JobFair"',
  policyPosts: 'SELECT COUNT(*)::int AS count FROM "PolicyPost"',
  offlineAgencies: 'SELECT COUNT(*)::int AS count FROM "OfflineAgency"',
  offlineJobs: 'SELECT COUNT(*)::int AS count FROM "OfflineJob"',
  platformDirectories: 'SELECT COUNT(*)::int AS count FROM "OnlinePlatformDirectory"',
  agencyProfiles: 'SELECT COUNT(*)::int AS count FROM "OfflineAgencyProfile"',
  branches: 'SELECT COUNT(*)::int AS count FROM "OfflineAgencyBranch"',
  qualifications: 'SELECT COUNT(*)::int AS count FROM "QualificationRecord"',
  auditLogs: 'SELECT COUNT(*)::int AS count FROM "AuditLog"',
  reviewDecisions: 'SELECT COUNT(*)::int AS count FROM "ReviewDecision"',
} as const

const GROUP_SQL = {
  organizations: `SELECT CONCAT(COALESCE(NULLIF("type",''),'other'),'|enabled=',enabled::text) AS key,
    COUNT(*)::int AS count FROM "Organization" GROUP BY 1 ORDER BY 1`,
  jobSources: `SELECT CONCAT(COALESCE(NULLIF("sourceKind",''),'other'),'|',COALESCE(NULLIF("accessMode",''),'other'),
    '|enabled=',enabled::text) AS key,COUNT(*)::int AS count FROM "JobSource" GROUP BY 1 ORDER BY 1`,
  jobs: `SELECT CONCAT("reviewStatus",'|',"publishStatus",'|archived=',("archivedAt" IS NOT NULL)::text,
    '|validity=',CASE WHEN "validThrough" IS NULL THEN 'none' WHEN "validThrough"<$1 THEN 'expired' ELSE 'current' END)
    AS key,COUNT(*)::int AS count FROM "Job" GROUP BY 1 ORDER BY 1`,
  jobFairs: `SELECT CONCAT("reviewStatus",'|',"publishStatus",'|runtime=',CASE WHEN "endAt"<$1 THEN 'ended'
    WHEN "startAt">$1 THEN 'upcoming' ELSE 'ongoing' END) AS key,COUNT(*)::int AS count FROM "JobFair" GROUP BY 1 ORDER BY 1`,
  policies: `SELECT CONCAT("reviewStatus",'|',"publishStatus",'|',COALESCE(NULLIF(kind,''),'other')) AS key,
    COUNT(*)::int AS count FROM "PolicyPost" GROUP BY 1 ORDER BY 1`,
  agencies: `SELECT CONCAT(status,'|',"reviewStatus",'|',"publishStatus") AS key,
    COUNT(*)::int AS count FROM "OfflineAgency" GROUP BY 1 ORDER BY 1`,
  offlineJobs: `SELECT CONCAT(j.status,'|parent=',COALESCE(a.status,'missing'),'|',COALESCE(a."reviewStatus",'missing'),
    '|',COALESCE(a."publishStatus",'missing')) AS key,COUNT(*)::int AS count FROM "OfflineJob" j
    LEFT JOIN "OfflineAgency" a ON a.id=j."agencyId" GROUP BY 1 ORDER BY 1`,
  audits: `SELECT CONCAT(action,'|',"targetType") AS key,COUNT(*)::int AS count FROM "AuditLog"
    WHERE action LIKE 'job.%' OR action LIKE 'fair.%' OR action LIKE 'policy.%'
      OR action LIKE 'offline_agency%' OR action LIKE 'data_source.%' OR action LIKE 'recruitment.%'
    GROUP BY 1 ORDER BY 1`,
  decisions: `SELECT CONCAT(action,'|',"targetType") AS key,COUNT(*)::int AS count FROM "ReviewDecision"
    GROUP BY 1 ORDER BY 1`,
} as const

const ISSUE_SQL: Record<string, string> = {
  job_source_missing_or_orphan: `SELECT j.id FROM "Job" j LEFT JOIN "JobSource" s ON s.id=j."sourceId"
    WHERE j."sourceId" IS NULL OR BTRIM(j."sourceId")='' OR s.id IS NULL`,
  job_source_org_mismatch: `SELECT j.id FROM "Job" j JOIN "JobSource" s ON s.id=j."sourceId"
    WHERE s."orgId"<>j."sourceOrgId"`,
  job_required_source_fact_missing: `SELECT id FROM "Job" WHERE BTRIM("externalId")='' OR BTRIM("sourceName")=''
    OR BTRIM(company)='' OR BTRIM(city)=''`,
  job_published_expired: `SELECT id FROM "Job" WHERE "publishStatus"='published' AND "validThrough" IS NOT NULL
    AND "validThrough"<$1`,
  job_published_archived: `SELECT id FROM "Job" WHERE "publishStatus"='published' AND "archivedAt" IS NOT NULL`,
  job_published_version_unbound: `SELECT id FROM "Job" WHERE "publishStatus"='published' AND
    ("contentVersion" IS NULL OR "contentHash" IS NULL OR "approvedContentHash" IS NULL
      OR "contentHash"<>"approvedContentHash" OR "hashAlgorithmVersion" IS NULL)`,
  job_published_org_untrusted: `SELECT j.id FROM "Job" j LEFT JOIN "Organization" o ON o.id=j."sourceOrgId"
    WHERE j."publishStatus"='published' AND (o.id IS NULL OR o."contentTrustStatus" IS DISTINCT FROM 'active'
      OR o."archivedAt" IS NOT NULL)`,
  job_published_source_untrusted: `SELECT j.id FROM "Job" j LEFT JOIN "JobSource" s ON s.id=j."sourceId"
    WHERE j."publishStatus"='published' AND (s.id IS NULL OR s."approvalStatus" IS DISTINCT FROM 'approved'
      OR s."trustStatus" IS DISTINCT FROM 'active' OR s."archivedAt" IS NOT NULL)`,
  job_published_decision_unproven: `SELECT j.id FROM "Job" j WHERE j."publishStatus"='published' AND (
    (SELECT d.action='approve' AND d."toStatus"='approved' AND d."contentVersion" IS NOT DISTINCT FROM j."contentVersion"
      AND d."contentHash" IS NOT DISTINCT FROM j."contentHash" AND d."hashAlgorithmVersion" IS NOT DISTINCT FROM j."hashAlgorithmVersion"
      AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL
      AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL FROM "ReviewDecision" d WHERE d."targetType"='job' AND d."targetId"=j.id
      AND d.action IN ('approve','reject') AND d."occurredAt"<=$1 ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1)
      IS DISTINCT FROM true OR
    (SELECT d.action='publish' AND d."toStatus"='published' AND d."contentVersion" IS NOT DISTINCT FROM j."contentVersion"
      AND d."contentHash" IS NOT DISTINCT FROM j."contentHash" AND d."hashAlgorithmVersion" IS NOT DISTINCT FROM j."hashAlgorithmVersion"
      AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL
      AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL FROM "ReviewDecision" d WHERE d."targetType"='job' AND d."targetId"=j.id
      AND d.action IN ('publish','unpublish') AND d."occurredAt"<=$1 ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1)
      IS DISTINCT FROM true)`,
  job_published_dependency_decision_unproven: `SELECT j.id FROM "Job" j LEFT JOIN "JobSource" s ON s.id=j."sourceId"
    WHERE j."publishStatus"='published' AND (
      (SELECT d.action='trust_activate' AND d."toStatus"='active' AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL
        AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL
        FROM "ReviewDecision" d WHERE d."targetType"='organization_content_trust'
        AND d."targetId"=j."sourceOrgId" AND d.action IN ('trust_activate','trust_suspend','trust_revoke')
        AND d."occurredAt"<=$1 ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1) IS DISTINCT FROM true OR
      (SELECT d.action='source_approve' AND d."toStatus"='approved' AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL
        AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL
        FROM "ReviewDecision" d WHERE d."targetType"='job_source' AND d."targetId"=s.id
        AND d.action IN ('source_approve','source_reject','source_revoke') AND d."occurredAt"<=$1
        ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1) IS DISTINCT FROM true OR
      (SELECT d.action='trust_activate' AND d."toStatus"='active' AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL
        AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL
        FROM "ReviewDecision" d WHERE d."targetType"='job_source' AND d."targetId"=s.id
        AND d.action IN ('trust_activate','trust_suspend','trust_revoke') AND d."occurredAt"<=$1
        ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1) IS DISTINCT FROM true)`,
  job_duplicate_source_external_id: `SELECT DISTINCT j.id FROM "Job" j JOIN (SELECT "sourceId","externalId" FROM "Job"
    WHERE "sourceId" IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)>1) d USING("sourceId","externalId")`,
  job_duplicate_org_external_id: `SELECT DISTINCT j.id FROM "Job" j JOIN (SELECT "sourceOrgId","externalId" FROM "Job"
    GROUP BY 1,2 HAVING COUNT(*)>1) d USING("sourceOrgId","externalId")`,
  fair_source_missing_or_orphan: `SELECT f.id FROM "JobFair" f LEFT JOIN "JobSource" s ON s.id=f."sourceId"
    WHERE f."sourceId" IS NULL OR BTRIM(f."sourceId")='' OR s.id IS NULL`,
  fair_source_org_mismatch: `SELECT f.id FROM "JobFair" f JOIN "JobSource" s ON s.id=f."sourceId"
    WHERE s."orgId"<>f."sourceOrgId"`,
  fair_duplicate_source_external_id: `SELECT DISTINCT f.id FROM "JobFair" f JOIN (SELECT "sourceId","externalId"
    FROM "JobFair" WHERE "sourceId" IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)>1) d USING("sourceId","externalId")`,
  fair_duplicate_org_external_id: `SELECT DISTINCT f.id FROM "JobFair" f JOIN (SELECT "sourceOrgId","externalId"
    FROM "JobFair" GROUP BY 1,2 HAVING COUNT(*)>1) d USING("sourceOrgId","externalId")`,
  fair_published_ended_information: `SELECT id FROM "JobFair" WHERE "publishStatus"='published' AND "endAt"<$1`,
  policy_org_missing_or_untrusted: `SELECT p.id FROM "PolicyPost" p LEFT JOIN "Organization" o ON o.id=p."sourceOrgId"
    WHERE o.id IS NULL OR o."contentTrustStatus" IS DISTINCT FROM 'active' OR o."archivedAt" IS NOT NULL`,
  agency_source_org_missing_or_orphan: `SELECT a.id FROM "OfflineAgency" a LEFT JOIN "Organization" o
    ON o.id=NULLIF(BTRIM(a."sourceOrgId"),'') WHERE a."sourceOrgId" IS NULL OR BTRIM(a."sourceOrgId")='' OR o.id IS NULL`,
  agency_duplicate_normalized_name_address: `WITH n AS (SELECT id,LOWER(REGEXP_REPLACE(BTRIM(name),'\\s+',' ','g')) n,
    LOWER(REGEXP_REPLACE(BTRIM(address),'\\s+',' ','g')) a FROM "OfflineAgency"), d AS
    (SELECT n,a FROM n GROUP BY 1,2 HAVING COUNT(*)>1) SELECT n.id FROM n JOIN d USING(n,a)`,
  agency_structured_region_absent_by_schema: `SELECT id FROM "OfflineAgency"`,
  agency_profile_missing: `SELECT a.id FROM "OfflineAgency" a LEFT JOIN "OfflineAgencyProfile" p
    ON p."organizationId"=a."sourceOrgId" WHERE p.id IS NULL`,
  agency_profile_not_ready: `SELECT a.id FROM "OfflineAgency" a JOIN "OfflineAgencyProfile" p
    ON p."organizationId"=a."sourceOrgId" WHERE p."reviewStatus"<>'approved' OR p."publishStatus"<>'published'
      OR p."archivedAt" IS NOT NULL OR p."contentHash" IS NULL OR p."approvedContentHash" IS NULL
      OR p."contentHash"<>p."approvedContentHash" OR p."hashAlgorithmVersion" IS NULL`,
  agency_service_scope_invalid: `SELECT a.id FROM "OfflineAgency" a JOIN "OfflineAgencyProfile" p
    ON p."organizationId"=a."sourceOrgId" WHERE CASE
      WHEN NOT pg_input_is_valid(p."serviceScopeJson",'jsonb') THEN true
      WHEN jsonb_typeof(p."serviceScopeJson"::jsonb)<>'array' THEN true
      ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(p."serviceScopeJson"::jsonb) e
        WHERE jsonb_typeof(e)<>'string' OR BTRIM(e#>>'{}')='') END`,
  agency_structured_branch_missing: `SELECT a.id FROM "OfflineAgency" a LEFT JOIN "OfflineAgencyProfile" p
    ON p."organizationId"=a."sourceOrgId" LEFT JOIN "OfflineAgencyBranch" b ON b."agencyProfileId"=p.id
    AND b."provinceCode" IS NOT NULL AND b."cityCode" IS NOT NULL AND b."districtCode" IS NOT NULL
    WHERE b.id IS NULL`,
  agency_ready_branch_missing: `SELECT a.id FROM "OfflineAgency" a LEFT JOIN "OfflineAgencyProfile" p
    ON p."organizationId"=a."sourceOrgId" WHERE NOT EXISTS (SELECT 1 FROM "OfflineAgencyBranch" b
      WHERE b."agencyProfileId"=p.id AND b.status='active' AND b."reviewStatus"='approved'
      AND b."publishStatus"='published' AND b."archivedAt" IS NULL AND b."provinceCode" IS NOT NULL
      AND b."cityCode" IS NOT NULL AND b."districtCode" IS NOT NULL AND b."contentHash" IS NOT NULL
      AND b."contentHash"=b."approvedContentHash" AND b."hashAlgorithmVersion" IS NOT NULL)`,
  agency_qualification_chain_unproven: `SELECT a.id FROM "OfflineAgency" a JOIN "Organization" o
    ON o.id=a."sourceOrgId" LEFT JOIN "OfflineAgencyProfile" p ON p."organizationId"=o.id
    WHERE o.type IN ('public_employment_service','licensed_hr_agency') AND NOT EXISTS (
      SELECT 1 FROM "OfflineAgencyBranch" b WHERE b."agencyProfileId"=p.id AND b.status='active'
      AND (o.type<>'public_employment_service' OR EXISTS (SELECT 1 FROM "QualificationRecord" q
        WHERE q."organizationId"=o.id AND q."qualificationType"='public_service_authority'
        AND (q."appliesToBranchId" IS NULL OR q."appliesToBranchId"=b.id) AND q.status='valid'
        AND q."archivedAt" IS NULL AND (q."validFrom" IS NULL OR q."validFrom"<=$1)
        AND (q."validUntil" IS NULL OR q."validUntil">=$1) AND q."contentHash"=q."approvedContentHash"
        AND q."hashAlgorithmVersion" IS NOT NULL AND NULLIF(BTRIM(q."issuerName"),'') IS NOT NULL
        AND NULLIF(BTRIM(q.jurisdiction),'') IS NOT NULL AND NULLIF(BTRIM(q."verificationSource"),'') IS NOT NULL
        AND q."verifiedBy" IS NOT NULL AND q."verifiedAt" IS NOT NULL
        AND (SELECT d.action='qualification_verify' AND d."toStatus"='valid'
          AND d."contentVersion" IS NOT DISTINCT FROM q."contentVersion" AND d."contentHash" IS NOT DISTINCT FROM q."contentHash"
          AND d."hashAlgorithmVersion" IS NOT DISTINCT FROM q."hashAlgorithmVersion" AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL
          AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL
          FROM "ReviewDecision" d WHERE d."targetType"='qualification_record'
          AND d."targetId"=q.id AND d.action IN ('qualification_verify','qualification_reject','qualification_revoke','qualification_expire')
          AND d."occurredAt"<=$1 ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1) IS TRUE
        AND EXISTS (SELECT 1 FROM "FileObject" f WHERE f.id=q."evidenceFileId"
          AND f.purpose='qualification_evidence' AND f.visibility='private' AND f.status='active'
          AND f."deletedAt" IS NULL AND (f."expiresAt" IS NULL OR f."expiresAt">=$1))))
      AND (o.type<>'licensed_hr_agency' OR (
        EXISTS (SELECT 1 FROM "QualificationRecord" q WHERE q."organizationId"=o.id
          AND q."qualificationType"='business_license' AND (q."appliesToBranchId" IS NULL OR q."appliesToBranchId"=b.id)
          AND q.status='valid' AND q."archivedAt" IS NULL AND (q."validFrom" IS NULL OR q."validFrom"<=$1)
          AND (q."validUntil" IS NULL OR q."validUntil">=$1)
          AND q."contentHash"=q."approvedContentHash" AND q."hashAlgorithmVersion" IS NOT NULL
          AND NULLIF(BTRIM(q."issuerName"),'') IS NOT NULL AND NULLIF(BTRIM(q.jurisdiction),'') IS NOT NULL
          AND NULLIF(BTRIM(q."verificationSource"),'') IS NOT NULL AND q."verifiedBy" IS NOT NULL AND q."verifiedAt" IS NOT NULL
          AND (SELECT d.action='qualification_verify' AND d."toStatus"='valid'
            AND d."contentVersion" IS NOT DISTINCT FROM q."contentVersion" AND d."contentHash" IS NOT DISTINCT FROM q."contentHash"
            AND d."hashAlgorithmVersion" IS NOT DISTINCT FROM q."hashAlgorithmVersion" AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL
            AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL
            FROM "ReviewDecision" d WHERE d."targetType"='qualification_record'
            AND d."targetId"=q.id AND d.action IN ('qualification_verify','qualification_reject','qualification_revoke','qualification_expire')
            AND d."occurredAt"<=$1 ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1) IS TRUE
          AND EXISTS (SELECT 1 FROM "FileObject" f WHERE f.id=q."evidenceFileId" AND f.purpose='qualification_evidence'
            AND f.visibility='private' AND f.status='active' AND f."deletedAt" IS NULL
            AND (f."expiresAt" IS NULL OR f."expiresAt">=$1)))
        AND EXISTS (SELECT 1 FROM "QualificationRecord" q WHERE q."organizationId"=o.id
          AND q."qualificationType"='hr_service_license' AND (q."appliesToBranchId" IS NULL OR q."appliesToBranchId"=b.id)
          AND q.status='valid' AND q."archivedAt" IS NULL AND (q."validFrom" IS NULL OR q."validFrom"<=$1)
          AND (q."validUntil" IS NULL OR q."validUntil">=$1)
          AND q."contentHash"=q."approvedContentHash" AND q."hashAlgorithmVersion" IS NOT NULL
          AND NULLIF(BTRIM(q."issuerName"),'') IS NOT NULL AND NULLIF(BTRIM(q.jurisdiction),'') IS NOT NULL
          AND NULLIF(BTRIM(q."verificationSource"),'') IS NOT NULL AND q."verifiedBy" IS NOT NULL AND q."verifiedAt" IS NOT NULL
          AND (SELECT d.action='qualification_verify' AND d."toStatus"='valid'
            AND d."contentVersion" IS NOT DISTINCT FROM q."contentVersion" AND d."contentHash" IS NOT DISTINCT FROM q."contentHash"
            AND d."hashAlgorithmVersion" IS NOT DISTINCT FROM q."hashAlgorithmVersion" AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL
            AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL
            FROM "ReviewDecision" d WHERE d."targetType"='qualification_record'
            AND d."targetId"=q.id AND d.action IN ('qualification_verify','qualification_reject','qualification_revoke','qualification_expire')
            AND d."occurredAt"<=$1 ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1) IS TRUE
          AND EXISTS (SELECT 1 FROM "FileObject" f WHERE f.id=q."evidenceFileId" AND f.purpose='qualification_evidence'
            AND f.visibility='private' AND f.status='active' AND f."deletedAt" IS NULL
            AND (f."expiresAt" IS NULL OR f."expiresAt">=$1)))
        AND pg_input_is_valid(p."serviceScopeJson",'jsonb')
        AND (CASE WHEN pg_input_is_valid(p."serviceScopeJson",'jsonb')
          THEN NOT (p."serviceScopeJson"::jsonb ? 'labor_dispatch') ELSE false END OR EXISTS (
            SELECT 1 FROM "QualificationRecord" q WHERE q."organizationId"=o.id
              AND q."qualificationType"='labor_dispatch_permit'
              AND (q."appliesToBranchId" IS NULL OR q."appliesToBranchId"=b.id) AND q.status='valid'
              AND q."archivedAt" IS NULL AND (q."validFrom" IS NULL OR q."validFrom"<=$1)
              AND (q."validUntil" IS NULL OR q."validUntil">=$1)
              AND q."contentHash"=q."approvedContentHash" AND q."hashAlgorithmVersion" IS NOT NULL
              AND NULLIF(BTRIM(q."issuerName"),'') IS NOT NULL AND NULLIF(BTRIM(q.jurisdiction),'') IS NOT NULL
              AND NULLIF(BTRIM(q."verificationSource"),'') IS NOT NULL AND q."verifiedBy" IS NOT NULL AND q."verifiedAt" IS NOT NULL
              AND (SELECT d.action='qualification_verify' AND d."toStatus"='valid'
                AND d."contentVersion" IS NOT DISTINCT FROM q."contentVersion" AND d."contentHash" IS NOT DISTINCT FROM q."contentHash"
                AND d."hashAlgorithmVersion" IS NOT DISTINCT FROM q."hashAlgorithmVersion" AND NULLIF(BTRIM(d."actorRole"),'') IS NOT NULL
                AND NULLIF(BTRIM(d."correlationId"),'') IS NOT NULL AND NULLIF(BTRIM(d."requestId"),'') IS NOT NULL
                FROM "ReviewDecision" d WHERE d."targetType"='qualification_record'
                AND d."targetId"=q.id AND d.action IN ('qualification_verify','qualification_reject','qualification_revoke','qualification_expire')
                AND d."occurredAt"<=$1 ORDER BY d."occurredAt" DESC,d.id DESC LIMIT 1) IS TRUE
              AND EXISTS (SELECT 1 FROM "FileObject" f WHERE f.id=q."evidenceFileId"
                AND f.purpose='qualification_evidence' AND f.visibility='private' AND f.status='active'
                AND f."deletedAt" IS NULL AND (f."expiresAt" IS NULL OR f."expiresAt">=$1))))))`,
  offline_job_duplicate_external_id: `SELECT DISTINCT j.id FROM "OfflineJob" j JOIN (SELECT "agencyId","externalId"
    FROM "OfflineJob" WHERE "externalId" IS NOT NULL AND BTRIM("externalId")<>'' GROUP BY 1,2 HAVING COUNT(*)>1) d
    USING("agencyId","externalId")`,
  offline_job_parent_invisible: `SELECT j.id FROM "OfflineJob" j LEFT JOIN "OfflineAgency" a ON a.id=j."agencyId"
    WHERE j.status='active' AND NOT(COALESCE(a.status,'')='active' AND COALESCE(a."reviewStatus",'')='approved'
      AND COALESCE(a."publishStatus",'')='published')`,
  offline_job_employer_missing_by_schema: `SELECT id FROM "OfflineJob"`,
  offline_job_structured_city_missing_by_schema: `SELECT id FROM "OfflineJob"`,
  offline_job_source_url_missing: `SELECT id FROM "OfflineJob" WHERE "externalUrl" IS NULL OR BTRIM("externalUrl")=''`,
  offline_job_partial_canonical_mapping: `SELECT id FROM "OfflineJob"
    WHERE ("canonicalJobId" IS NULL)<>("migrationChecksum" IS NULL)`,
  audit_invalid_payload_json: `SELECT id FROM "AuditLog" WHERE
    (action LIKE 'job.%' OR action LIKE 'fair.%' OR action LIKE 'policy.%' OR action LIKE 'offline_agency%'
      OR action LIKE 'data_source.%' OR action LIKE 'recruitment.%')
    AND NOT pg_input_is_valid("payloadJson",'jsonb')`,
  audit_negative_action_reason_missing_candidate: `WITH p AS (SELECT id,action,CASE WHEN pg_input_is_valid("payloadJson",'jsonb')
    THEN "payloadJson"::jsonb END payload FROM "AuditLog" WHERE
      action LIKE 'job.%' OR action LIKE 'fair.%' OR action LIKE 'policy.%' OR action LIKE 'offline_agency%'
      OR action LIKE 'data_source.%' OR action LIKE 'recruitment.%') SELECT id FROM p WHERE payload IS NOT NULL AND
    (payload->>'action' IN ('reject','unpublish','archive','delete','disable','suspend','revoke','expire')
      OR payload->>'publishStatus'='unpublished' OR action IN ('policy.unpublish','policy.delete','job.partner_unpublish',
      'fair.partner_unpublish','offline_agency.delete','offline_agency_job.delete','data_source.admin_disable',
      'data_source.content_bulk_unpublish'))
    AND BTRIM(COALESCE(payload->>'reason',''))=''`,
  decision_negative_reason_missing: `SELECT id FROM "ReviewDecision"
    WHERE action~'(reject|unpublish|archive|delete|disable|suspend|revoke|expire)$' AND BTRIM(COALESCE(reason,''))=''`,
}

const CURRENT_READER_SQL: Record<PublicEntity, string> = {
  jobs: `SELECT id FROM "Job" WHERE "reviewStatus"='approved' AND "publishStatus"='published'`,
  jobFairs: `SELECT id FROM "JobFair" WHERE "reviewStatus"='approved' AND "publishStatus"='published' AND
    (NOT $1::boolean OR NOT(LEFT("sourceOrgId",8)='org_vff_' OR LEFT("externalId",4)='VFF-'
      OR POSITION('example.org' IN "sourceUrl")>0 OR POSITION('验证' IN "sourceName")>0
      OR POSITION('验证' IN title)>0 OR POSITION('验证' IN venue)>0 OR POSITION('验证' IN city)>0))`,
  policies: `SELECT id FROM "PolicyPost" WHERE "reviewStatus"='approved' AND "publishStatus"='published'`,
  offlineAgencies: `SELECT id FROM "OfflineAgency" WHERE "reviewStatus"='approved'
    AND "publishStatus"='published' AND status='active'`,
  offlineJobs: `SELECT j.id FROM "OfflineJob" j JOIN "OfflineAgency" a ON a.id=j."agencyId"
    WHERE j.status='active' AND a.status='active' AND a."reviewStatus"='approved' AND a."publishStatus"='published'`,
}

const URL_SQL = `SELECT entity,field_name,id,raw_url,domains,policy FROM (SELECT 'job' entity,'source_url' field_name,j.id,LEFT(j."sourceUrl",2049) raw_url,s."allowedContentDomainsJson" domains,
  s."redirectPolicy" policy FROM "Job" j LEFT JOIN "JobSource" s ON s.id=j."sourceId"
  UNION ALL SELECT 'job_fair','source_url',f.id,LEFT(f."sourceUrl",2049),s."allowedContentDomainsJson",s."redirectPolicy"
    FROM "JobFair" f LEFT JOIN "JobSource" s ON s.id=f."sourceId"
  UNION ALL SELECT 'job_fair','checkin_url',f.id,LEFT(f."checkinUrl",2049),s."allowedContentDomainsJson",s."redirectPolicy"
    FROM "JobFair" f LEFT JOIN "JobSource" s ON s.id=f."sourceId" WHERE f."checkinUrl" IS NOT NULL
  UNION ALL SELECT 'policy','external_url',p.id,LEFT(p."externalUrl",2049),NULL,NULL FROM "PolicyPost" p WHERE p."externalUrl" IS NOT NULL
  UNION ALL SELECT 'offline_agency','website',a.id,LEFT(a.website,2049),NULL,NULL FROM "OfflineAgency" a WHERE a.website IS NOT NULL
  UNION ALL SELECT 'offline_job','external_url',j.id,LEFT(j."externalUrl",2049),NULL,NULL FROM "OfflineJob" j
    WHERE j."externalUrl" IS NOT NULL) u ORDER BY entity,id,field_name LIMIT ${MAX_IDS + 1}`

export async function collectFullInventory(
  query: QueryRows,
  identity: RecruitmentWave2DatabaseIdentity,
  excludeDemoFairData: boolean
): Promise<FullInventorySnapshot> {
  const at = identity.inventoryAsOf
  const counts: Record<string, number> = {}
  for (const [key, sql] of Object.entries(COUNT_SQL)) counts[key] = await count(query, sql)
  const grouped: FullInventorySnapshot['grouped'] = {}
  for (const [key, sql] of Object.entries(GROUP_SQL)) {
    const rows = await query<{ key: string; count: number }>(sql, sql.includes('$1') ? [at] : [])
    grouped[key] = rows.map((row) => ({ key: row.key, count: Number(row.count) }))
  }
  const issues: Record<string, string[]> = {}
  for (const [key, sql] of Object.entries(ISSUE_SQL)) {
    issues[key] = await ids(query, sql, sql.includes('$1') ? [at] : [])
  }
  const urlRows = await query<{
    entity: string
    field_name: string
    id: string
    raw_url: string
    domains: string | null
    policy: string | null
  }>(URL_SQL)
  if (urlRows.length > MAX_IDS) throw new Error('RECRUITMENT_WAVE2_INVENTORY_URL_LIMIT')
  classifyInventoryUrls(urlRows, issues)
  const currentReaderIds = {} as PublicIdSets
  for (const [entity, sql] of Object.entries(CURRENT_READER_SQL) as Array<[PublicEntity, string]>) {
    currentReaderIds[entity] = await ids(
      query,
      sql,
      entity === 'jobFairs' ? [excludeDemoFairData] : []
    )
  }
  const targetSafeIds: PublicIdSets = {
    jobs: [],
    jobFairs: [],
    policies: [],
    offlineAgencies: [],
    offlineJobs: [],
  }
  issues['job_final_redirect_evidence_unavailable'] = [...currentReaderIds.jobs]
  issues['legacy_agency_target_reader_not_switched'] = [...currentReaderIds.offlineAgencies]
  issues['legacy_offline_job_target_reader_not_switched'] = [...currentReaderIds.offlineJobs]
  const queryPlanSha256 = sha256(
    JSON.stringify({ COUNT_SQL, GROUP_SQL, ISSUE_SQL, CURRENT_READER_SQL, URL_SQL })
  )
  const targetSafeSupport = {
    jobs: 'not_proven_missing_final_redirect_and_link_check_evidence',
    jobFairs: 'not_defined_in_frozen_target_model',
    policies: 'not_defined_in_frozen_target_model',
    offlineAgencies: 'legacy_reader_not_target_profile_reader',
    offlineJobs: 'legacy_reader_not_canonical_job_reader',
    onlinePlatformDirectories: 'endpoint_absent',
    offlineAgencyProfiles: 'endpoint_absent',
  }
  const digestPayload = {
    migrationCount: identity.migrationCount,
    latestMigration: identity.latestMigration,
    counts,
    grouped,
    issues,
    currentReaderIds,
    targetSafeIds,
    targetSafeSupport,
    queryPlanSha256,
  }
  return {
    identity,
    ruleVersion: 'recruitment-wave2-full-inventory-v1',
    queryPlanSha256,
    counts,
    grouped,
    issues,
    currentReaderIds,
    targetSafeIds,
    targetSafeSupport,
    snapshotDigest: sha256(JSON.stringify(digestPayload)),
  }
}

export function classifyInventoryUrls(
  rows: Array<{
    entity: string
    field_name: string
    id: string
    raw_url: string
    domains: string | null
    policy: string | null
  }>,
  issues: Record<string, string[]>
): void {
  const add = (key: string, id: string) => {
    const values = (issues[key] ??= [])
    if (!values.includes(id)) values.push(id)
  }
  for (const row of rows) {
    const issuePrefix = `${row.entity}_${row.field_name}`
    if (row.raw_url.length > 2048) {
      add(`${issuePrefix}_too_long`, row.id)
      continue
    }
    let parsed: URL | null = null
    try {
      parsed = new URL(row.raw_url)
    } catch {
      add(`${issuePrefix}_invalid`, row.id)
      continue
    }
    if (parsed.protocol !== 'https:') add(`${issuePrefix}_non_https`, row.id)
    if (parsed.username || parsed.password) add(`${issuePrefix}_credentials`, row.id)
    if (isIP(parsed.hostname) && !isPublicAddress(parsed.hostname))
      add(`${issuePrefix}_unsafe_host`, row.id)
    if (row.entity === 'job' || row.entity === 'job_fair') {
      const domainPolicy = parseDomainPolicy(row.domains ?? '')
      if (
        !domainPolicy.valid ||
        (row.policy !== 'allowlist_only' && row.policy !== 'same_host_only')
      ) {
        add(`${issuePrefix}_domain_policy_invalid`, row.id)
      } else if (!validateLandingUrl(row.raw_url, domainPolicy.domains).allowedDomain) {
        add(`${issuePrefix}_out_of_allowed_domain`, row.id)
      }
    } else {
      add(`${issuePrefix}_domain_policy_unavailable`, row.id)
    }
  }
  for (const value of Object.values(issues)) value.sort()
}

async function ids(query: QueryRows, sql: string, values: unknown[] = []): Promise<string[]> {
  const rows = await query<{ id: string }>(`${sql} ORDER BY id LIMIT ${MAX_IDS + 1}`, values)
  if (rows.length > MAX_IDS) throw new Error('RECRUITMENT_WAVE2_INVENTORY_ID_LIMIT')
  const result = rows.map((row) => row.id)
  if (result.some((id) => !/^[A-Za-z0-9_-]{1,128}$/u.test(id)))
    throw new Error('RECRUITMENT_WAVE2_INVENTORY_ID_INVALID')
  return result
}

async function count(query: QueryRows, sql: string): Promise<number> {
  const rows = await query<{ count: number }>(sql)
  return Number(rows[0]?.count ?? 0)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
