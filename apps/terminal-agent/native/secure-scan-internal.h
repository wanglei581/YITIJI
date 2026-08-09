#ifndef AJPS_SECURE_SCAN_INTERNAL_H
#define AJPS_SECURE_SCAN_INTERNAL_H

#define UNICODE
#define _UNICODE
#define _WIN32_WINNT 0x0602

#include <windows.h>
#include <stdint.h>
#include "secure-scan-protocol.h"

#define AJPS_MAX_PINNED_DIRECTORIES 128u
#define AJPS_UNIX_EPOCH_FILETIME 116444736000000000ULL

typedef struct ajps_pinned_path {
  wchar_t *canonical;
  wchar_t *final_path;
  HANDLE handles[AJPS_MAX_PINNED_DIRECTORIES];
  size_t handle_count;
  HANDLE leaf;
  ajps_identity identity;
} ajps_pinned_path;

int ajps_fail(unsigned code);
int ajps_fail_win32(unsigned code, DWORD win32_error);
BOOL ajps_safe_filename(const wchar_t *filename);
wchar_t *ajps_join_child(const wchar_t *root, const wchar_t *filename);
BOOL ajps_pin_directory_chain(const wchar_t *input, BOOL create_leaf, ajps_pinned_path *pinned);
void ajps_close_pinned_path(ajps_pinned_path *pinned);
BOOL ajps_open_plain_file(
  const ajps_pinned_path *parent,
  const wchar_t *filename,
  DWORD access,
  HANDLE *handle,
  BY_HANDLE_FILE_INFORMATION *information
);
BOOL ajps_identity_from_handle(HANDLE handle, ajps_identity *identity);
BOOL ajps_identity_equal(ajps_identity left, ajps_identity right);
uint64_t ajps_file_size(const BY_HANDLE_FILE_INFORMATION *information);
int64_t ajps_unix_mtime_ms(const BY_HANDLE_FILE_INFORMATION *information);
BOOL ajps_information_matches(
  const BY_HANDLE_FILE_INFORMATION *information,
  uint64_t expected_size,
  int64_t expected_mtime_ms,
  ajps_identity expected_identity
);
BOOL ajps_write_response(
  uint32_t operation,
  ajps_identity root,
  ajps_identity candidate,
  ajps_identity unclaimed,
  uint64_t size,
  int64_t mtime_ms,
  const BYTE *payload,
  uint32_t payload_length
);
int ajps_inspect(const ajps_request *request);
int ajps_read(const ajps_request *request);
int ajps_finalize(const ajps_request *request, BOOL quarantine);
int ajps_sweep_inspect(const ajps_request *request);
int ajps_sweep_delete(const ajps_request *request);

#endif
