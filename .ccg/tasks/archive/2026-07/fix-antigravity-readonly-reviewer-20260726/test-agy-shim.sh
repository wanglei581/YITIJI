#!/usr/bin/env bash
set -euo pipefail

SHIM="${AGY_SHIM:-$HOME/.local/bin/agy}"
AGENT_FILE="${AGY_AGENT_FILE_UNDER_TEST:-$HOME/.gemini/config/agents/ccg-readonly-reviewer/agent.md}"
EXPECTED_AGENT="ccg-readonly-reviewer"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" == *"$needle"* ]] || fail "expected output to contain: $needle"
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" != *"$needle"* ]] || fail "expected output not to contain: $needle"
}

fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT
fake_real="$fixture_dir/agy.real"
fixture_agent="$fixture_dir/agent.md"
capture_args="$fixture_dir/args.txt"
capture_log_path="$fixture_dir/log-path.txt"
fake_path="$fixture_dir/fake-path"

printf '%s\n' 'fixture agent' >"$fixture_agent"
mkdir -p "$fake_path"
cat >"$fake_path/ps" <<'FAKE_PS'
#!/usr/bin/env bash
exit 1
FAKE_PS
chmod +x "$fake_path/ps"

cat >"$fake_real" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >"$AGY_CAPTURE_ARGS"
log_file=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "--log-file" ]] && (( i + 1 < ${#args[@]} )); then
    log_file="${args[$((i + 1))]}"
  fi
done
printf '%s\n' "$log_file" >"$AGY_CAPTURE_LOG_PATH"
case "${FAKE_MODE:-success}" in
  success)
    printf 'REVIEW_OK\n'
    ;;
  success-with-stderr)
    printf 'REVIEW_OK\n'
    printf 'OAuth: authenticated successfully as success.person@corp.example\n' >&2
    ;;
  soft-deny)
    printf '%s\n' \
      'error getting token source: You are not logged into Antigravity.' \
      'OAuth: authenticated successfully' \
      'admin controls not applicable' \
      'WaitForReady failed: context deadline exceeded' \
      'streamGenerateContent?alt=sse ResponseID: recovered' \
      'Print mode: soft-denying tool confirmation "Bash" at step 3' \
      'Tool confirmation approved=false' >"$log_file"
    ;;
  auth-fail)
    printf '%s\n' \
      'error getting token source: You are not logged into Antigravity.' \
      'failed to get load code assist response' >"$log_file"
    ;;
  recovered-no-output)
    printf '%s\n' \
      'WaitForReady failed: context deadline exceeded' \
      'streamGenerateContent?alt=sse ResponseID: recovered' >"$log_file"
    ;;
  converter-fail)
    printf '%s\n' \
      'OAuth: authenticated successfully as reviewer@example.com' \
      'failed to construct executor: no tool converter registered for view_file' \
      'no tool converter registered for view_file' >"$log_file"
    ;;
  pii-auth-fail)
    printf '%s\n' \
      'error getting token source for secret.person@corp.example: bearer token-should-not-appear' \
      'You are not logged into Antigravity as secret.person@corp.example' >"$log_file"
    ;;
esac
FAKE
chmod +x "$fake_real"

run_wrapper_shim() {
  CODEAGENT_WRAPPER_COMPAT_FORCE=1 \
  AGY_REAL_BIN="$fake_real" \
  AGY_READONLY_AGENT_FILE="$fixture_agent" \
  AGY_CAPTURE_ARGS="$capture_args" \
  AGY_CAPTURE_LOG_PATH="$capture_log_path" \
  FAKE_MODE="${1:-success}" \
  "$SHIM" "${@:2}"
}

output="$(run_wrapper_shim success --add-dir "$PWD" -p 'review')"
assert_contains "$output" 'REVIEW_OK'
args_output="$(<"$capture_args")"
assert_contains "$args_output" '--agent'
assert_contains "$args_output" "$EXPECTED_AGENT"

set +e
custom_output="$(run_wrapper_shim success --agent other-agent -p 'review' 2>&1)"
custom_status=$?
set -e
[[ "$custom_status" -ne 0 ]] || fail 'wrapper invocation with another agent must fail closed'
assert_contains "$custom_output" 'refusing non-readonly agent'

