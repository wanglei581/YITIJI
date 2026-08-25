#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
RETENTION="$ROOT/.github/scripts/deploy-backup-retention.sh"
STATIC_RELEASE="$ROOT/.github/scripts/deploy-static-release.sh"
API_RELEASE="$ROOT/.github/scripts/deploy-api-release.sh"
API_RESTORE="$ROOT/.github/scripts/deploy-api-restore.sh"
WHOLE_RELEASE_CLASSIFIER="$ROOT/.github/scripts/classify-whole-release-state.sh"
CLEANUP_WORKFLOW="$ROOT/.github/workflows/cleanup-stale-releases.yml"
CLEANUP_SOURCE="$ROOT/.github/scripts/cleanup-stale-releases.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ai-job-print-deploy-safety.XXXXXX")"
cleanup() {
  chmod -R u+w "$TMP" 2>/dev/null || true
  rm -rf -- "$TMP"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

make_group() {
  local root="$1" stem="$2" stamp="$3"
  printf 'database backup\n' > "$root/$stem.dump"
  mkdir -p "$root/$stem.runtime/apps/kiosk/dist"
  printf 'runtime\n' > "$root/$stem.runtime/apps/kiosk/dist/index.html"
  touch -t "$stamp" "$root/$stem.dump" "$root/$stem.runtime"
}

BACKUPS="$TMP/backups"
mkdir -p "$BACKUPS"
S1="pre-1111111111111111111111111111111111111111-20260820T010101Z"
S2="pre-2222222222222222222222222222222222222222-20260821T010101Z"
S3="pre-3333333333333333333333333333333333333333-20260822T010101Z"
make_group "$BACKUPS" "$S1" 202608200101.01
make_group "$BACKUPS" "$S2" 202608210101.01
make_group "$BACKUPS" "$S3" 202608220101.01

printf 'manual\n' > "$BACKUPS/manual backup.dump"
mkdir -p "$BACKUPS/manual backup.runtime"
printf 'orphan\n' > "$BACKUPS/pre-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-20260819T010101Z.dump"
ln -s "$BACKUPS/$S3.runtime" "$BACKUPS/pre-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-20260818T010101Z.runtime"
for name in 'evidence.json' 'literal*star' 'literal?question' 'literal[bracket]'; do
  printf 'keep\n' > "$BACKUPS/$name"
done

DRY_OUTPUT="$(BACKUP_ROOT="$BACKUPS" BACKUP_ROOT_EXPECTED="$BACKUPS" DEPLOY_BACKUP_KEEP=2 DEPLOY_BACKUP_DRY_RUN=true bash "$RETENTION")"
printf '%s\n' "$DRY_OUTPUT" | grep -q 'BACKUP_STANDARD_GROUPS=3' || fail 'standard pair count'
printf '%s\n' "$DRY_OUTPUT" | grep -q 'BACKUP_PLAN_DELETE=1' || fail 'dry-run delete count'
printf '%s\n' "$DRY_OUTPUT" | grep -q 'BACKUP_PLAN_DELETE_SHA8=11111111' || fail 'dry-run delete fingerprint'
test -f "$BACKUPS/$S1.dump" || fail 'dry-run changed a backup'

for bad_keep in '' 0 -1 abc '3 '; do
  if BACKUP_ROOT="$BACKUPS" BACKUP_ROOT_EXPECTED="$BACKUPS" DEPLOY_BACKUP_KEEP="$bad_keep" DEPLOY_BACKUP_DRY_RUN=false bash "$RETENTION" >/dev/null 2>&1; then
    fail "invalid KEEP was accepted"
  fi
  test -f "$BACKUPS/$S1.dump" || fail 'invalid KEEP deleted a backup'
done

CURRENT_OUTPUT="$(BACKUP_ROOT="$BACKUPS" BACKUP_ROOT_EXPECTED="$BACKUPS" CURRENT_BACKUP_STEM="$S1" DEPLOY_BACKUP_KEEP=1 DEPLOY_BACKUP_DRY_RUN=true bash "$RETENTION")"
printf '%s\n' "$CURRENT_OUTPUT" | grep -q 'BACKUP_PLAN_KEEP=2' || fail 'current backup was not protected'

PROVENANCE="$TMP/DEPLOY_SOURCE.txt"
cat > "$PROVENANCE" <<EOF
source=origin/main@3333333333333333333333333333333333333333
backup=$BACKUPS/$S1.dump
runtime_backup=$BACKUPS/$S1.runtime
EOF
PROTECTED_OUTPUT="$(BACKUP_ROOT="$BACKUPS" BACKUP_ROOT_EXPECTED="$BACKUPS" DEPLOY_SOURCE_FILE="$PROVENANCE" DEPLOY_BACKUP_KEEP=1 DEPLOY_BACKUP_DRY_RUN=true bash "$RETENTION")"
printf '%s\n' "$PROTECTED_OUTPUT" | grep -q 'BACKUP_PROTECTED_BY_PROVENANCE=1' || fail 'provenance anchors were not recognized'
printf '%s\n' "$PROTECTED_OUTPUT" | grep -q 'BACKUP_PLAN_KEEP=2' || fail 'provenance backup group was not protected'

EXEC_OUTPUT="$(BACKUP_ROOT="$BACKUPS" BACKUP_ROOT_EXPECTED="$BACKUPS" DEPLOY_BACKUP_KEEP=2 DEPLOY_BACKUP_DRY_RUN=false bash "$RETENTION")"
printf '%s\n' "$EXEC_OUTPUT" | grep -q 'BACKUP_PLAN_DELETE_SHA8=11111111' || fail 'execute plan drifted from dry-run'
test ! -e "$BACKUPS/$S1.dump" || fail 'old dump was not deleted'
test ! -e "$BACKUPS/$S1.runtime" || fail 'old runtime was not deleted'
test -f "$BACKUPS/manual backup.dump" || fail 'non-standard dump was deleted'
test -L "$BACKUPS/pre-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-20260818T010101Z.runtime" || fail 'symlink was followed or deleted'

make_static_fixture() {
  local fixture="$1" sha="$2" attempt="$3" app
  mkdir -p "$fixture/source/apps" "$fixture/runtime/apps" "$fixture/bin"
  for app in kiosk admin partner; do
    mkdir -p "$fixture/source/apps/$app/dist" "$fixture/runtime/apps/$app/dist"
    printf '<html>%s-new</html>\n' "$app" > "$fixture/source/apps/$app/dist/index.html"
    printf '%s-new\n' "$app" > "$fixture/source/apps/$app/dist/app.js"
    printf '<html>%s-old</html>\n' "$app" > "$fixture/runtime/apps/$app/dist/index.html"
    printf '%s-old\n' "$app" > "$fixture/runtime/apps/$app/dist/old.js"
  done
  cat > "$fixture/pending" <<EOF
source=origin/main@$sha
scope=api+kiosk+admin+partner
status=static-pending
ci_run=$attempt
release_attempt=$attempt
EOF
  cat > "$fixture/bin/nginx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$fixture/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [ "${FAKE_CURL_FAIL:-false}" = true ]; then exit 22; fi
case "$*" in
  *127.0.0.1:80/*) cat "${FAKE_STATIC_RUNTIME:?}/apps/kiosk/dist/index.html" ;;
  *127.0.0.1:8081/*) cat "${FAKE_STATIC_RUNTIME:?}/apps/admin/dist/index.html" ;;
  *127.0.0.1:8082/*) cat "${FAKE_STATIC_RUNTIME:?}/apps/partner/dist/index.html" ;;
  *health/ready*) printf '{"data":{"status":"ready"}}\n' ;;
  *) printf '{"data":{"status":"ok"}}\n' ;;
esac
EOF
  chmod +x "$fixture/bin/nginx" "$fixture/bin/systemctl" "$fixture/bin/curl"
}

STATIC_SHA="4444444444444444444444444444444444444444"
STATIC_OK="$TMP/static-ok"
make_static_fixture "$STATIC_OK" "$STATIC_SHA" ok
printf '%s\n' 'not-switched' > "$STATIC_OK/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-ok"
PATH="$STATIC_OK/bin:$PATH" \
  FAKE_STATIC_RUNTIME="$STATIC_OK/runtime" \
  DEPLOY_STATIC_TEST_MODE=true \
  SOURCE_ROOT="$STATIC_OK/source" \
  RUNTIME_ROOT="$STATIC_OK/runtime" \
  TARGET_SHA="$STATIC_SHA" \
  PENDING_SOURCE="$STATIC_OK/pending" \
  RELEASE_ATTEMPT=ok \
  bash "$STATIC_RELEASE" >/dev/null
for app in kiosk admin partner; do
  grep -q "$app-new" "$STATIC_OK/runtime/apps/$app/dist/index.html" || fail "$app static site was not committed"
  test ! -e "$STATIC_OK/runtime/apps/$app/dist/old.js" || fail "$app stale static asset remained"
done
grep -q '^status=full-ready$' "$STATIC_OK/runtime/DEPLOY_SOURCE.txt" || fail 'full release provenance was not committed'
grep -Fxq 'committed' "$STATIC_OK/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-ok" || fail 'successful static release did not record committed status'

SYNC="$TMP/runtime-sync"
mkdir -p "$SYNC/source/services/api" "$SYNC/runtime/services/api" "$SYNC/runtime/apps/kiosk/dist" \
  "$SYNC/runtime/apps/kiosk/.dist.rollback-anchor" "$SYNC/runtime/apps/admin/.dist.failed-anchor"
printf 'new source\n' > "$SYNC/source/source-only.txt"
printf 'old runtime\n' > "$SYNC/runtime/runtime-only.txt"
printf 'source=origin/main@0000000000000000000000000000000000000000\nstatus=full-ready\n' > "$SYNC/runtime/DEPLOY_SOURCE.txt"
printf 'source=origin/main@1111111111111111111111111111111111111111\nstatus=api-ready-static-pending\n' > "$SYNC/runtime/API_DEPLOY_SOURCE.txt"
printf 'pending full\n' > "$SYNC/runtime/.DEPLOY_SOURCE.pending-test"
printf 'pending api\n' > "$SYNC/runtime/.API_DEPLOY_SOURCE.pending-test"
printf 'not-switched\n' > "$SYNC/runtime/.STATIC_RELEASE_STATUS-test"
printf 'secret env\n' > "$SYNC/runtime/services/api/.env"
printf 'old kiosk\n' > "$SYNC/runtime/apps/kiosk/dist/index.html"
rsync -a --delete \
  --exclude '/DEPLOY_SOURCE.txt' \
  --exclude '/API_DEPLOY_SOURCE.txt' \
  --exclude '/.DEPLOY_SOURCE.*' \
  --exclude '/.API_DEPLOY_SOURCE.*' \
  --exclude '/.STATIC_RELEASE_STATUS-*' \
  --exclude '/apps/*/.dist.*' \
  --exclude 'services/api/.env' \
  --exclude 'apps/kiosk/dist' \
  "$SYNC/source/" "$SYNC/runtime/"
test -f "$SYNC/runtime/DEPLOY_SOURCE.txt" || fail 'API runtime sync deleted full provenance'
test -f "$SYNC/runtime/API_DEPLOY_SOURCE.txt" || fail 'API runtime sync deleted API provenance'
test -f "$SYNC/runtime/.DEPLOY_SOURCE.pending-test" || fail 'API runtime sync deleted pending full provenance'
test -f "$SYNC/runtime/.API_DEPLOY_SOURCE.pending-test" || fail 'API runtime sync deleted pending API provenance'
test -f "$SYNC/runtime/.STATIC_RELEASE_STATUS-test" || fail 'API runtime sync deleted whole-release state'
test -f "$SYNC/runtime/services/api/.env" || fail 'API runtime sync deleted the protected API env'
grep -q 'old kiosk' "$SYNC/runtime/apps/kiosk/dist/index.html" || fail 'API runtime sync changed protected kiosk static assets'
test -d "$SYNC/runtime/apps/kiosk/.dist.rollback-anchor" || fail 'API runtime sync deleted a static rollback anchor'
test -d "$SYNC/runtime/apps/admin/.dist.failed-anchor" || fail 'API runtime sync deleted a static failed-release anchor'
test ! -e "$SYNC/runtime/runtime-only.txt" || fail 'API runtime sync did not delete an ordinary stale runtime file'
test -f "$SYNC/runtime/source-only.txt" || fail 'API runtime sync did not copy ordinary source files'

STATIC_FAIL="$TMP/static-fail"
make_static_fixture "$STATIC_FAIL" "$STATIC_SHA" fail
printf 'source=origin/main@0000000000000000000000000000000000000000\nstatus=full-ready\n' > "$STATIC_FAIL/runtime/DEPLOY_SOURCE.txt"
printf '%s\n' 'not-switched' > "$STATIC_FAIL/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-fail"
if PATH="$STATIC_FAIL/bin:$PATH" \
  FAKE_STATIC_RUNTIME="$STATIC_FAIL/runtime" \
  FAKE_CURL_FAIL=true \
  DEPLOY_STATIC_TEST_MODE=true \
  SOURCE_ROOT="$STATIC_FAIL/source" \
  RUNTIME_ROOT="$STATIC_FAIL/runtime" \
  TARGET_SHA="$STATIC_SHA" \
  PENDING_SOURCE="$STATIC_FAIL/pending" \
  RELEASE_ATTEMPT=fail \
  bash "$STATIC_RELEASE" >/dev/null 2>&1; then
  fail 'static release accepted a failed final health check'
fi
for app in kiosk admin partner; do
  grep -q "$app-old" "$STATIC_FAIL/runtime/apps/$app/dist/index.html" || fail "$app static rollback did not restore the old site"
done
grep -q 'origin/main@0000000000000000000000000000000000000000' "$STATIC_FAIL/runtime/DEPLOY_SOURCE.txt" || fail 'failed static release changed active provenance'
grep -Fxq 'rolled-back' "$STATIC_FAIL/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-fail" || fail 'failed static release did not record rolled-back status'

STATIC_TERM_SWITCH="$TMP/static-term-switch"
make_static_fixture "$STATIC_TERM_SWITCH" "$STATIC_SHA" term-switch
printf '%s\n' 'not-switched' > "$STATIC_TERM_SWITCH/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-term-switch"
if PATH="$STATIC_TERM_SWITCH/bin:$PATH" \
  FAKE_STATIC_RUNTIME="$STATIC_TERM_SWITCH/runtime" \
  DEPLOY_STATIC_TEST_MODE=true \
  DEPLOY_STATIC_TEST_TERM_AFTER_BACKUP_APP=admin \
  SOURCE_ROOT="$STATIC_TERM_SWITCH/source" \
  RUNTIME_ROOT="$STATIC_TERM_SWITCH/runtime" \
  TARGET_SHA="$STATIC_SHA" \
  PENDING_SOURCE="$STATIC_TERM_SWITCH/pending" \
  RELEASE_ATTEMPT=term-switch \
  bash "$STATIC_RELEASE" >/dev/null 2>&1; then
  fail 'static release ignored TERM after moving a production directory'
fi
for app in kiosk admin partner; do
  grep -q "$app-old" "$STATIC_TERM_SWITCH/runtime/apps/$app/dist/index.html" || fail "$app static rollback failed after TERM during switching"
done
grep -Fxq 'rolled-back' "$STATIC_TERM_SWITCH/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-term-switch" || fail 'TERM during switching did not record rolled-back status'

STATIC_TERM_PROVENANCE="$TMP/static-term-provenance"
make_static_fixture "$STATIC_TERM_PROVENANCE" "$STATIC_SHA" term-provenance
printf '%s\n' 'not-switched' > "$STATIC_TERM_PROVENANCE/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-term-provenance"
if PATH="$STATIC_TERM_PROVENANCE/bin:$PATH" \
  FAKE_STATIC_RUNTIME="$STATIC_TERM_PROVENANCE/runtime" \
  DEPLOY_STATIC_TEST_MODE=true \
  DEPLOY_STATIC_TEST_TERM_AFTER_PROVENANCE=true \
  SOURCE_ROOT="$STATIC_TERM_PROVENANCE/source" \
  RUNTIME_ROOT="$STATIC_TERM_PROVENANCE/runtime" \
  TARGET_SHA="$STATIC_SHA" \
  PENDING_SOURCE="$STATIC_TERM_PROVENANCE/pending" \
  RELEASE_ATTEMPT=term-provenance \
  bash "$STATIC_RELEASE" >/dev/null 2>&1; then
  fail 'static release ignored TERM after provenance commit'
fi
for app in kiosk admin partner; do
  grep -q "$app-new" "$STATIC_TERM_PROVENANCE/runtime/apps/$app/dist/index.html" || fail "$app committed static site was incorrectly rolled back after provenance commit"
done
grep -q '^status=full-ready$' "$STATIC_TERM_PROVENANCE/runtime/DEPLOY_SOURCE.txt" || fail 'committed provenance was lost after TERM'
grep -Fxq 'committed' "$STATIC_TERM_PROVENANCE/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-term-provenance" || fail 'TERM after provenance did not preserve committed status'

STATIC_ROLLBACK_INCOMPLETE="$TMP/static-rollback-incomplete"
make_static_fixture "$STATIC_ROLLBACK_INCOMPLETE" "$STATIC_SHA" rollback-incomplete
printf '%s\n' 'not-switched' > "$STATIC_ROLLBACK_INCOMPLETE/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-rollback-incomplete"
if ROLLBACK_OUTPUT="$(PATH="$STATIC_ROLLBACK_INCOMPLETE/bin:$PATH" \
  FAKE_STATIC_RUNTIME="$STATIC_ROLLBACK_INCOMPLETE/runtime" \
  FAKE_CURL_FAIL=true \
  DEPLOY_STATIC_TEST_MODE=true \
  DEPLOY_STATIC_TEST_CONFLICT_FAILED_APP=kiosk \
  SOURCE_ROOT="$STATIC_ROLLBACK_INCOMPLETE/source" \
  RUNTIME_ROOT="$STATIC_ROLLBACK_INCOMPLETE/runtime" \
  TARGET_SHA="$STATIC_SHA" \
  PENDING_SOURCE="$STATIC_ROLLBACK_INCOMPLETE/pending" \
  RELEASE_ATTEMPT=rollback-incomplete \
  bash "$STATIC_RELEASE" 2>&1)"; then
  fail 'static release accepted an injected rollback failure'
fi
printf '%s\n' "$ROLLBACK_OUTPUT" | grep -q 'STATIC_ROLLBACK_STATUS=incomplete' || fail 'static rollback failure was not surfaced'
printf '%s\n' "$ROLLBACK_OUTPUT" | grep -q 'STATIC_ROLLBACK_ANCHOR_APP=kiosk' || fail 'static rollback failure did not identify its recovery anchor app'
test -d "$STATIC_ROLLBACK_INCOMPLETE/runtime/apps/kiosk/.dist.rollback-$STATIC_SHA" || fail 'static rollback failure did not preserve the old kiosk anchor'
grep -q 'kiosk-new' "$STATIC_ROLLBACK_INCOMPLETE/runtime/apps/kiosk/dist/index.html" || fail 'static rollback failure unexpectedly rewrote the active kiosk directory'
grep -Fxq 'incomplete' "$STATIC_ROLLBACK_INCOMPLETE/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-rollback-incomplete" || fail 'static rollback failure did not persist incomplete status'

STATIC_SAME_SHA_RETRY="$TMP/static-same-sha-retry"
make_static_fixture "$STATIC_SAME_SHA_RETRY" "$STATIC_SHA" new-attempt
cat > "$STATIC_SAME_SHA_RETRY/runtime/DEPLOY_SOURCE.txt" <<EOF
source=origin/main@$STATIC_SHA
status=full-ready
ci_run=old-attempt
EOF
printf '%s\n' 'not-switched' > "$STATIC_SAME_SHA_RETRY/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-new-attempt"
if PATH="$STATIC_SAME_SHA_RETRY/bin:$PATH" \
  FAKE_STATIC_RUNTIME="$STATIC_SAME_SHA_RETRY/runtime" \
  DEPLOY_STATIC_TEST_MODE=true \
  DEPLOY_STATIC_TEST_TERM_AFTER_BACKUP_APP=admin \
  SOURCE_ROOT="$STATIC_SAME_SHA_RETRY/source" \
  RUNTIME_ROOT="$STATIC_SAME_SHA_RETRY/runtime" \
  TARGET_SHA="$STATIC_SHA" \
  PENDING_SOURCE="$STATIC_SAME_SHA_RETRY/pending" \
  RELEASE_ATTEMPT=new-attempt \
  bash "$STATIC_RELEASE" >/dev/null 2>&1; then
  fail 'same-SHA retry ignored TERM during a new release attempt'
fi
for app in kiosk admin partner; do
  grep -q "$app-old" "$STATIC_SAME_SHA_RETRY/runtime/apps/$app/dist/index.html" || fail "$app trusted stale full-ready provenance from another attempt"
done
grep -Fxq 'rolled-back' "$STATIC_SAME_SHA_RETRY/runtime/.STATIC_RELEASE_STATUS-$STATIC_SHA-new-attempt" || fail 'same-SHA retry did not roll back the current attempt'

CLASSIFY="$TMP/classify"
mkdir -p "$CLASSIFY/runtime"
CLASSIFY_SHA="6666666666666666666666666666666666666666"
CLASSIFY_RUN=123456
CLASSIFY_ATTEMPT=789012-1
CLASSIFY_STATUS="$CLASSIFY/runtime/.STATIC_RELEASE_STATUS-$CLASSIFY_SHA-$CLASSIFY_ATTEMPT"
printf '%s\n' 'not-switched' > "$CLASSIFY_STATUS"
cat > "$CLASSIFY/runtime/API_DEPLOY_SOURCE.txt" <<EOF
source=origin/main@$CLASSIFY_SHA
status=api-ready-static-pending
ci_run=$CLASSIFY_RUN
release_attempt=$CLASSIFY_ATTEMPT
EOF
CLASSIFIED="$(RUNTIME_ROOT="$CLASSIFY/runtime" EXPECTED_SHA="$CLASSIFY_SHA" RELEASE_ATTEMPT="$CLASSIFY_ATTEMPT" STATIC_STATUS_FILE="$CLASSIFY_STATUS" bash "$WHOLE_RELEASE_CLASSIFIER")"
[ "$CLASSIFIED" = restore ] || fail 'current API ready marker was not classified for automatic restore'

sed -i.bak 's/^status=.*/status=api-rolled-back/' "$CLASSIFY/runtime/API_DEPLOY_SOURCE.txt"
rm -f -- "$CLASSIFY/runtime/API_DEPLOY_SOURCE.txt.bak"
CLASSIFIED="$(RUNTIME_ROOT="$CLASSIFY/runtime" EXPECTED_SHA="$CLASSIFY_SHA" RELEASE_ATTEMPT="$CLASSIFY_ATTEMPT" STATIC_STATUS_FILE="$CLASSIFY_STATUS" bash "$WHOLE_RELEASE_CLASSIFIER")"
[ "$CLASSIFIED" = restored ] || fail 'completed API rollback was not classified as already restored'
sed -i.bak 's/^status=.*/status=api-ready-static-pending/' "$CLASSIFY/runtime/API_DEPLOY_SOURCE.txt"
rm -f -- "$CLASSIFY/runtime/API_DEPLOY_SOURCE.txt.bak"

cat > "$CLASSIFY/runtime/DEPLOY_SOURCE.txt" <<EOF
source=origin/main@$CLASSIFY_SHA
status=full-ready
ci_run=999999
release_attempt=111111-1
EOF
CLASSIFIED="$(RUNTIME_ROOT="$CLASSIFY/runtime" EXPECTED_SHA="$CLASSIFY_SHA" RELEASE_ATTEMPT="$CLASSIFY_ATTEMPT" STATIC_STATUS_FILE="$CLASSIFY_STATUS" bash "$WHOLE_RELEASE_CLASSIFIER")"
[ "$CLASSIFIED" = restore ] || fail 'same-SHA full-ready marker from another CI run was trusted as committed'

sed -i.bak "s/^release_attempt=.*/release_attempt=$CLASSIFY_ATTEMPT/" "$CLASSIFY/runtime/DEPLOY_SOURCE.txt"
rm -f -- "$CLASSIFY/runtime/DEPLOY_SOURCE.txt.bak"
CLASSIFIED="$(RUNTIME_ROOT="$CLASSIFY/runtime" EXPECTED_SHA="$CLASSIFY_SHA" RELEASE_ATTEMPT="$CLASSIFY_ATTEMPT" STATIC_STATUS_FILE="$CLASSIFY_STATUS" bash "$WHOLE_RELEASE_CLASSIFIER")"
[ "$CLASSIFIED" = committed ] || fail 'current full-ready marker was not classified as committed'

rm -f -- "$CLASSIFY/runtime/DEPLOY_SOURCE.txt" "$CLASSIFY/runtime/API_DEPLOY_SOURCE.txt"
CLASSIFIED="$(RUNTIME_ROOT="$CLASSIFY/runtime" EXPECTED_SHA="$CLASSIFY_SHA" RELEASE_ATTEMPT="$CLASSIFY_ATTEMPT" STATIC_STATUS_FILE="$CLASSIFY_STATUS" bash "$WHOLE_RELEASE_CLASSIFIER")"
[ "$CLASSIFIED" = api-helper ] || fail 'missing API ready marker did not leave rollback ownership with the API helper'

BOUNDARY="$TMP/api-ready-boundary"
mkdir -p "$BOUNDARY/runtime"
BOUNDARY_STATUS="$BOUNDARY/runtime/.STATIC_RELEASE_STATUS-$CLASSIFY_SHA-$CLASSIFY_ATTEMPT"
printf '%s\n' 'not-switched' > "$BOUNDARY_STATUS"
if (
  BOUNDARY="$BOUNDARY" \
    CLASSIFY_SHA="$CLASSIFY_SHA" \
    CLASSIFY_RUN="$CLASSIFY_RUN" \
    CLASSIFY_ATTEMPT="$CLASSIFY_ATTEMPT" \
    BOUNDARY_STATUS="$BOUNDARY_STATUS" \
    WHOLE_RELEASE_CLASSIFIER="$WHOLE_RELEASE_CLASSIFIER" \
    bash -c '
      parent_pid=$$
      trap '\''RUNTIME_ROOT="$BOUNDARY/runtime" EXPECTED_SHA="$CLASSIFY_SHA" RELEASE_ATTEMPT="$CLASSIFY_ATTEMPT" STATIC_STATUS_FILE="$BOUNDARY_STATUS" bash "$WHOLE_RELEASE_CLASSIFIER" > "$BOUNDARY/result"; exit 143'\'' TERM
      (
        cat > "$BOUNDARY/runtime/API_DEPLOY_SOURCE.txt" <<EOF
source=origin/main@$CLASSIFY_SHA
status=api-ready-static-pending
ci_run=$CLASSIFY_RUN
release_attempt=$CLASSIFY_ATTEMPT
EOF
        kill -TERM "$parent_pid"
      ) &
      wait
    '
); then
  fail 'API-ready parent-boundary TERM injection unexpectedly succeeded'
fi
grep -Fxq restore "$BOUNDARY/result" || fail 'TERM after API ready marker did not select automatic restore'

if command -v setsid >/dev/null 2>&1; then
  SIGNAL_FIXTURE="$TMP/api-signal-group"
  mkdir -p "$SIGNAL_FIXTURE/runtime"
  sed -n '/^handle_release_signal() {/,/^}/p' "$API_RELEASE" > "$SIGNAL_FIXTURE/handler.sh"
  grep -q '^handle_release_signal()' "$SIGNAL_FIXTURE/handler.sh" || fail 'API signal handler could not be extracted for Linux process-group test'
  cat > "$SIGNAL_FIXTURE/harness.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source "$SIGNAL_HANDLER"
finish_release() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ]; then
    cat > "$API_MARKER" <<MARKER
source=origin/main@$TARGET_SHA
status=api-rolled-back
ci_run=$CI_RUN
release_attempt=$RELEASE_ATTEMPT
restored_source=origin/main@$OLD_SHA
MARKER
    printf '%s\n' "$status" > "$EXIT_STATUS"
  fi
  exit "$status"
}
trap finish_release EXIT
trap 'handle_release_signal 129' HUP
trap 'handle_release_signal 130' INT
trap 'handle_release_signal 143' TERM
sleep 300 &
wait
EOF
  chmod +x "$SIGNAL_FIXTURE/harness.sh"
  SIGNAL_SHA="8888888888888888888888888888888888888888"
  SIGNAL_OLD_SHA="9999999999999999999999999999999999999999"
  SIGNAL_ATTEMPT=101010-2
  SIGNAL_MARKER="$SIGNAL_FIXTURE/runtime/API_DEPLOY_SOURCE.txt"
  SIGNAL_STATUS="$SIGNAL_FIXTURE/runtime/.STATIC_RELEASE_STATUS-$SIGNAL_SHA-$SIGNAL_ATTEMPT"
  printf '%s\n' 'not-switched' > "$SIGNAL_STATUS"
  SIGNAL_HANDLER="$SIGNAL_FIXTURE/handler.sh" \
    API_MARKER="$SIGNAL_MARKER" \
    EXIT_STATUS="$SIGNAL_FIXTURE/exit-status" \
    TARGET_SHA="$SIGNAL_SHA" \
    OLD_SHA="$SIGNAL_OLD_SHA" \
    CI_RUN=202020 \
    RELEASE_ATTEMPT="$SIGNAL_ATTEMPT" \
    setsid bash "$SIGNAL_FIXTURE/harness.sh" &
  SIGNAL_PID=$!
  sleep 1
  kill -TERM -- "-$SIGNAL_PID"
  if wait "$SIGNAL_PID"; then
    fail 'API helper process group ignored TERM'
  else
    SIGNAL_RC=$?
  fi
  [ "$SIGNAL_RC" -eq 143 ] || fail "API helper TERM exit code was $SIGNAL_RC instead of 143"
  grep -Fxq '143' "$SIGNAL_FIXTURE/exit-status" || fail 'API helper EXIT recovery did not observe the TERM failure status'
  grep -Fxq 'status=api-rolled-back' "$SIGNAL_MARKER" || fail 'API helper TERM recovery did not persist api-rolled-back'
  SIGNAL_CLASSIFIED="$(RUNTIME_ROOT="$SIGNAL_FIXTURE/runtime" EXPECTED_SHA="$SIGNAL_SHA" RELEASE_ATTEMPT="$SIGNAL_ATTEMPT" STATIC_STATUS_FILE="$SIGNAL_STATUS" bash "$WHOLE_RELEASE_CLASSIFIER")"
  [ "$SIGNAL_CLASSIFIED" = restored ] || fail 'parent classifier did not recognize the API helper TERM rollback'
