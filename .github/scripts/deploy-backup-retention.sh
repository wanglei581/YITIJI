#!/usr/bin/env bash

set -euo pipefail

: "${BACKUP_ROOT:?BACKUP_ROOT is required}"

KEEP="${DEPLOY_BACKUP_KEEP-3}"
DRY_RUN="${DEPLOY_BACKUP_DRY_RUN-true}"
CURRENT_STEM="${CURRENT_BACKUP_STEM:-}"
DEPLOY_SOURCE_FILE="${DEPLOY_SOURCE_FILE:-}"

case "$KEEP" in
  '' | *[!0-9]*)
    echo "::error::DEPLOY_BACKUP_KEEP must be a positive integer" >&2
    exit 1
    ;;
esac
if [ "$KEEP" -lt 1 ]; then
  echo "::error::DEPLOY_BACKUP_KEEP must be at least 1" >&2
  exit 1
fi

case "$DRY_RUN" in
  true | false) ;;
  *)
    echo "::error::DEPLOY_BACKUP_DRY_RUN must be true or false" >&2
    exit 1
    ;;
esac

case "$BACKUP_ROOT" in
  /*) ;;
  *)
    echo "::error::BACKUP_ROOT must be an absolute path" >&2
    exit 1
    ;;
esac

case "$BACKUP_ROOT" in
  / | /srv | /var | /root | *'/../'* | *'/..')
    echo "::error::BACKUP_ROOT is not a permitted backup directory" >&2
    exit 1
    ;;
esac

if [ ! -d "$BACKUP_ROOT" ] || [ -L "$BACKUP_ROOT" ]; then
  echo "::error::BACKUP_ROOT must be an existing real directory" >&2
  exit 1
fi

RESOLVED_ROOT="$(cd "$BACKUP_ROOT" && pwd -P)"
if [ -n "${BACKUP_ROOT_EXPECTED:-}" ]; then
  if [ ! -d "$BACKUP_ROOT_EXPECTED" ] || [ -L "$BACKUP_ROOT_EXPECTED" ]; then
    echo "::error::BACKUP_ROOT_EXPECTED must be an existing real directory" >&2
    exit 1
  fi
  RESOLVED_EXPECTED="$(cd "$BACKUP_ROOT_EXPECTED" && pwd -P)"
  if [ "$RESOLVED_ROOT" != "$RESOLVED_EXPECTED" ]; then
    echo "::error::BACKUP_ROOT does not match the approved backup directory" >&2
    exit 1
  fi
fi
BACKUP_ROOT="$RESOLVED_ROOT"

if [ -n "$CURRENT_STEM" ] &&
  ! printf '%s\n' "$CURRENT_STEM" | grep -Eq '^pre-[0-9a-f]{40}-[0-9]{8}T[0-9]{6}Z$'; then
  echo "::error::CURRENT_BACKUP_STEM is not a standard release backup stem" >&2
  exit 1
fi

PROTECTED_STEMS_FILE=""
if [ -n "$DEPLOY_SOURCE_FILE" ]; then
  if [ ! -f "$DEPLOY_SOURCE_FILE" ] || [ -L "$DEPLOY_SOURCE_FILE" ]; then
    echo "::error::DEPLOY_SOURCE_FILE must be an existing real file" >&2
    exit 1
  fi
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ai-job-print-backup-retention.XXXXXX")"
cleanup() {
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT

STEMS_FILE="$TMP_DIR/stems"
VALID_FILE="$TMP_DIR/valid"
PROTECTED_STEMS_FILE="$TMP_DIR/protected"
: > "$STEMS_FILE"
: > "$VALID_FILE"
: > "$PROTECTED_STEMS_FILE"

if [ -n "$DEPLOY_SOURCE_FILE" ]; then
  for key in backup runtime_backup; do
    protected_path="$(sed -n "s/^${key}=//p" "$DEPLOY_SOURCE_FILE" | head -n1)"
    if [ -z "$protected_path" ]; then
      echo "::error::DEPLOY_SOURCE_FILE is missing $key" >&2
      exit 1
    fi
    protected_dir="$(dirname "$protected_path")"
    if [ ! -d "$protected_dir" ] || [ -L "$protected_dir" ] ||
      [ "$(cd "$protected_dir" && pwd -P)" != "$BACKUP_ROOT" ]; then
      echo "::error::DEPLOY_SOURCE_FILE contains an unsafe backup anchor" >&2
      exit 1
    fi
    protected_name="$(basename "$protected_path")"
    case "$key:$protected_name" in
      backup:*.dump | runtime_backup:*.runtime) ;;
      *)
        echo "::error::DEPLOY_SOURCE_FILE backup anchor type is invalid" >&2
        exit 1
        ;;
    esac
    protected_stem="${protected_name%.dump}"
    protected_stem="${protected_stem%.runtime}"
    if ! printf '%s\n' "$protected_stem" | grep -Eq '^pre-[0-9a-f]{40}-[0-9]{8}T[0-9]{6}Z$'; then
      echo "::error::DEPLOY_SOURCE_FILE contains a non-standard backup anchor" >&2
      exit 1
    fi
    if [ "$key" = backup ] && { [ ! -f "$protected_path" ] || [ -L "$protected_path" ]; }; then
      echo "::error::DEPLOY_SOURCE_FILE database backup anchor is missing or unsafe" >&2
      exit 1
    fi
    if [ "$key" = runtime_backup ] && { [ ! -d "$protected_path" ] || [ -L "$protected_path" ]; }; then
      echo "::error::DEPLOY_SOURCE_FILE runtime backup anchor is missing or unsafe" >&2
      exit 1
    fi
    printf '%s\n' "$protected_stem" >> "$PROTECTED_STEMS_FILE"
  done
  sort -u "$PROTECTED_STEMS_FILE" -o "$PROTECTED_STEMS_FILE"
  if [ "$(wc -l < "$PROTECTED_STEMS_FILE" | tr -d ' ')" -ne 1 ]; then
    echo "::error::DEPLOY_SOURCE_FILE backup anchors must identify one complete release group" >&2
    exit 1
  fi
fi

ignored_entries=0
while IFS= read -r -d '' entry; do
  name="$(basename "$entry")"
  if printf '%s\n' "$name" | grep -Eq '^pre-[0-9a-f]{40}-[0-9]{8}T[0-9]{6}Z\.(dump|runtime)$'; then
    printf '%s\n' "${name%.*}" >> "$STEMS_FILE"
  else
    ignored_entries=$((ignored_entries + 1))
  fi
done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -print0)

sort -u "$STEMS_FILE" -o "$STEMS_FILE"

mtime_of() {
  if stat -c '%Y' "$1" >/dev/null 2>&1; then
    stat -c '%Y' "$1"
  else
    stat -f '%m' "$1"
  fi
}

fingerprint_of() {
  if stat -c '%d:%i:%Y:%s' "$1" >/dev/null 2>&1; then
    stat -c '%d:%i:%Y:%s' "$1"
  else
    stat -f '%d:%i:%m:%z' "$1"
  fi
}

orphan_groups=0
standard_groups=0
while IFS= read -r stem; do
  [ -n "$stem" ] || continue
  dump_path="$BACKUP_ROOT/$stem.dump"
  runtime_path="$BACKUP_ROOT/$stem.runtime"
  if [ ! -f "$dump_path" ] || [ -L "$dump_path" ] ||
    [ ! -d "$runtime_path" ] || [ -L "$runtime_path" ]; then
    orphan_groups=$((orphan_groups + 1))
    continue
  fi

  dump_mtime="$(mtime_of "$dump_path")"
  runtime_mtime="$(mtime_of "$runtime_path")"
  if [ "$dump_mtime" -gt "$runtime_mtime" ]; then
    group_mtime="$dump_mtime"
  else
    group_mtime="$runtime_mtime"
  fi
  group_kb="$(du -sk "$dump_path" "$runtime_path" | awk '{sum += $1} END {print sum + 0}')"
  group_fingerprint="$(fingerprint_of "$dump_path")|$(fingerprint_of "$runtime_path")"
  printf '%s\t%s\t%s\t%s\n' "$group_mtime" "$stem" "$group_kb" "$group_fingerprint" >> "$VALID_FILE"
  standard_groups=$((standard_groups + 1))
done < "$STEMS_FILE"

sort -rn "$VALID_FILE" -o "$VALID_FILE"

keep_stems=()
delete_stems=()
delete_fingerprints=()
delete_kb=0
index=0
current_found=false
while IFS=$'\t' read -r _mtime stem group_kb group_fingerprint; do
  [ -n "$stem" ] || continue
  index=$((index + 1))
  if [ "$stem" = "$CURRENT_STEM" ]; then
    current_found=true
  fi
  if [ "$index" -le "$KEEP" ] || [ "$stem" = "$CURRENT_STEM" ] ||
    grep -Fxq "$stem" "$PROTECTED_STEMS_FILE"; then
    keep_stems+=("$stem")
  else
    delete_stems+=("$stem")
    delete_fingerprints+=("$group_fingerprint")
    delete_kb=$((delete_kb + group_kb))
  fi
done < "$VALID_FILE"

if [ -n "$CURRENT_STEM" ] && [ "$current_found" != true ]; then
  echo "::error::current release backup is not a complete standard pair" >&2
  exit 1
fi

echo "BACKUP_STANDARD_GROUPS=$standard_groups"
echo "BACKUP_ORPHAN_GROUPS=$orphan_groups"
echo "BACKUP_IGNORED_ENTRIES=$ignored_entries"
keep_count=${#keep_stems[@]}
delete_count=${#delete_stems[@]}
echo "BACKUP_PLAN_KEEP=$keep_count"
echo "BACKUP_PLAN_DELETE=$delete_count"
echo "BACKUP_PROTECTED_BY_PROVENANCE=$(wc -l < "$PROTECTED_STEMS_FILE" | tr -d ' ')"
echo "BACKUP_PLAN_RECLAIM_MB=$(( (delete_kb + 1023) / 1024 ))"

if [ "$delete_count" -gt 0 ]; then
  for stem in "${delete_stems[@]}"; do
    sha="${stem#pre-}"
    echo "BACKUP_PLAN_DELETE_SHA8=${sha:0:8}"
  done
fi

if [ "$orphan_groups" -gt 0 ]; then
  echo "::warning::$orphan_groups incomplete or unsafe standard-looking backup groups were preserved"
fi
if [ "$ignored_entries" -gt 0 ]; then
  echo "::notice::$ignored_entries non-release backup entries were ignored"
fi

if [ "$DRY_RUN" = true ]; then
  echo "BACKUP_RETENTION_MODE=dry-run"
  exit 0
fi

echo "BACKUP_RETENTION_MODE=execute"
if [ "$delete_count" -gt 0 ]; then
  delete_index=0
  for stem in "${delete_stems[@]}"; do
    dump_path="$BACKUP_ROOT/$stem.dump"
    runtime_path="$BACKUP_ROOT/$stem.runtime"
    if [ ! -f "$dump_path" ] || [ -L "$dump_path" ] ||
      [ ! -d "$runtime_path" ] || [ -L "$runtime_path" ]; then
      echo "::error::backup plan changed before deletion; preserving the group" >&2
      exit 1
    fi
    current_fingerprint="$(fingerprint_of "$dump_path")|$(fingerprint_of "$runtime_path")"
    if [ "$current_fingerprint" != "${delete_fingerprints[$delete_index]}" ]; then
      echo "::error::backup identity changed after planning; preserving the group" >&2
      exit 1
    fi
    if ! rm -rf -- "$runtime_path"; then
      echo "::error::failed to delete a planned runtime backup" >&2
      exit 1
    fi
    if [ -e "$runtime_path" ]; then
      echo "::error::planned runtime backup still exists; database backup was preserved" >&2
      exit 1
    fi
    if ! rm -f -- "$dump_path"; then
      echo "::error::failed to delete a planned database backup" >&2
      exit 1
    fi
    if [ -e "$dump_path" ] || [ -e "$runtime_path" ]; then
      echo "::error::a planned backup group still exists after deletion" >&2
      exit 1
    fi
    delete_index=$((delete_index + 1))
  done
fi

echo "BACKUP_RETENTION_DELETED=$delete_count"