for duplicate_args in \
  '--agent other-agent --agent ccg-readonly-reviewer' \
  '--agent ccg-readonly-reviewer --agent other-agent'; do
  set +e
  duplicate_output="$(run_wrapper_shim success $duplicate_args -p review 2>&1)"
  duplicate_status=$?
  set -e
  [[ "$duplicate_status" -ne 0 ]] || fail 'duplicate agent flags must fail closed'
  assert_contains "$duplicate_output" 'exactly one --agent'
done

set +e
missing_agent_value_output="$(run_wrapper_shim success --agent 2>&1)"
missing_agent_value_status=$?
set -e
[[ "$missing_agent_value_status" -ne 0 ]] || fail 'agent flag without a value must fail closed'
assert_contains "$missing_agent_value_output" '--agent requires a non-option value'

inline_agent_output="$(run_wrapper_shim success --agent=ccg-readonly-reviewer -p review)"
assert_contains "$inline_agent_output" 'REVIEW_OK'

for unsafe_args in \
  '--dangerously-skip-permissions' \
  '--mode accept-edits' \
  '--mode=accept-edits' \
  '--prompt-interactive' \
  '--continue' \
  '--conversation previous-session' \
  '--new-project' \
  '--project another-project'; do
  set +e
  unsafe_output="$(run_wrapper_shim success $unsafe_args -p review 2>&1)"
  unsafe_status=$?
  set -e
  [[ "$unsafe_status" -ne 0 ]] || fail "unsafe wrapper flag must fail closed: $unsafe_args"
  assert_contains "$unsafe_output" 'refusing unsafe option'
done

set +e
outside_dir_output="$(run_wrapper_shim success --add-dir /tmp -p review 2>&1)"
outside_dir_status=$?
set -e
[[ "$outside_dir_status" -ne 0 ]] || fail 'outside add-dir must fail closed'
assert_contains "$outside_dir_output" '--add-dir must resolve to the active workspace'

set +e
duplicate_log_output="$(run_wrapper_shim success --log-file "$fixture_dir/one.log" --log-file "$fixture_dir/two.log" -p review 2>&1)"
duplicate_log_status=$?
set -e
[[ "$duplicate_log_status" -ne 0 ]] || fail 'duplicate log-file flags must fail closed'
assert_contains "$duplicate_log_output" 'at most one --log-file'

set +e
missing_output="$(CODEAGENT_WRAPPER_COMPAT_FORCE=1 AGY_REAL_BIN="$fake_real" AGY_READONLY_AGENT_FILE="$fixture_dir/missing.md" AGY_CAPTURE_ARGS="$capture_args" AGY_CAPTURE_LOG_PATH="$capture_log_path" FAKE_MODE=success "$SHIM" -p review 2>&1)"
missing_status=$?
set -e
[[ "$missing_status" -ne 0 ]] || fail 'missing readonly agent must fail closed'
assert_contains "$missing_output" 'readonly agent definition is missing'

marker_output="$(CODEAGENT_WRAPPER_COMPAT_FORCE=0 AGY_REAL_BIN="$fake_real" AGY_READONLY_AGENT_FILE="$fixture_agent" AGY_CAPTURE_ARGS="$capture_args" AGY_CAPTURE_LOG_PATH="$capture_log_path" FAKE_MODE=success "$SHIM" -p '# Antigravity Role: Code Reviewer')"
assert_contains "$marker_output" 'REVIEW_OK'
marker_args="$(<"$capture_args")"
assert_contains "$marker_args" "$EXPECTED_AGENT"

direct_output="$(PATH="$fake_path:/usr/bin:/bin" AGY_REAL_BIN="$fake_real" AGY_READONLY_AGENT_FILE="$fixture_agent" AGY_CAPTURE_ARGS="$capture_args" AGY_CAPTURE_LOG_PATH="$capture_log_path" FAKE_MODE=success "$SHIM" -p 'direct call')"
assert_contains "$direct_output" 'REVIEW_OK'
direct_args="$(<"$capture_args")"
assert_not_contains "$direct_args" "$EXPECTED_AGENT"