else
  echo "SKIP: real setsid process-group signal test requires Linux; CI must execute it"
fi

RESTORE="$TMP/restore"
RESTORE_SHA="5555555555555555555555555555555555555555"
REAL_NODE="$(command -v node)"
RESTORE_BACKUP="$RESTORE/backups/pre-$RESTORE_SHA-20260822T020202Z.runtime"
mkdir -p \
  "$RESTORE/runtime/services/api/dist" \
  "$RESTORE/runtime/services/api/storage" \
  "$RESTORE_BACKUP/services/api/dist" \
  "$RESTORE_BACKUP/services/api/storage" \
  "$RESTORE/bin" \
  "$RESTORE/home/.pm2"
printf 'new runtime\n' > "$RESTORE/runtime/new-only.txt"
printf 'new upload\n' > "$RESTORE/runtime/services/api/storage/new-upload.pdf"
printf 'rolled-back\n' > "$RESTORE/runtime/.STATIC_RELEASE_STATUS-restore"
printf 'current API marker\n' > "$RESTORE/runtime/API_DEPLOY_SOURCE.txt"
mkdir -p "$RESTORE/runtime/apps/kiosk/.dist.rollback-anchor" "$RESTORE/runtime/apps/partner/.dist.failed-anchor"
printf 'old runtime\n' > "$RESTORE_BACKUP/old-only.txt"
printf 'old api\n' > "$RESTORE_BACKUP/services/api/dist/main.js"
printf 'old storage\n' > "$RESTORE_BACKUP/services/api/storage/old-upload.pdf"
cat > "$RESTORE/bin/node" <<EOF
#!/usr/bin/env bash
if [ "${1:-}" = --version ]; then echo v22.22.0; exit 0; fi
exec "$REAL_NODE" "\$@"
EOF
cat > "$RESTORE/bin/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *health/ready*) printf '{"status":"ready"}\n' ;;
  *) printf '{"status":"ok"}\n' ;;
