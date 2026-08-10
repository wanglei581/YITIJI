#!/usr/bin/env bash
set -euo pipefail
api_pid=''

cleanup() {
  local cleanup_failed=0
  if [ -n "$api_pid" ]; then
    if kill -0 "$api_pid" 2>/dev/null; then
      kill "$api_pid" 2>/dev/null || cleanup_failed=1
    fi
    wait "$api_pid" 2>/dev/null || true
    api_pid=''
  fi
  dropdb --if-exists --force -h localhost -U ci ai_job_print_recruitment_wave2_ci \
    || cleanup_failed=1
  psql -h localhost -U ci -d postgres -v ON_ERROR_STOP=1 \
    -c 'DROP ROLE IF EXISTS recruitment_wave2_readonly' \
    || cleanup_failed=1
  for path in \
    /tmp/recruitment-wave2-ci-manifest.json \
    /tmp/recruitment-wave2-plan-1.json \
    /tmp/recruitment-wave2-plan-100.json \
    /tmp/recruitment-wave2-plan-1000.json \
    /tmp/recruitment-wave2-full-inventory.json \
    /tmp/rw2-api.log
  do
    if [ -e "$path" ] && ! rm -f -- "$path"; then cleanup_failed=1; fi
  done
  return "$cleanup_failed"
}

on_exit() {
  local command_status=$?
  trap - EXIT
  if ! cleanup; then exit 1; fi
  exit "$command_status"
}

cleanup
trap on_exit EXIT
psql -h localhost -U ci -d postgres -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE recruitment_wave2_readonly LOGIN PASSWORD 'ci-readonly-password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE DATABASE ai_job_print_recruitment_wave2_ci
  WITH TEMPLATE ai_job_print_ci OWNER ci;