set +e
missing_log_value_output="$(run_wrapper_shim success --log-file 2>&1)"
missing_log_value_status=$?
set -e
[[ "$missing_log_value_status" -ne 0 ]] || fail 'log-file flag without a value must fail closed'
assert_contains "$missing_log_value_output" '--log-file requires a non-option value'

set +e
soft_output="$(run_wrapper_shim soft-deny -p review 2>&1)"
soft_status=$?
set -e
[[ "$soft_status" -ne 0 ]] || fail 'empty soft-deny result must fail'
assert_contains "$soft_output" 'Bash tool permission was denied in non-interactive print mode'
assert_not_contains "$soft_output" 'Fix the Antigravity account, eligibility, login, or quota issue'

set +e
auth_output="$(run_wrapper_shim auth-fail -p review 2>&1)"
auth_status=$?
set -e
[[ "$auth_status" -ne 0 ]] || fail 'unrecovered auth failure must fail'
assert_contains "$auth_output" 'authentication token is unavailable'

set +e
pii_output="$(run_wrapper_shim pii-auth-fail -p review 2>&1)"
pii_status=$?
set -e
[[ "$pii_status" -ne 0 ]] || fail 'PII-bearing auth failure must fail'
assert_contains "$pii_output" 'authentication token is unavailable'
assert_not_contains "$pii_output" 'secret.person@corp.example'
assert_not_contains "$pii_output" 'token-should-not-appear'

success_stderr_output="$(run_wrapper_shim success-with-stderr -p review 2>&1)"
assert_contains "$success_stderr_output" 'REVIEW_OK'
assert_not_contains "$success_stderr_output" 'success.person@corp.example'
assert_not_contains "$success_stderr_output" 'OAuth: authenticated successfully'

set +e
recovered_output="$(run_wrapper_shim recovered-no-output -p review 2>&1)"
recovered_status=$?
set -e
[[ "$recovered_status" -ne 0 ]] || fail 'empty recovered stream must still fail for missing report'
assert_not_contains "$recovered_output" 'WaitForReady failed'
assert_contains "$recovered_output" 'No stdout was returned'

set +e
converter_output="$(run_wrapper_shim converter-fail -p review 2>&1)"
converter_status=$?
set -e
[[ "$converter_status" -ne 0 ]] || fail 'tool converter failure must fail'
assert_contains "$converter_output" 'no tool converter registered'
assert_not_contains "$converter_output" 'view_file'
assert_not_contains "$converter_output" 'reviewer@example.com'
generated_log="$(<"$capture_log_path")"
[[ -f "$generated_log" ]] || fail 'shim-generated agy log is missing'
generated_log_name="$(basename "$generated_log")"
[[ "$generated_log_name" == agy-codeagent-wrapper.* ]] || fail "shim-generated log must use a randomized mktemp name, got $generated_log_name"
[[ ! "$generated_log_name" =~ ^agy-codeagent-wrapper-[0-9]+\.log$ ]] || fail 'shim-generated log must not use a predictable PID-only name'
log_mode="$(stat -f '%Lp' "$generated_log" 2>/dev/null || stat -c '%a' "$generated_log")"
[[ "$log_mode" == '600' ]] || fail "shim-generated agy log mode must be 600, got $log_mode"

success_output="$(run_wrapper_shim success -p review)"
assert_contains "$success_output" 'REVIEW_OK'
successful_log="$(<"$capture_log_path")"
[[ ! -e "$successful_log" ]] || fail 'shim-generated success log must be removed'

[[ -f "$AGENT_FILE" ]] || fail "readonly agent file missing: $AGENT_FILE"
agent_text="$(<"$AGENT_FILE")"
assert_contains "$agent_text" 'name: ccg-readonly-reviewer'
assert_contains "$agent_text" 'commandExecutionPolicy: off'
assert_contains "$agent_text" '  - view_file'
assert_contains "$agent_text" '  - grep_search'
assert_not_contains "$agent_text" '  - read_file'
assert_not_contains "$agent_text" 'run_command'
assert_not_contains "$agent_text" 'edit_file'
assert_not_contains "$agent_text" 'write_file'
assert_contains "$agent_text" 'Never invoke `schedule` or `send_message`'

printf 'PASS: agy shim and readonly reviewer regression suite\n'