esac
EOF
cat > "$RESTORE/bin/pm2" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  start)
    env | sort > "${PM2_HOME:?}/start-env"
    cp "${PM2_HOME:?}/start-env" "${PM2_HOME:?}/process-env"
    ;;
  jlist)
    COMMIT="$(sed -n 's/^COMMIT=//p' "${PM2_HOME:?}/process-env")"
    NODE_ENV="$(sed -n 's/^NODE_ENV=//p' "${PM2_HOME:?}/process-env")"
    PII="$(sed -n 's/^PRINT_REQUIRE_PII_SCAN=//p' "${PM2_HOME:?}/process-env")"
    printf '[{"name":"ai-job-print-api","pm2_env":{"status":"online","COMMIT":"%s","NODE_ENV":"%s","PRINT_REQUIRE_PII_SCAN":"%s"}}]\n' "$COMMIT" "$NODE_ENV" "$PII"
    ;;
  save)
    : > "${PM2_HOME:?}/dump.pm2"
    rm -rf -- "${PM2_HOME:?}/dump.pm2.bak"
    case "${PM2_SAVE_SHAPE:-regular}" in
      regular)
        : > "${PM2_HOME:?}/dump.pm2.bak"
        chmod 0644 "${PM2_HOME:?}/dump.pm2.bak"
        ;;
      symlink)
        ln -s dump.pm2 "${PM2_HOME:?}/dump.pm2.bak"
        ;;
      directory)
        mkdir "${PM2_HOME:?}/dump.pm2.bak"
        ;;
      *)
        echo "unsupported PM2_SAVE_SHAPE" >&2
        exit 1
        ;;
    esac
    ;;
