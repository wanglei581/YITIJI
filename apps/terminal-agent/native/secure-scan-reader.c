#define UNICODE
#define _UNICODE
#define _WIN32_WINNT 0x0602

#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define OP_INSPECT 1u
#define OP_READ 2u
#define MAX_FIELD_BYTES 32768u
#define MAX_SCAN_BYTES (20u * 1024u * 1024u)
#define UNIX_EPOCH_FILETIME 116444736000000000ULL

static int fail_fixed(unsigned code) {
  char message[32];
  int length = snprintf(message, sizeof(message), "SCAN_READER_E%03u\n", code);
  DWORD written = 0;
  if (length > 0) {
    WriteFile(GetStdHandle(STD_ERROR_HANDLE), message, (DWORD)length, &written, NULL);
  }
  return (int)(code == 0 ? 255 : code);
}

static BOOL read_exact(HANDLE input, void *buffer, DWORD length) {
  BYTE *cursor = (BYTE *)buffer;
  DWORD remaining = length;
  while (remaining > 0) {
    DWORD received = 0;
    if (!ReadFile(input, cursor, remaining, &received, NULL) || received == 0) return FALSE;
    cursor += received;
    remaining -= received;
  }
  return TRUE;
}

static BOOL read_u32(HANDLE input, uint32_t *value) {
  BYTE raw[4];
  if (!read_exact(input, raw, sizeof(raw))) return FALSE;
  *value = (uint32_t)raw[0]
    | ((uint32_t)raw[1] << 8)
    | ((uint32_t)raw[2] << 16)
    | ((uint32_t)raw[3] << 24);
  return TRUE;
}

static BOOL read_u64(HANDLE input, uint64_t *value) {
  BYTE raw[8];
  uint64_t result = 0;
  unsigned index;
  if (!read_exact(input, raw, sizeof(raw))) return FALSE;
  for (index = 0; index < 8; index += 1) result |= ((uint64_t)raw[index]) << (index * 8);
  *value = result;
  return TRUE;
}

static wchar_t *read_utf8_field(HANDLE input, uint32_t length, BOOL allow_empty) {
  char *utf8 = NULL;
  wchar_t *wide = NULL;
  int wide_length;
  if (length > MAX_FIELD_BYTES || (!allow_empty && length == 0)) return NULL;
  if (length == 0) {
    wide = (wchar_t *)calloc(1, sizeof(wchar_t));
    return wide;
  }
  utf8 = (char *)malloc((size_t)length);
  if (utf8 == NULL || !read_exact(input, utf8, length) || memchr(utf8, '\0', length) != NULL) {
    free(utf8);
    return NULL;
  }
  wide_length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8, (int)length, NULL, 0);
  if (wide_length <= 0) {
    free(utf8);
    return NULL;
  }
  wide = (wchar_t *)calloc((size_t)wide_length + 1, sizeof(wchar_t));
  if (wide == NULL || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8, (int)length, wide, wide_length) != wide_length) {
    free(utf8);
    free(wide);
    return NULL;
  }
  free(utf8);
  return wide;
}

static BOOL stdin_is_exhausted(HANDLE input) {
  BYTE extra = 0;
  DWORD received = 0;
  return ReadFile(input, &extra, 1, &received, NULL) && received == 0;
}

static void trim_trailing_separator(wchar_t *path) {
  size_t length = wcslen(path);
  while (length > 3 && (path[length - 1] == L'\\' || path[length - 1] == L'/')) {
    if (length == 2 || (length > 2 && path[length - 2] == L':')) break;
    path[--length] = L'\0';
  }
}

static wchar_t *canonical_input_path(const wchar_t *path) {
  DWORD needed;
  wchar_t *full = NULL;
  wchar_t *long_path = NULL;
  if (path == NULL || path[0] == L'\0') return NULL;
  if (wcsncmp(path, L"\\\\?\\", 4) == 0 || wcsncmp(path, L"\\\\.\\", 4) == 0) return NULL;
  needed = GetFullPathNameW(path, 0, NULL, NULL);
  if (needed == 0 || needed > 32767) return NULL;
  full = (wchar_t *)calloc((size_t)needed + 1, sizeof(wchar_t));
  if (full == NULL || GetFullPathNameW(path, needed + 1, full, NULL) == 0) {
    free(full);
    return NULL;
  }
  needed = GetLongPathNameW(full, NULL, 0);
  if (needed > 0 && needed <= 32767) {
    long_path = (wchar_t *)calloc((size_t)needed + 1, sizeof(wchar_t));
    if (long_path != NULL && GetLongPathNameW(full, long_path, needed + 1) > 0) {
      free(full);
      full = long_path;
      long_path = NULL;
    }
    free(long_path);
  }
  trim_trailing_separator(full);
  return full;
}

