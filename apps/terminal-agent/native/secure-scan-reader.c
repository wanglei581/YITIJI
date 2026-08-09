#include "secure-scan-internal.h"

#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int ajps_fail(unsigned code) {
  char message[32];
  int length = snprintf(message, sizeof(message), "SCAN_READER_E%03u\n", code);
  DWORD written = 0;
  if (length > 0) WriteFile(GetStdHandle(STD_ERROR_HANDLE), message, (DWORD)length, &written, NULL);
  return (int)(code == 0 ? 255 : code);
}

static BOOL read_exact(HANDLE input, void *buffer, DWORD length) {
  BYTE *cursor = (BYTE *)buffer;
  DWORD remaining = length;
  while (remaining > 0) {
    DWORD received = 0;
    if (!ReadFile(input, cursor, remaining, &received, NULL) || received == 0) return FALSE;
    cursor += received; remaining -= received;
  }
  return TRUE;
}

static BOOL read_u32(HANDLE input, uint32_t *value) {
  BYTE raw[4];
  if (!read_exact(input, raw, sizeof(raw))) return FALSE;
  *value = (uint32_t)raw[0] | ((uint32_t)raw[1] << 8) | ((uint32_t)raw[2] << 16) | ((uint32_t)raw[3] << 24);
  return TRUE;
}

static BOOL read_u64(HANDLE input, uint64_t *value) {
  BYTE raw[8]; unsigned index; uint64_t result = 0;
  if (!read_exact(input, raw, sizeof(raw))) return FALSE;
  for (index = 0; index < 8; index += 1) result |= ((uint64_t)raw[index]) << (index * 8);
  *value = result; return TRUE;
}

static wchar_t *read_utf8(HANDLE input, uint32_t length, BOOL empty_allowed) {
  char *bytes; wchar_t *wide; int wide_length;
  if (length > MAX_FIELD_BYTES || (!empty_allowed && length == 0)) return NULL;
  if (length == 0) return (wchar_t *)calloc(1, sizeof(wchar_t));
  bytes = (char *)malloc(length);
  if (bytes == NULL || !read_exact(input, bytes, length) || memchr(bytes, '\0', length) != NULL) { free(bytes); return NULL; }
  wide_length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes, (int)length, NULL, 0);
  wide = wide_length <= 0 ? NULL : (wchar_t *)calloc((size_t)wide_length + 1, sizeof(wchar_t));
  if (wide == NULL || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes, (int)length, wide, wide_length) != wide_length) {
    free(bytes); free(wide); return NULL;
  }
  free(bytes); return wide;
}

static BOOL read_identity(HANDLE input, ajps_identity *identity) {
  return read_u32(input, &identity->volume) && read_u64(input, &identity->file_id);
}

static BOOL exhausted(HANDLE input) {
  BYTE extra; DWORD received = 0;
  if (ReadFile(input, &extra, 1, &received, NULL)) return received == 0;
  return GetLastError() == ERROR_BROKEN_PIPE;
}

static BOOL read_request(HANDLE input, ajps_request *request) {
  BYTE magic[8]; uint32_t root_length, filename_length; uint64_t mtime;
  memset(request, 0, sizeof(*request));
  if (!read_exact(input, magic, sizeof(magic)) || memcmp(magic, AJPS_PROTOCOL_V2, 8) != 0
      || !read_u32(input, &request->operation) || !read_u32(input, &root_length)) return FALSE;
  request->root = read_utf8(input, root_length, FALSE);
  if (request->root == NULL || !read_u32(input, &filename_length)) return FALSE;
  request->filename = read_utf8(input, filename_length, request->operation == OP_INSPECT);
  if (request->filename == NULL || !read_u64(input, &request->expected_size) || !read_u64(input, &mtime)
      || !read_identity(input, &request->root_identity) || !read_identity(input, &request->candidate_identity)
      || !read_identity(input, &request->unclaimed_identity) || !exhausted(input)) return FALSE;
  request->expected_mtime_ms = (int64_t)mtime;
  return TRUE;
}

int wmain(void) {
  ajps_request request;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  int result;
  _setmode(_fileno(stdout), _O_BINARY); _setmode(_fileno(stdin), _O_BINARY);
  if (input == INVALID_HANDLE_VALUE || !read_request(input, &request)) return ajps_fail(1);
  switch (request.operation) {
    case OP_INSPECT: result = request.filename[0] == L'\0' ? ajps_inspect(&request) : ajps_fail(2); break;
    case OP_READ: result = ajps_read(&request); break;
    case OP_FINALIZE_DELETE: result = ajps_finalize(&request, FALSE); break;
    case OP_FINALIZE_QUARANTINE: result = ajps_finalize(&request, TRUE); break;
    case OP_SWEEP_INSPECT: result = ajps_sweep_inspect(&request); break;
    case OP_SWEEP_DELETE: result = ajps_sweep_delete(&request); break;
    default: result = ajps_fail(3); break;
  }
  free(request.root); free(request.filename);
  return result;
}