esac
exit 0
EOF
chmod +x "$RESTORE/bin/node" "$RESTORE/bin/curl" "$RESTORE/bin/pm2"
PATH="$RESTORE/bin:$PATH" \
  HOME="$RESTORE/home" \
  PM2_HOME="$RESTORE/home/.pm2" \
  DEPLOY_RESTORE_TEST_MODE=true \
  DEPLOY_RESTORE_NODE_BIN="$RESTORE/bin/node" \
  RUNTIME_ROOT="$RESTORE/runtime" \
  BACKUP_ROOT="$RESTORE/backups" \
  RUNTIME_BACKUP="$RESTORE_BACKUP" \
  OLD_SHA="$RESTORE_SHA" \
  bash "$API_RESTORE" >/dev/null
test -f "$RESTORE/runtime/old-only.txt" || fail 'API restore did not restore the previous runtime'
test ! -e "$RESTORE/runtime/new-only.txt" || fail 'API restore left stale release files behind'
test -f "$RESTORE/runtime/services/api/storage/new-upload.pdf" || fail 'API restore deleted mutable local storage'
test ! -e "$RESTORE/runtime/services/api/storage/old-upload.pdf" || fail 'API restore overwrote mutable local storage from the backup'
grep -Fxq 'rolled-back' "$RESTORE/runtime/.STATIC_RELEASE_STATUS-restore" || fail 'API restore deleted the whole-release state record'
grep -Fxq 'current API marker' "$RESTORE/runtime/API_DEPLOY_SOURCE.txt" || fail 'API restore deleted the current attempt marker before recovery completed'
test -d "$RESTORE/runtime/apps/kiosk/.dist.rollback-anchor" || fail 'API restore deleted a static rollback anchor'
test -d "$RESTORE/runtime/apps/partner/.dist.failed-anchor" || fail 'API restore deleted a static failed-release anchor'
grep -Fxq "COMMIT=$RESTORE_SHA" "$RESTORE/home/.pm2/start-env" || fail 'API restore did not restart the old commit'
grep -Fxq 'NODE_ENV=production' "$RESTORE/home/.pm2/start-env" || fail 'API restore did not enforce production mode'
grep -Fxq 'PRINT_REQUIRE_PII_SCAN=true' "$RESTORE/home/.pm2/start-env" || fail 'API restore did not enforce the PII gate'
if grep -Eq '^(DEPLOY_|TARGET_SHA=|CI_RUN=|KIOSK_TERMINAL_AGENT_BRIDGE_TOKEN=)' "$RESTORE/home/.pm2/start-env"; then
  fail 'API restore leaked deployment controls into PM2'
