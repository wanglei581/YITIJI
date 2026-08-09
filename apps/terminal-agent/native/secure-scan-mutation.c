#include "secure-scan-internal.h"

#include <stdlib.h>
#include <string.h>

static BOOL write_exact(HANDLE output, const void *buffer, DWORD length) {
  const BYTE *cursor = (const BYTE *)buffer;
  DWORD remaining = length;
  while (remaining > 0) {
    DWORD written = 0;
    if (!WriteFile(output, cursor, remaining, &written, NULL) || written == 0) return FALSE;
    cursor += written; remaining -= written;
  }
  return TRUE;
}

static void put_u32(BYTE *out, uint32_t value) {
  out[0] = (BYTE)value; out[1] = (BYTE)(value >> 8); out[2] = (BYTE)(value >> 16); out[3] = (BYTE)(value >> 24);
}

static void put_u64(BYTE *out, uint64_t value) {
  unsigned index;
  for (index = 0; index < 8; index += 1) out[index] = (BYTE)(value >> (index * 8));
}

BOOL ajps_write_response(uint32_t operation, ajps_identity root, ajps_identity candidate, ajps_identity unclaimed,
  uint64_t size, int64_t mtime_ms, const BYTE *payload, uint32_t payload_length) {
  BYTE header[64];
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  memset(header, 0, sizeof(header));
  memcpy(header, AJPS_RESPONSE_V2, 8);
  put_u32(header + 8, operation);
  put_u32(header + 12, root.volume); put_u64(header + 16, root.file_id);
  put_u32(header + 24, candidate.volume); put_u64(header + 28, candidate.file_id);
  put_u32(header + 36, unclaimed.volume); put_u64(header + 40, unclaimed.file_id);
  put_u64(header + 48, size); put_u64(header + 56, (uint64_t)mtime_ms);
  return write_exact(output, header, sizeof(header))
    && write_exact(output, &payload_length, sizeof(payload_length))
    && (payload_length == 0 || write_exact(output, payload, payload_length));
}

static BOOL zero_identity(ajps_identity identity) { return identity.volume == 0 && identity.file_id == 0; }

static BOOL set_delete_pending(HANDLE handle) {
  FILE_DISPOSITION_INFO disposition;
  disposition.DeleteFile = TRUE;
  return SetFileInformationByHandle(handle, FileDispositionInfo, &disposition, sizeof(disposition));
}

static BOOL rename_into_unclaimed(HANDLE candidate, HANDLE unclaimed, const wchar_t *basename) {
  size_t bytes = wcslen(basename) * sizeof(wchar_t);
  size_t allocation = sizeof(FILE_RENAME_INFO) + bytes;
  FILE_RENAME_INFO *rename_info = (FILE_RENAME_INFO *)calloc(1, allocation);
  BOOL result;
  HANDLE unclaimed_handle = unclaimed;
  if (rename_info == NULL) return FALSE;
  rename_info->ReplaceIfExists = FALSE;
  rename_info->RootDirectory = unclaimed_handle;
  rename_info->FileNameLength = (DWORD)bytes;
  memcpy(rename_info->FileName, basename, bytes);
  result = SetFileInformationByHandle(candidate, FileRenameInfo, rename_info, (DWORD)allocation);
  free(rename_info);
  return result;
}

static BOOL pin_unclaimed(const ajps_pinned_path *root, BOOL create, ajps_pinned_path *unclaimed) {
  wchar_t *path = ajps_join_child(root->canonical, L"_unclaimed");
  BOOL result;
  if (path == NULL) return FALSE;
  result = ajps_pin_directory_chain(path, create, unclaimed);
  free(path);
  return result;
}

int ajps_inspect(const ajps_request *request) {
  ajps_pinned_path root;
  int result = 20;
  if (!ajps_pin_directory_chain(request->root, FALSE, &root)) return ajps_fail(20);
  if (ajps_write_response(OP_INSPECT, root.identity, (ajps_identity){0}, (ajps_identity){0}, 0, 0, NULL, 0)) result = 0;
  ajps_close_pinned_path(&root);
  return result == 0 ? 0 : ajps_fail((unsigned)result);
}

int ajps_read(const ajps_request *request) {
  ajps_pinned_path root;
  HANDLE candidate = INVALID_HANDLE_VALUE;
  BY_HANDLE_FILE_INFORMATION before, after;
  ajps_identity identity;
  BYTE *bytes = NULL;
  uint64_t offset = 0;
  int result = 30;
  if (request->expected_size == 0 || request->expected_size > MAX_SCAN_BYTES || !ajps_pin_directory_chain(request->root, FALSE, &root)) return ajps_fail(31);
  if (!ajps_open_plain_file(&root, request->filename, GENERIC_READ, &candidate, &before)
      || ajps_file_size(&before) != request->expected_size
      || ajps_unix_mtime_ms(&before) != request->expected_mtime_ms
      || !ajps_identity_from_handle(candidate, &identity)) goto cleanup;
  bytes = (BYTE *)malloc((size_t)request->expected_size);
  if (bytes == NULL) goto cleanup;
  while (offset < request->expected_size) {
    DWORD wanted = (DWORD)((request->expected_size - offset) > 1048576u ? 1048576u : request->expected_size - offset), received = 0;
    if (!ReadFile(candidate, bytes + offset, wanted, &received, NULL) || received == 0) goto cleanup;
    offset += received;
  }
  if (!GetFileInformationByHandle(candidate, &after)
      || !ajps_information_matches(&after, request->expected_size, request->expected_mtime_ms, identity)) goto cleanup;
  if (ajps_write_response(OP_READ, root.identity, identity, (ajps_identity){0}, request->expected_size,
      request->expected_mtime_ms, bytes, (uint32_t)request->expected_size)) result = 0;
cleanup:
  free(bytes);
  if (candidate != INVALID_HANDLE_VALUE) CloseHandle(candidate);
  ajps_close_pinned_path(&root);
  return result == 0 ? 0 : ajps_fail((unsigned)result);
}