static BOOL check_path_components_are_not_reparse(wchar_t *path) {
  size_t length = wcslen(path);
  size_t start = 0;
  size_t index;
  if (length >= 3 && path[1] == L':' && path[2] == L'\\') {
    start = 3;
  } else if (length >= 5 && path[0] == L'\\' && path[1] == L'\\') {
    const wchar_t *server_end = wcschr(path + 2, L'\\');
    const wchar_t *share_end;
    if (server_end == NULL) return FALSE;
    share_end = wcschr(server_end + 1, L'\\');
    start = share_end == NULL ? length : (size_t)(share_end - path + 1);
  } else {
    return FALSE;
  }

  for (index = start; index <= length; index += 1) {
    wchar_t saved;
    DWORD attributes;
    if (index < length && path[index] != L'\\') continue;
    saved = path[index];
    path[index] = L'\0';
    attributes = GetFileAttributesW(path);
    path[index] = saved;
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) return FALSE;
  }
  return TRUE;
}

static wchar_t *final_path_for_handle(HANDLE handle) {
  DWORD needed = GetFinalPathNameByHandleW(handle, NULL, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
  wchar_t *raw;
  wchar_t *normalized;
  if (needed == 0 || needed > 32767) return NULL;
  raw = (wchar_t *)calloc((size_t)needed + 1, sizeof(wchar_t));
  if (raw == NULL || GetFinalPathNameByHandleW(handle, raw, needed + 1, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS) == 0) {
    free(raw);
    return NULL;
  }
  if (wcsncmp(raw, L"\\\\?\\UNC\\", 8) == 0) {
    size_t tail = wcslen(raw + 8);
    normalized = (wchar_t *)calloc(tail + 3, sizeof(wchar_t));
    if (normalized == NULL) {
      free(raw);
      return NULL;
    }
    normalized[0] = L'\\';
    normalized[1] = L'\\';
    memcpy(normalized + 2, raw + 8, (tail + 1) * sizeof(wchar_t));
    free(raw);
  } else if (wcsncmp(raw, L"\\\\?\\", 4) == 0) {
    size_t tail = wcslen(raw + 4);
    normalized = (wchar_t *)calloc(tail + 1, sizeof(wchar_t));
    if (normalized == NULL) {
      free(raw);
      return NULL;
    }
    memcpy(normalized, raw + 4, (tail + 1) * sizeof(wchar_t));
    free(raw);
  } else {
    normalized = raw;
  }
  trim_trailing_separator(normalized);
  return normalized;
}

static BOOL handle_is_plain_directory(HANDLE handle) {
  FILE_ATTRIBUTE_TAG_INFO tag;
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag))) return FALSE;
  return (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
    && (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

static BOOL safe_filename(const wchar_t *filename) {
  size_t length;
  size_t index;
  if (filename == NULL) return FALSE;
  length = wcslen(filename);
  if (length == 0 || length > 255 || wcscmp(filename, L".") == 0 || wcscmp(filename, L"..") == 0) return FALSE;
  if (filename[length - 1] == L'.' || filename[length - 1] == L' ') return FALSE;
  for (index = 0; index < length; index += 1) {
    wchar_t character = filename[index];
    if (character < 32 || wcschr(L"\\/:*?\"<>|", character) != NULL) return FALSE;
  }
  return TRUE;
}

static wchar_t *join_direct_child(const wchar_t *root, const wchar_t *filename) {
  size_t root_length = wcslen(root);
  size_t name_length = wcslen(filename);
  wchar_t *result = (wchar_t *)calloc(root_length + name_length + 2, sizeof(wchar_t));
  if (result == NULL) return NULL;
  memcpy(result, root, root_length * sizeof(wchar_t));
  if (root_length == 0 || root[root_length - 1] != L'\\') result[root_length++] = L'\\';
  memcpy(result + root_length, filename, (name_length + 1) * sizeof(wchar_t));
  return result;
}

static uint64_t file_size(const BY_HANDLE_FILE_INFORMATION *information) {
  return ((uint64_t)information->nFileSizeHigh << 32) | information->nFileSizeLow;
}

static int64_t unix_mtime_ms(const BY_HANDLE_FILE_INFORMATION *information) {
  ULARGE_INTEGER value;
  value.LowPart = information->ftLastWriteTime.dwLowDateTime;
  value.HighPart = information->ftLastWriteTime.dwHighDateTime;
  if (value.QuadPart < UNIX_EPOCH_FILETIME) return INT64_MIN;
  return (int64_t)((value.QuadPart - UNIX_EPOCH_FILETIME) / 10000ULL);
}

static BOOL same_file_information(
  const BY_HANDLE_FILE_INFORMATION *before,
  const BY_HANDLE_FILE_INFORMATION *after
) {
  return before->dwVolumeSerialNumber == after->dwVolumeSerialNumber
    && before->nFileIndexHigh == after->nFileIndexHigh
    && before->nFileIndexLow == after->nFileIndexLow
    && before->nNumberOfLinks == after->nNumberOfLinks
    && file_size(before) == file_size(after)
    && unix_mtime_ms(before) == unix_mtime_ms(after);
}

static BOOL candidate_final_path_matches(
  const wchar_t *root_final,
  const wchar_t *candidate_final,
  const wchar_t *filename
) {
  wchar_t *copy = _wcsdup(candidate_final);
  wchar_t *separator;
  BOOL matches;
  if (copy == NULL) return FALSE;
  separator = wcsrchr(copy, L'\\');
  if (separator == NULL) {
    free(copy);
    return FALSE;
  }
  *separator = L'\0';
  matches = _wcsicmp(copy, root_final) == 0 && _wcsicmp(separator + 1, filename) == 0;
  free(copy);
  return matches;
}

static HANDLE open_verified_root(wchar_t *root, wchar_t **root_final) {
  HANDLE handle;
  if (!check_path_components_are_not_reparse(root)) return INVALID_HANDLE_VALUE;
  handle = CreateFileW(
    root,
    FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
    FILE_SHARE_READ | FILE_SHARE_WRITE,
    NULL,
    OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
    NULL
  );
  if (handle == INVALID_HANDLE_VALUE || !handle_is_plain_directory(handle)) {
    if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
    return INVALID_HANDLE_VALUE;
  }
  *root_final = final_path_for_handle(handle);
  if (*root_final == NULL || _wcsicmp(root, *root_final) != 0) {
    free(*root_final);
    *root_final = NULL;
    CloseHandle(handle);
    return INVALID_HANDLE_VALUE;
  }
  return handle;
}

static int inspect_folder(wchar_t *root) {
  wchar_t *root_final = NULL;
  HANDLE root_handle = open_verified_root(root, &root_final);
  DWORD written = 0;
  static const char ready[] = "READY\n";
  if (root_handle == INVALID_HANDLE_VALUE) return fail_fixed(20);
  if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), ready, (DWORD)(sizeof(ready) - 1), &written, NULL)
      || written != (DWORD)(sizeof(ready) - 1)) {
    free(root_final);
    CloseHandle(root_handle);
    return fail_fixed(21);
  }
  free(root_final);
  CloseHandle(root_handle);
  return 0;
}