fi
test "$("$RESTORE/bin/node" -e 'const fs = require("node:fs"); process.stdout.write((fs.statSync(process.argv[1]).mode & 0o777).toString(8))' "$RESTORE/home/.pm2/dump.pm2")" = 600 \
  || fail 'API restore did not protect the PM2 dump'
test "$("$RESTORE/bin/node" -e 'const fs = require("node:fs"); process.stdout.write((fs.statSync(process.argv[1]).mode & 0o777).toString(8))' "$RESTORE/home/.pm2/dump.pm2.bak")" = 600 \
  || fail 'API restore did not protect the PM2 backup dump'

RESTORE_TARGET_SHA="7777777777777777777777777777777777777777"
RESTORE_ATTEMPT=888888-1
PATH="$RESTORE/bin:$PATH" \
  HOME="$RESTORE/home" \
  PM2_HOME="$RESTORE/home/.pm2" \
  DEPLOY_RESTORE_TEST_MODE=true \
  DEPLOY_RESTORE_NODE_BIN="$RESTORE/bin/node" \
  RUNTIME_ROOT="$RESTORE/runtime" \
  BACKUP_ROOT="$RESTORE/backups" \
  RUNTIME_BACKUP="$RESTORE_BACKUP" \
  OLD_SHA="$RESTORE_SHA" \
  TARGET_SHA="$RESTORE_TARGET_SHA" \
  CI_RUN=999999 \
  RELEASE_ATTEMPT="$RESTORE_ATTEMPT" \
  DEPLOY_RESTORE_MARKER_FILE="$RESTORE/runtime/API_DEPLOY_SOURCE.txt" \
  bash "$API_RESTORE" >/dev/null