int ajps_finalize(const ajps_request *request, BOOL quarantine) {
  ajps_pinned_path root, unclaimed;
  HANDLE candidate = INVALID_HANDLE_VALUE;
  BY_HANDLE_FILE_INFORMATION information;
  int result = 40;
  if (zero_identity(request->root_identity) || zero_identity(request->candidate_identity)
      || !ajps_pin_directory_chain(request->root, FALSE, &root)) return ajps_fail(41);
  memset(&unclaimed, 0, sizeof(unclaimed)); unclaimed.leaf = INVALID_HANDLE_VALUE;
  if (!ajps_identity_equal(root.identity, request->root_identity)) { result = 42; goto cleanup; }
  if (!ajps_open_plain_file(&root, request->filename, 0, &candidate, &information)) { result = 43; goto cleanup; }
  if (!ajps_information_matches(&information, request->expected_size, request->expected_mtime_ms, request->candidate_identity)) {
    result = 44; goto cleanup;
  }
  if (quarantine) {
    if (!pin_unclaimed(&root, TRUE, &unclaimed)) { result = 45; goto cleanup; }
    if (!rename_into_unclaimed(candidate, unclaimed.leaf, request->filename)) { result = 46; goto cleanup; }
  } else if (!set_delete_pending(candidate)) { result = 47; goto cleanup; }
  if (!ajps_write_response(request->operation, root.identity, request->candidate_identity,
      quarantine ? unclaimed.identity : (ajps_identity){0}, request->expected_size, request->expected_mtime_ms, NULL, 0)) result = 48;
  else result = 0;
cleanup:
  if (candidate != INVALID_HANDLE_VALUE) CloseHandle(candidate);
  ajps_close_pinned_path(&unclaimed);
  ajps_close_pinned_path(&root);
  return result == 0 ? 0 : ajps_fail((unsigned)result);
}

int ajps_sweep_inspect(const ajps_request *request) {
  ajps_pinned_path root, unclaimed;
  HANDLE candidate = INVALID_HANDLE_VALUE;
  BY_HANDLE_FILE_INFORMATION information;
  ajps_identity identity;
  int result = 50;
  if (!ajps_pin_directory_chain(request->root, FALSE, &root)) return ajps_fail(51);
  memset(&unclaimed, 0, sizeof(unclaimed)); unclaimed.leaf = INVALID_HANDLE_VALUE;
  if (!pin_unclaimed(&root, FALSE, &unclaimed)
      || !ajps_open_plain_file(&unclaimed, request->filename, 0, &candidate, &information)
      || !ajps_identity_from_handle(candidate, &identity)) goto cleanup;
  if (ajps_write_response(OP_SWEEP_INSPECT, root.identity, identity, unclaimed.identity,
      ajps_file_size(&information), ajps_unix_mtime_ms(&information), NULL, 0)) result = 0;
cleanup:
  if (candidate != INVALID_HANDLE_VALUE) CloseHandle(candidate);
  ajps_close_pinned_path(&unclaimed); ajps_close_pinned_path(&root);
  return result == 0 ? 0 : ajps_fail((unsigned)result);
}

int ajps_sweep_delete(const ajps_request *request) {
  ajps_pinned_path root, unclaimed;
  HANDLE candidate = INVALID_HANDLE_VALUE;
  BY_HANDLE_FILE_INFORMATION information;
  int result = 60;
  if (zero_identity(request->root_identity) || zero_identity(request->candidate_identity)
      || zero_identity(request->unclaimed_identity) || !ajps_pin_directory_chain(request->root, FALSE, &root)) return ajps_fail(61);
  memset(&unclaimed, 0, sizeof(unclaimed)); unclaimed.leaf = INVALID_HANDLE_VALUE;
  if (!ajps_identity_equal(root.identity, request->root_identity)
      || !pin_unclaimed(&root, FALSE, &unclaimed)
      || !ajps_identity_equal(unclaimed.identity, request->unclaimed_identity)
      || !ajps_open_plain_file(&unclaimed, request->filename, 0, &candidate, &information)
      || !ajps_information_matches(&information, request->expected_size, request->expected_mtime_ms, request->candidate_identity)
      || !set_delete_pending(candidate)) goto cleanup;
  if (ajps_write_response(OP_SWEEP_DELETE, root.identity, request->candidate_identity, unclaimed.identity,
      request->expected_size, request->expected_mtime_ms, NULL, 0)) result = 0;
cleanup:
  if (candidate != INVALID_HANDLE_VALUE) CloseHandle(candidate);
  ajps_close_pinned_path(&unclaimed); ajps_close_pinned_path(&root);
  return result == 0 ? 0 : ajps_fail((unsigned)result);
}