static int read_candidate(
  wchar_t *root,
  const wchar_t *filename,
  uint64_t expected_size,
  int64_t expected_mtime_ms
) {
  wchar_t *root_final = NULL;
  wchar_t *candidate_path = NULL;
  wchar_t *candidate_final_before = NULL;
  wchar_t *candidate_final_after = NULL;
  wchar_t *root_final_after = NULL;
  HANDLE root_handle = INVALID_HANDLE_VALUE;
  HANDLE candidate_handle = INVALID_HANDLE_VALUE;
  FILE_ATTRIBUTE_TAG_INFO tag;
  BY_HANDLE_FILE_INFORMATION before;
  BY_HANDLE_FILE_INFORMATION after;
  BYTE *buffer = NULL;
  uint64_t offset = 0;
  int result = 30;

  if (!safe_filename(filename) || expected_size == 0 || expected_size > MAX_SCAN_BYTES) return fail_fixed(31);
  root_handle = open_verified_root(root, &root_final);
  if (root_handle == INVALID_HANDLE_VALUE) return fail_fixed(32);
  candidate_path = join_direct_child(root, filename);
  if (candidate_path == NULL) goto cleanup;
  candidate_handle = CreateFileW(
    candidate_path,
    GENERIC_READ,
    FILE_SHARE_READ,
    NULL,
    OPEN_EXISTING,
    FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN,
    NULL
  );
  if (candidate_handle == INVALID_HANDLE_VALUE) goto cleanup;
  if (!GetFileInformationByHandleEx(candidate_handle, FileAttributeTagInfo, &tag, sizeof(tag))) goto cleanup;
  if ((tag.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) goto cleanup;
  if (!GetFileInformationByHandle(candidate_handle, &before)) goto cleanup;
  if (before.nNumberOfLinks != 1
      || file_size(&before) != expected_size
      || unix_mtime_ms(&before) != expected_mtime_ms) goto cleanup;

  candidate_final_before = final_path_for_handle(candidate_handle);
  if (candidate_final_before == NULL
      || !candidate_final_path_matches(root_final, candidate_final_before, filename)) goto cleanup;
  buffer = (BYTE *)malloc((size_t)expected_size);
  if (buffer == NULL) goto cleanup;
  while (offset < expected_size) {
    DWORD requested = (DWORD)((expected_size - offset) > 1024u * 1024u ? 1024u * 1024u : (expected_size - offset));
    DWORD received = 0;
    if (!ReadFile(candidate_handle, buffer + offset, requested, &received, NULL) || received == 0) goto cleanup;
    offset += received;
  }
  if (!GetFileInformationByHandle(candidate_handle, &after)
      || !same_file_information(&before, &after)) goto cleanup;
  if (!GetFileInformationByHandleEx(candidate_handle, FileAttributeTagInfo, &tag, sizeof(tag))
      || (tag.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) goto cleanup;
  root_final_after = final_path_for_handle(root_handle);
  candidate_final_after = final_path_for_handle(candidate_handle);
  if (root_final_after == NULL || candidate_final_after == NULL
      || _wcsicmp(root_final, root_final_after) != 0
      || _wcsicmp(candidate_final_before, candidate_final_after) != 0
      || !candidate_final_path_matches(root_final_after, candidate_final_after, filename)) goto cleanup;

  {
    uint64_t total_written = 0;
    while (total_written < expected_size) {
      DWORD requested = (DWORD)((expected_size - total_written) > 1024u * 1024u ? 1024u * 1024u : (expected_size - total_written));
      DWORD written = 0;
      if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), buffer + total_written, requested, &written, NULL) || written == 0) goto cleanup;
      total_written += written;
    }
  }
  result = 0;