grep -Fxq "source=origin/main@$RESTORE_TARGET_SHA" "$RESTORE/runtime/API_DEPLOY_SOURCE.txt" || fail 'API restore marker lost the attempted source'
grep -Fxq 'status=api-rolled-back' "$RESTORE/runtime/API_DEPLOY_SOURCE.txt" || fail 'API restore did not persist its completed state'
grep -Fxq "release_attempt=$RESTORE_ATTEMPT" "$RESTORE/runtime/API_DEPLOY_SOURCE.txt" || fail 'API restore marker is not attempt-scoped'
grep -Fxq "restored_source=origin/main@$RESTORE_SHA" "$RESTORE/runtime/API_DEPLOY_SOURCE.txt" || fail 'API restore marker lost the restored source'

for PM2_SAVE_SHAPE in symlink directory; do
  if PATH="$RESTORE/bin:$PATH" \
    HOME="$RESTORE/home" \
    PM2_HOME="$RESTORE/home/.pm2" \
    DEPLOY_RESTORE_TEST_MODE=true \
    DEPLOY_RESTORE_NODE_BIN="$RESTORE/bin/node" \
    RUNTIME_ROOT="$RESTORE/runtime" \
    BACKUP_ROOT="$RESTORE/backups" \
    RUNTIME_BACKUP="$RESTORE_BACKUP" \
    OLD_SHA="$RESTORE_SHA" \
    PM2_SAVE_SHAPE="$PM2_SAVE_SHAPE" \
    bash "$API_RESTORE" >/dev/null 2>&1; then
    fail "API restore accepted PM2 backup dump shape: $PM2_SAVE_SHAPE"
  fi
