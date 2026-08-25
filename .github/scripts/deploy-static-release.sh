#!/usr/bin/env bash

set -euo pipefail

: "${SOURCE_ROOT:?SOURCE_ROOT is required}"
: "${RUNTIME_ROOT:?RUNTIME_ROOT is required}"
: "${TARGET_SHA:?TARGET_SHA is required}"
: "${PENDING_SOURCE:?PENDING_SOURCE is required}"
: "${RELEASE_ATTEMPT:?RELEASE_ATTEMPT is required}"

APPROVED_RUNTIME_ROOT="/srv/ai-job-print"
if [ "${DEPLOY_STATIC_TEST_MODE:-false}" = true ]; then
  case "$RUNTIME_ROOT" in
    "${TMPDIR:-/tmp}"/*) ;;
    *) echo "::error::test runtime root must stay under TMPDIR" >&2; exit 1 ;;
  esac
else
  if [ "$RUNTIME_ROOT" != "$APPROVED_RUNTIME_ROOT" ]; then
    echo "::error::static release runtime root is not approved" >&2
    exit 1
  fi
fi

if ! printf '%s\n' "$TARGET_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "::error::TARGET_SHA must be a full lowercase commit SHA" >&2
  exit 1
fi
if [ "${DEPLOY_STATIC_TEST_MODE:-false}" != true ] &&
  ! printf '%s\n' "$RELEASE_ATTEMPT" | grep -Eq '^[0-9]+-[1-9][0-9]*$'; then
  echo "::error::RELEASE_ATTEMPT must be a GitHub run id and run attempt" >&2
  exit 1
fi
STATIC_STATUS_FILE="$RUNTIME_ROOT/.STATIC_RELEASE_STATUS-$TARGET_SHA-$RELEASE_ATTEMPT"
if [ ! -f "$STATIC_STATUS_FILE" ] || [ -L "$STATIC_STATUS_FILE" ] ||
  ! grep -Fxq 'not-switched' "$STATIC_STATUS_FILE"; then
  echo "::error::static release status is missing, unsafe, or not in not-switched state" >&2
  exit 1
fi
if [ ! -f "$PENDING_SOURCE" ] || [ -L "$PENDING_SOURCE" ]; then
  echo "::error::pending provenance is missing or unsafe" >&2
  exit 1
fi
grep -Fxq "source=origin/main@$TARGET_SHA" "$PENDING_SOURCE"
grep -Fxq "release_attempt=$RELEASE_ATTEMPT" "$PENDING_SOURCE"

APPS="kiosk admin partner"
for app in $APPS; do
  source_dir="$SOURCE_ROOT/apps/$app/dist"
  target_dir="$RUNTIME_ROOT/apps/$app/dist"
  stage_dir="$RUNTIME_ROOT/apps/$app/.dist.deploy-$TARGET_SHA"
  rollback_dir="$RUNTIME_ROOT/apps/$app/.dist.rollback-$TARGET_SHA"
  failed_dir="$RUNTIME_ROOT/apps/$app/.dist.failed-$TARGET_SHA"

  if [ ! -f "$source_dir/index.html" ] || [ -L "$source_dir" ]; then
    echo "::error::$app source dist is missing or unsafe" >&2
    exit 1
  fi
  if [ ! -d "$target_dir" ] || [ -L "$target_dir" ]; then
    echo "::error::$app production dist is missing or unsafe" >&2
    exit 1
  fi
  if [ -e "$stage_dir" ] || [ -e "$rollback_dir" ] || [ -e "$failed_dir" ]; then
    echo "::error::$app has a stale deployment staging directory" >&2
    exit 1
  fi
done

cleanup_stages() {
  for app in $APPS; do
    stage_dir="$RUNTIME_ROOT/apps/$app/.dist.deploy-$TARGET_SHA"
    if [ -d "$stage_dir" ] && [ ! -L "$stage_dir" ]; then
      rm -rf -- "$stage_dir"
    fi
  done
}
trap cleanup_stages EXIT

for app in $APPS; do
  source_dir="$SOURCE_ROOT/apps/$app/dist"
  stage_dir="$RUNTIME_ROOT/apps/$app/.dist.deploy-$TARGET_SHA"
  mkdir -- "$stage_dir"
  rsync -a --delete -- "$source_dir/" "$stage_dir/"
  cmp -s "$source_dir/index.html" "$stage_dir/index.html"
done

switched_apps=""
release_committed=false
rollback_static() {
  rollback_failed=0
  for app in $switched_apps; do
    target_dir="$RUNTIME_ROOT/apps/$app/dist"
    rollback_dir="$RUNTIME_ROOT/apps/$app/.dist.rollback-$TARGET_SHA"
    failed_dir="$RUNTIME_ROOT/apps/$app/.dist.failed-$TARGET_SHA"
    if [ -d "$rollback_dir" ] && [ ! -L "$rollback_dir" ]; then
      if [ -e "$failed_dir" ]; then
        echo "::error::$app static rollback destination already exists" >&2
        rollback_failed=1
        continue
      fi
      if [ -d "$target_dir" ] && [ ! -L "$target_dir" ]; then
        if ! mv -- "$target_dir" "$failed_dir"; then
          echo "::error::$app current static target could not be preserved; rollback anchor was left untouched" >&2
          rollback_failed=1
          continue
        fi
      elif [ -e "$target_dir" ]; then
        echo "::error::$app current static target became unsafe during rollback" >&2
        rollback_failed=1
        continue
      fi
      mv -- "$rollback_dir" "$target_dir" || rollback_failed=1
    elif [ ! -d "$target_dir" ] || [ -L "$target_dir" ]; then
      echo "::error::$app has neither a safe active dist nor a rollback directory" >&2
      rollback_failed=1
    fi
  done
  return "$rollback_failed"
}

release_failure() {
  status=$?
  cleanup_stages
  if [ "${DEPLOY_STATIC_TEST_MODE:-false}" = true ] &&
    [ -n "${DEPLOY_STATIC_TEST_CONFLICT_FAILED_APP:-}" ]; then
    mkdir -p "$RUNTIME_ROOT/apps/$DEPLOY_STATIC_TEST_CONFLICT_FAILED_APP/.dist.failed-$TARGET_SHA"
  fi
  if [ "$release_committed" != true ] &&
    [ -f "$RUNTIME_ROOT/DEPLOY_SOURCE.txt" ] &&
    [ ! -L "$RUNTIME_ROOT/DEPLOY_SOURCE.txt" ] &&
    grep -Fxq "source=origin/main@$TARGET_SHA" "$RUNTIME_ROOT/DEPLOY_SOURCE.txt" &&
    grep -Fxq 'status=full-ready' "$RUNTIME_ROOT/DEPLOY_SOURCE.txt" &&
    grep -Fxq "release_attempt=$RELEASE_ATTEMPT" "$RUNTIME_ROOT/DEPLOY_SOURCE.txt"; then
    release_committed=true
  fi
  if [ "$release_committed" = true ]; then
    printf '%s\n' 'committed' > "$STATIC_STATUS_FILE"
    exit "$status"
  fi
  rollback_ready=true
  if [ "$release_committed" != true ] && [ -n "$switched_apps" ]; then
    if ! rollback_static; then
      rollback_ready=false
      echo "::error::automatic static rollback was incomplete; manual recovery is required" >&2
      echo "STATIC_ROLLBACK_STATUS=incomplete" >&2
      for app in $switched_apps; do
        echo "STATIC_ROLLBACK_ANCHOR_APP=$app"
      done
    else
      echo "STATIC_ROLLBACK_STATUS=ready" >&2
    fi
    if ! { nginx -t >/dev/null 2>&1 && { nginx -s reload || systemctl reload nginx; } >/dev/null 2>&1; }; then
      rollback_ready=false
      echo "::error::nginx could not be reloaded after static rollback; manual recovery is required" >&2
      echo "STATIC_ROLLBACK_NGINX_STATUS=failed" >&2
    else
      echo "STATIC_ROLLBACK_NGINX_STATUS=ready" >&2
    fi
  fi
  if [ "$rollback_ready" = true ]; then
    printf '%s\n' 'rolled-back' > "$STATIC_STATUS_FILE"
  else
    printf '%s\n' 'incomplete' > "$STATIC_STATUS_FILE"
  fi
  exit "$status"
}
trap release_failure EXIT

for app in $APPS; do
  target_dir="$RUNTIME_ROOT/apps/$app/dist"
  stage_dir="$RUNTIME_ROOT/apps/$app/.dist.deploy-$TARGET_SHA"
  rollback_dir="$RUNTIME_ROOT/apps/$app/.dist.rollback-$TARGET_SHA"
  printf '%s\n' 'switching' > "$STATIC_STATUS_FILE"
  switched_apps="$app $switched_apps"
  mv -- "$target_dir" "$rollback_dir"
  if [ "${DEPLOY_STATIC_TEST_MODE:-false}" = true ] &&
    [ "${DEPLOY_STATIC_TEST_TERM_AFTER_BACKUP_APP:-}" = "$app" ]; then
    kill -TERM "$$"
  fi
  if ! mv -- "$stage_dir" "$target_dir"; then
    echo "::error::$app static switch failed; automatic static rollback is starting" >&2
    exit 1
  fi
done

if ! nginx -t || ! { nginx -s reload || systemctl reload nginx; }; then
  echo "::error::nginx validation/reload failed; automatic static rollback is starting" >&2
  exit 1
fi

for app in $APPS; do
  cmp -s "$SOURCE_ROOT/apps/$app/dist/index.html" "$RUNTIME_ROOT/apps/$app/dist/index.html"
done
for app_port in kiosk:80 admin:8081 partner:8082; do
  app="${app_port%%:*}"
  port="${app_port##*:}"
  curl -fsS --max-time 10 "http://127.0.0.1:$port/" |
    cmp -s - "$RUNTIME_ROOT/apps/$app/dist/index.html"
done
curl -fsS http://127.0.0.1:3010/api/v1/health | grep -q '"status":"ok"'
curl -fsS http://127.0.0.1:3010/api/v1/health/ready | grep -q '"status":"ready"'

SOURCE_COMMIT_TMP="$(mktemp "$RUNTIME_ROOT/.DEPLOY_SOURCE.committing.XXXXXX")"
sed 's/^status=.*/status=full-ready/' "$PENDING_SOURCE" > "$SOURCE_COMMIT_TMP"
chmod 0644 "$SOURCE_COMMIT_TMP"
if ! mv -f -- "$SOURCE_COMMIT_TMP" "$RUNTIME_ROOT/DEPLOY_SOURCE.txt"; then
  echo "::error::full provenance commit failed; automatic static rollback is starting" >&2
  exit 1
fi
if [ "${DEPLOY_STATIC_TEST_MODE:-false}" = true ] &&
  [ "${DEPLOY_STATIC_TEST_TERM_AFTER_PROVENANCE:-false}" = true ]; then
  kill -TERM "$$"
fi
printf '%s\n' 'committed' > "$STATIC_STATUS_FILE"
release_committed=true
trap - EXIT
rm -f -- "$PENDING_SOURCE" || echo "::warning::pending provenance could not be removed"
for app in $APPS; do
  rollback_dir="$RUNTIME_ROOT/apps/$app/.dist.rollback-$TARGET_SHA"
  rm -rf -- "$rollback_dir" || echo "::warning::$app rollback directory could not be removed"
done

echo "STATIC_RELEASE_STATUS=committed"