cleanup:
  free(buffer);
  free(root_final);
  free(root_final_after);
  free(candidate_path);
  free(candidate_final_before);
  free(candidate_final_after);
  if (candidate_handle != INVALID_HANDLE_VALUE) CloseHandle(candidate_handle);
  if (root_handle != INVALID_HANDLE_VALUE) CloseHandle(root_handle);
  return result == 0 ? 0 : fail_fixed((unsigned)result);
}

int wmain(void) {
  static const BYTE expected_magic[8] = { 'A', 'J', 'P', 'S', 'R', '0', '0', '1' };
  BYTE magic[8];
  uint32_t operation = 0;
  uint32_t root_length = 0;
  uint32_t filename_length = 0;
  uint64_t expected_size = 0;
  uint64_t expected_mtime_raw = 0;
  wchar_t *root_input = NULL;
  wchar_t *filename = NULL;
  wchar_t *root = NULL;
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  int result;

  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stdin), _O_BINARY);
  if (input == INVALID_HANDLE_VALUE
      || !read_exact(input, magic, sizeof(magic))
      || memcmp(magic, expected_magic, sizeof(magic)) != 0
      || !read_u32(input, &operation)
      || !read_u32(input, &root_length)) return fail_fixed(1);
  root_input = read_utf8_field(input, root_length, FALSE);
  if (root_input == NULL || !read_u32(input, &filename_length)) {
    free(root_input);
    return fail_fixed(2);
  }
  filename = read_utf8_field(input, filename_length, operation == OP_INSPECT);
  if (filename == NULL
      || !read_u64(input, &expected_size)
      || !read_u64(input, &expected_mtime_raw)
      || !stdin_is_exhausted(input)) {
    free(root_input);
    free(filename);
    return fail_fixed(3);
  }
  root = canonical_input_path(root_input);
  free(root_input);
  if (root == NULL) {
    free(filename);
    return fail_fixed(4);
  }

  if (operation == OP_INSPECT && filename_length == 0 && expected_size == 0 && expected_mtime_raw == 0) {
    result = inspect_folder(root);
  } else if (operation == OP_READ && filename_length > 0) {
    result = read_candidate(root, filename, expected_size, (int64_t)expected_mtime_raw);
  } else {
    result = fail_fixed(5);
  }
  free(root);
  free(filename);
  return result;
}