done

CLEANUP_REMOTE_SCRIPT="$(sed -n '/^[[:space:]]*script: |/,$p' "$CLEANUP_WORKFLOW")"
if printf '%s\n' "$CLEANUP_REMOTE_SCRIPT" | grep -Fq '${{ inputs.'; then
  fail 'cleanup workflow interpolates raw GitHub inputs into the remote shell'
fi
grep -Fq 'envs: CLEANUP_REQUEST_EXECUTE,CLEANUP_REQUEST_CONFIRM,CLEANUP_REQUEST_PURGE_PATH' "$CLEANUP_WORKFLOW" \
  || fail 'cleanup workflow does not forward fixed request environment variables'
printf '%s\n' "$CLEANUP_REMOTE_SCRIPT" | grep -Fq 'case "$CLEANUP_REQUEST_EXECUTE" in' \
  || fail 'cleanup workflow does not validate the execute boolean'

CLEANUP_EMBEDDED="$TMP/cleanup-stale-releases.embedded.sh"
sed -n '/^[[:space:]]*base64 -d > "\$TMP" <<'"'"'B64'"'"'$/,/^[[:space:]]*B64$/p' "$CLEANUP_WORKFLOW" \
  | sed '1d;$d;s/^[[:space:]]*//' \
  | base64 -d > "$CLEANUP_EMBEDDED"
cmp -s "$CLEANUP_SOURCE" "$CLEANUP_EMBEDDED" \
  || fail 'cleanup workflow embedded script does not match its reviewed source file'
grep -Fq '[[ "$TARGET" =~ ^/srv/\.cleanup-trash/[0-9]{8}T[0-9]{6}$ ]]' "$CLEANUP_SOURCE" \
  || fail 'purge path is not restricted to one exact timestamp directory'
grep -Fq 'curl -fsS http://127.0.0.1:3010/api/v1/health' "$CLEANUP_SOURCE" \
  || fail 'cleanup follow-up guidance does not use the API global prefix'

echo "ALL PASS: deployment backup retention and atomic static release safety"