SQL
psql -h localhost -U ci -d ai_job_print_recruitment_wave2_ci -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE "_RecruitmentWave2RestoreMarker" (
  restore_nonce text PRIMARY KEY,
  snapshot_sha256 text NOT NULL,
  snapshot_as_of timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
INSERT INTO "_RecruitmentWave2RestoreMarker" VALUES (
  'ci_restore_nonce_000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  now(),now()+interval '1 hour'
);
INSERT INTO "Organization" (
  "id","name","type","enabledModulesJson","enabled","contentTrustStatus","createdAt","updatedAt"
) VALUES ('rw2-org','CI offline agency','licensed_hr_agency','[]',true,'active',now(),now());
INSERT INTO "JobSource" (
  "id","orgId","name","sourceKind","accessMode","syncFreq","enabled","approvalStatus",
  "syncEnabled","trustStatus","allowedContentDomainsJson","redirectPolicy","createdAt","updatedAt"
) VALUES (
  'rw2-source','rw2-org','CI manual evidence source','hr_company','manual','manual',true,
  'approved',false,'active','["jobs.example.test"]','allowlist_only',now(),now()
);
INSERT INTO "FileObject" (
  "id","storageKey","filename","mimeType","sizeBytes","sha256","purpose","visibility","status",
  "sensitiveLevel","assetCategory","createdAt","updatedAt"
) VALUES (
  'rw2-evidence','ci/recruitment-wave2/evidence.pdf','evidence.pdf','application/pdf',1,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','qualification_evidence',
  'private','active','normal','original',now(),now()
);
INSERT INTO "OfflineAgencyProfile" (
  "id","organizationId","displayName","serviceScopeJson","reviewStatus","publishStatus",
  "contentVersion","contentHash","approvedContentHash","hashAlgorithmVersion","createdAt","updatedAt"
) VALUES (
  'rw2-profile','rw2-org','CI agency profile','[]','approved','published',1,
  'profile-hash','profile-hash','content-v1',now(),now()
);
INSERT INTO "OfflineAgencyBranch" (
  "id","agencyProfileId","branchName","provinceCode","cityCode","districtCode","address","status",
  "reviewStatus","publishStatus","contentVersion","contentHash","approvedContentHash",
  "hashAlgorithmVersion","createdAt","updatedAt"
) VALUES (
  'rw2-branch','rw2-profile','CI branch','310000','310100','310101','CI address','active',
  'approved','published',1,'branch-hash','branch-hash','content-v1',now(),now()
);
INSERT INTO "QualificationRecord" (
  "id","organizationId","qualificationType","issuerName","jurisdiction","appliesToBranchId",
  "validFrom","validUntil","status","contentVersion","contentHash","approvedContentHash",
  "hashAlgorithmVersion","evidenceFileId","verificationSource","verifiedBy","verifiedAt","createdAt","updatedAt"
) VALUES
  ('rw2-qualification-business','rw2-org','business_license','CI issuer','310000','rw2-branch',
    '2026-01-01','2099-01-01','valid',1,'business-hash','business-hash','content-v1',
    'rw2-evidence','manual_verified','ci-admin',now(),now(),now()),
  ('rw2-qualification-hr','rw2-org','hr_service_license','CI issuer','310000','rw2-branch',
    '2026-01-01','2099-01-01','valid',1,'hr-hash','hr-hash','content-v1',
    'rw2-evidence','manual_verified','ci-admin',now(),now(),now());
INSERT INTO "ReviewDecision" (
  "id","targetType","targetId","contentVersion","contentHash","hashAlgorithmVersion","action",
  "toStatus","actorRole","occurredAt","correlationId","requestId"
) VALUES
  ('rw2-decision-org-trust','organization_content_trust','rw2-org',NULL,NULL,NULL,
    'trust_activate','active','admin',now(),'rw2-correlation-org','rw2-request-org'),
  ('rw2-decision-source-approve','job_source','rw2-source',NULL,NULL,NULL,
    'source_approve','approved','admin',now(),'rw2-correlation-source-approve','rw2-request-source-approve'),
  ('rw2-decision-source-trust','job_source','rw2-source',NULL,NULL,NULL,
    'trust_activate','active','admin',now(),'rw2-correlation-source-trust','rw2-request-source-trust'),
  ('rw2-decision-profile-approve','offline_agency_profile','rw2-profile',1,'profile-hash','content-v1',
    'approve','approved','admin',now(),'rw2-correlation-profile-approve','rw2-request-profile-approve'),
  ('rw2-decision-profile-publish','offline_agency_profile','rw2-profile',1,'profile-hash','content-v1',
    'publish','published','admin',now(),'rw2-correlation-profile-publish','rw2-request-profile-publish'),
  ('rw2-decision-branch-approve','offline_agency_branch','rw2-branch',1,'branch-hash','content-v1',
    'approve','approved','admin',now(),'rw2-correlation-branch-approve','rw2-request-branch-approve'),
  ('rw2-decision-branch-publish','offline_agency_branch','rw2-branch',1,'branch-hash','content-v1',
    'publish','published','admin',now(),'rw2-correlation-branch-publish','rw2-request-branch-publish'),
  ('rw2-decision-business','qualification_record','rw2-qualification-business',1,'business-hash','content-v1',
    'qualification_verify','valid','admin',now(),'rw2-correlation-business','rw2-request-business'),
  ('rw2-decision-hr','qualification_record','rw2-qualification-hr',1,'hr-hash','content-v1',
    'qualification_verify','valid','admin',now(),'rw2-correlation-hr','rw2-request-hr');
INSERT INTO "OfflineAgency" (
  "id","name","address","status","reviewStatus","publishStatus","sourceOrgId","createdAt","updatedAt"
) VALUES ('rw2-legacy-agency','CI legacy agency','CI legacy address','active','approved','published','rw2-org',now(),now());
INSERT INTO "OfflineJob" (
  "id","agencyId","title","jobType","salaryUnit","headcount","externalId","status","createdAt","updatedAt"
) VALUES (
  'rw2-legacy-job','rw2-legacy-agency','CI legacy job','internship','month',1,
  'ci-legacy-external-id','active',now(),now()
);
UPDATE "_RecruitmentWave2RestoreMarker" SET snapshot_as_of=now()
  WHERE restore_nonce='ci_restore_nonce_000001';
ALTER ROLE recruitment_wave2_readonly SET default_transaction_read_only=on;
GRANT CONNECT ON DATABASE ai_job_print_recruitment_wave2_ci TO recruitment_wave2_readonly;
GRANT USAGE ON SCHEMA public TO recruitment_wave2_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO recruitment_wave2_readonly;
SQL
SNAPSHOT_AS_OF="$(psql -h localhost -U ci -d ai_job_print_recruitment_wave2_ci -Atc \
  'SELECT snapshot_as_of FROM "_RecruitmentWave2RestoreMarker" WHERE restore_nonce='\''ci_restore_nonce_000001'\''')"
cat > /tmp/recruitment-wave2-ci-manifest.json <<JSON
{
  "schemaVersion": 1,
  "ruleVersion": "recruitment-wave2-plan-v1",
  "snapshotSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "asOf": "$(date -u -d "$SNAPSHOT_AS_OF" +%Y-%m-%dT%H:%M:%S.%3NZ)",
  "approvalRef": "AUTH/recruitment-wave2/ci-manifest-001",
  "approvedAt": "$(date -u -d "$SNAPSHOT_AS_OF" +%Y-%m-%dT%H:%M:%S.%3NZ)",
  "agencies": [{
    "disposition": "map",
    "legacyAgencyId": "rw2-legacy-agency",
    "organizationId": "rw2-org",
    "profileId": "rw2-profile",
    "branchId": "rw2-branch"
  }],
  "jobs": [{
    "disposition": "map",
    "legacyJobId": "rw2-legacy-job",
    "organizationId": "rw2-org",
    "jobSourceId": "rw2-source",
    "offlineBranchId": "rw2-branch",
    "employer": "CI verified employer",
    "cityName": "Shanghai",
    "cityCode": "310100",
    "sourceUrl": "https://jobs.example.test/jobs/ci-secret-path",
    "finalUrl": "https://jobs.example.test/jobs/ci-final-path",
    "linkCheckRef": "CI-LINK-CHECK-001"
  }]
}
JSON
export RECRUITMENT_WAVE2_TARGET=ci-fixture
export RECRUITMENT_WAVE2_AUTHORIZATION_REF=AUTH/recruitment-wave2/ci-001
export RECRUITMENT_WAVE2_AUTHORIZED_UNTIL="$(date -u -d '+60 minutes' +%Y-%m-%dT%H:%M:%SZ)"
export RECRUITMENT_WAVE2_EXPECTED_DATABASE=ai_job_print_recruitment_wave2_ci
export RECRUITMENT_WAVE2_RESTORED_READONLY_URL=postgresql://recruitment_wave2_readonly:ci-readonly-password@localhost:5432/ai_job_print_recruitment_wave2_ci
export RECRUITMENT_WAVE2_RESTORE_NONCE=ci_restore_nonce_000001
export RECRUITMENT_WAVE2_SNAPSHOT_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
assert_guard_failure() {
  expected_code="$1"
  set +e
  guard_output="$(pnpm plan:recruitment-wave2 \
    --manifest /tmp/recruitment-wave2-ci-manifest.json --batch-size 1 2>&1)"
  guard_status=$?
  set -e
  if [ "$guard_status" -ne 1 ] || ! grep -q "$expected_code" <<<"$guard_output"; then
    echo "expected guard failure: $expected_code" >&2
    exit 1
  fi
  if grep -Eq 'postgresql://|ci-readonly-password' <<<"$guard_output"; then
    echo "guard output leaked database credentials" >&2
    exit 1
  fi
}
RECRUITMENT_WAVE2_RESTORED_READONLY_URL=postgresql://ci:ci@localhost:5432/ai_job_print_recruitment_wave2_ci
export RECRUITMENT_WAVE2_RESTORED_READONLY_URL
assert_guard_failure RECRUITMENT_WAVE2_ROLE_NOT_READONLY
RECRUITMENT_WAVE2_RESTORED_READONLY_URL=postgresql://recruitment_wave2_readonly:ci-readonly-password@localhost:5432/ai_job_print_recruitment_wave2_ci
RECRUITMENT_WAVE2_RESTORE_NONCE=ci_restore_nonce_wrong
export RECRUITMENT_WAVE2_RESTORED_READONLY_URL RECRUITMENT_WAVE2_RESTORE_NONCE
assert_guard_failure RECRUITMENT_WAVE2_RESTORE_MARKER_MISMATCH
RECRUITMENT_WAVE2_RESTORE_NONCE=ci_restore_nonce_000001
export RECRUITMENT_WAVE2_RESTORE_NONCE
psql -h localhost -U ci -d ai_job_print_recruitment_wave2_ci -v ON_ERROR_STOP=1 \
  -c "UPDATE \"_RecruitmentWave2RestoreMarker\" SET expires_at=now()-interval '1 second'"
assert_guard_failure RECRUITMENT_WAVE2_RESTORE_MARKER_EXPIRED
psql -h localhost -U ci -d ai_job_print_recruitment_wave2_ci -v ON_ERROR_STOP=1 \
  -c "UPDATE \"_RecruitmentWave2RestoreMarker\" SET expires_at=now()+interval '1 hour'"
for batch_size in 1 100 1000; do
  pnpm plan:recruitment-wave2 --manifest /tmp/recruitment-wave2-ci-manifest.json \
    --batch-size "$batch_size" > "/tmp/recruitment-wave2-plan-$batch_size.json"
done
node - <<'NODE'
const fs = require('node:fs')
const reports = [1, 100, 1000].map((size) => JSON.parse(
  fs.readFileSync(`/tmp/recruitment-wave2-plan-${size}.json`, 'utf8'),
))
const checksums = new Set(reports.map((report) => report.plan.planChecksum))
if (checksums.size !== 1) throw new Error('batch-size changed the plan checksum')
if (reports.some((report) => report.plan.jobs.candidate !== 1 || report.plan.jobs.blocker !== 0)) {
  throw new Error('isolated PostgreSQL fixture was not a single safe candidate')
}
const output = JSON.stringify(reports)
for (const forbidden of ['CI verified employer', 'ci-secret-path', 'ci-final-path']) {
  if (output.includes(forbidden)) throw new Error(`planner output leaked fixture content: ${forbidden}`)
}
console.log('Recruitment Wave 2 isolated PostgreSQL read-only planner: PASS')
NODE
psql -h localhost -U ci -d ai_job_print_recruitment_wave2_ci -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "Job" (
  id,"sourceOrgId","sourceId","externalId","sourceName","sourceUrl",title,company,city,
  "reviewStatus","publishStatus","syncTime","createdAt","updatedAt"
) SELECT 'rw2-job-'||LPAD(g::text,3,'0'),'rw2-org','rw2-source','rw2-job-ext-'||g,
  'CI source','https://jobs.example.test/jobs/'||g,'CI job','CI employer','Shanghai',
  'approved','published',TIMESTAMPTZ '2026-01-01',TIMESTAMPTZ '2026-01-01',TIMESTAMPTZ '2026-01-01'
FROM generate_series(1,101) g;
INSERT INTO "JobFair" (
  id,"sourceOrgId","sourceId","externalId","sourceName","sourceUrl","checkinUrl",title,"startAt","endAt",venue,city,
  "reviewStatus","publishStatus","syncTime","createdAt","updatedAt"
) SELECT 'rw2-fair-'||LPAD(g::text,3,'0'),'rw2-org','rw2-source','rw2-fair-ext-'||g,
  'CI source','https://jobs.example.test/fairs/'||g,
  CASE WHEN g=1 THEN 'http://jobs.example.test/checkin/1' ELSE NULL END,
  'CI fair',TIMESTAMPTZ '2099-01-01',
  TIMESTAMPTZ '2099-01-02','CI venue','Shanghai','approved','published',
  TIMESTAMPTZ '2026-01-01',TIMESTAMPTZ '2026-01-01',TIMESTAMPTZ '2026-01-01'
FROM generate_series(1,101) g;
INSERT INTO "PolicyPost" (
  id,"sourceOrgId","sourceName",kind,title,"reviewStatus","publishStatus","syncTime","createdAt","updatedAt"
) SELECT 'rw2-policy-'||LPAD(g::text,3,'0'),'rw2-org','CI source','notice','CI policy',
  'approved','published',TIMESTAMPTZ '2026-01-01',TIMESTAMPTZ '2026-01-01',TIMESTAMPTZ '2026-01-01'
FROM generate_series(1,201) g;
INSERT INTO "OfflineJob" (id,"agencyId",title,"externalId",status,"createdAt","updatedAt")
SELECT 'rw2-offline-job-'||LPAD(g::text,3,'0'),'rw2-legacy-agency','CI offline job',
  'rw2-offline-ext-'||g,'active',TIMESTAMPTZ '2026-01-01',TIMESTAMPTZ '2026-01-01'
FROM generate_series(1,100) g;
UPDATE "OfflineAgencyProfile" SET "serviceScopeJson"='[1]' WHERE id='rw2-profile';
INSERT INTO "ReviewDecision" (
  id,"targetType","targetId","contentVersion","contentHash","hashAlgorithmVersion",action,"toStatus",
  reason,"actorRole","occurredAt","correlationId","requestId"
) VALUES
  ('rw2-source-revoke-latest','job_source','rw2-source',NULL,NULL,NULL,'source_revoke','revoked',
    'CI negative fixture','admin',now(),'rw2-correlation-source-revoke','rw2-request-source-revoke'),
  ('rw2-qualification-revoke-latest','qualification_record','rw2-qualification-hr',1,'hr-hash','content-v1',
    'qualification_revoke','revoked','CI negative fixture','admin',now(),
    'rw2-correlation-qualification-revoke','rw2-request-qualification-revoke');
SQL
DATABASE_URL="$RECRUITMENT_WAVE2_RESTORED_READONLY_URL" NODE_ENV=test PORT=3102 \
  EXCLUDE_DEMO_PUBLIC_DATA=false node -r @swc-node/register src/main.ts >/tmp/rw2-api.log 2>&1 &
api_pid=$!
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3102/api/v1/health >/dev/null; then break; fi
  if [ "$attempt" -eq 30 ]; then echo 'isolated API did not become ready' >&2; exit 1; fi
  sleep 1
done
export RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL=http://127.0.0.1:3102/api/v1
export RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN=http://127.0.0.1:3102
export RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA=false
set +e
pnpm inventory:recruitment-wave2:full >/tmp/recruitment-wave2-full-inventory.json
full_status=$?
set -e
if [ "$full_status" -ne 2 ]; then echo "expected governed-data blockers, got $full_status" >&2; exit 1; fi
node - <<'NODE'
const report = require('/tmp/recruitment-wave2-full-inventory.json')
for (const value of Object.values(report.sets.currentReaderDiff)) {
  if (value.missingFromApi.count || value.unexpectedInApi.count) throw new Error('DB/API ID diff was not empty')
}
const expected = { jobs: 101, jobFairs: 101, policies: 201, offlineAgencies: 1, offlineJobs: 101 }
for (const [key, count] of Object.entries(expected)) {
  if (report.sets.publicApi[key].count !== count) throw new Error(`unexpected ${key} count`)
}
for (const key of ['job_published_dependency_decision_unproven','agency_service_scope_invalid',
  'agency_qualification_chain_unproven','job_fair_checkin_url_non_https']) {
  if (!report.issues[key] || report.issues[key].count < 1) throw new Error(`missing blocker fixture: ${key}`)
}
console.log('Recruitment Wave 2 full PostgreSQL + HTTP inventory: PASS')
NODE
