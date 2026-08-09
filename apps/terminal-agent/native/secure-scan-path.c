#include "secure-scan-internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

static void trim_trailing_separator(wchar_t *path) {
  size_t length = wcslen(path);
  while (length > 3 && (path[length - 1] == L'\\' || path[length - 1] == L'/')) path[--length] = L'\0';
}

static wchar_t *canonical_input_path(const wchar_t *path) {
  DWORD needed;
  wchar_t *full;
  if (path == NULL || path[0] == L'\0' || wcsncmp(path, L"\\\\?\\", 4) == 0 || wcsncmp(path, L"\\\\.\\", 4) == 0) return NULL;
  needed = GetFullPathNameW(path, 0, NULL, NULL);
  if (needed == 0 || needed > 32767) return NULL;
  full = (wchar_t *)calloc((size_t)needed + 1, sizeof(wchar_t));
  if (full == NULL || GetFullPathNameW(path, needed + 1, full, NULL) == 0) {
    free(full);
    return NULL;
  }
  trim_trailing_separator(full);
  return full;
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
    if (normalized == NULL) { free(raw); return NULL; }
    normalized[0] = L'\\'; normalized[1] = L'\\';
    memcpy(normalized + 2, raw + 8, (tail + 1) * sizeof(wchar_t));
    free(raw);
  } else if (wcsncmp(raw, L"\\\\?\\", 4) == 0) {
    size_t tail = wcslen(raw + 4);
    normalized = (wchar_t *)calloc(tail + 1, sizeof(wchar_t));
    if (normalized == NULL) { free(raw); return NULL; }
    memcpy(normalized, raw + 4, (tail + 1) * sizeof(wchar_t));
    free(raw);
  } else normalized = raw;
  trim_trailing_separator(normalized);
  return normalized;
}

static BOOL plain_directory(HANDLE handle) {
  FILE_ATTRIBUTE_TAG_INFO tag;
  return GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &tag, sizeof(tag))
    && (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
    && (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

static size_t root_prefix_length(const wchar_t *path) {
  if (path[0] != L'\0' && path[1] == L':' && path[2] == L'\\') return 3;
  if (path[0] == L'\\' && path[1] == L'\\') {
    const wchar_t *server = wcschr(path + 2, L'\\');
    const wchar_t *share = server == NULL ? NULL : wcschr(server + 1, L'\\');
    return server == NULL ? 0 : (share == NULL ? wcslen(path) : (size_t)(share - path));
  }
  return 0;
}

BOOL ajps_identity_from_handle(HANDLE handle, ajps_identity *identity) {
  BY_HANDLE_FILE_INFORMATION information;
  if (!GetFileInformationByHandle(handle, &information)) return FALSE;
  identity->volume = information.dwVolumeSerialNumber;
  identity->file_id = ((uint64_t)information.nFileIndexHigh << 32) | information.nFileIndexLow;
  return TRUE;
}

BOOL ajps_identity_equal(ajps_identity left, ajps_identity right) {
  return left.volume == right.volume && left.file_id == right.file_id;
}

void ajps_close_pinned_path(ajps_pinned_path *pinned) {
  size_t index;
  for (index = 0; index < pinned->handle_count; index += 1) {
    if (pinned->handles[index] != INVALID_HANDLE_VALUE) CloseHandle(pinned->handles[index]);
  }
  free(pinned->canonical);
  free(pinned->final_path);
  memset(pinned, 0, sizeof(*pinned));
  pinned->leaf = INVALID_HANDLE_VALUE;
}

BOOL ajps_pin_directory_chain(const wchar_t *input, BOOL create_leaf, ajps_pinned_path *pinned) {
  wchar_t *path;
  size_t start;
  size_t length;
  size_t index;
  memset(pinned, 0, sizeof(*pinned));
  pinned->leaf = INVALID_HANDLE_VALUE;
  path = canonical_input_path(input);
  if (path == NULL) return FALSE;
  if (create_leaf && !CreateDirectoryW(path, NULL) && GetLastError() != ERROR_ALREADY_EXISTS) { free(path); return FALSE; }
  start = root_prefix_length(path);
  length = wcslen(path);
  if (start == 0) { free(path); return FALSE; }
  if (path[1] == L':' && path[2] == L'\\') {
    wchar_t saved = path[3];
    HANDLE drive_root;
    path[3] = L'\0';
    drive_root = CreateFileW(path, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    path[3] = saved;
    if (drive_root == INVALID_HANDLE_VALUE || !plain_directory(drive_root)) {
      if (drive_root != INVALID_HANDLE_VALUE) CloseHandle(drive_root);
      free(path); return FALSE;
    }
    pinned->handles[pinned->handle_count++] = drive_root;
    if (length == 3) start = length + 1;
  }
  for (index = start; index <= length; index += 1) {
    wchar_t saved;
    HANDLE handle;
    if (index < length && path[index] != L'\\') continue;
    if (pinned->handle_count >= AJPS_MAX_PINNED_DIRECTORIES) { free(path); ajps_close_pinned_path(pinned); return FALSE; }
    saved = path[index]; path[index] = L'\0';
    handle = CreateFileW(path, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
    path[index] = saved;
    if (handle == INVALID_HANDLE_VALUE || !plain_directory(handle)) {
      if (handle != INVALID_HANDLE_VALUE) CloseHandle(handle);
      free(path); ajps_close_pinned_path(pinned); return FALSE;
    }
    pinned->handles[pinned->handle_count++] = handle;
  }
  pinned->canonical = path;
  pinned->leaf = pinned->handles[pinned->handle_count - 1];
  pinned->final_path = final_path_for_handle(pinned->leaf);
  if (pinned->final_path == NULL || _wcsicmp(pinned->canonical, pinned->final_path) != 0
      || !ajps_identity_from_handle(pinned->leaf, &pinned->identity)) {
    ajps_close_pinned_path(pinned);
    return FALSE;
  }
  return TRUE;
}

BOOL ajps_safe_filename(const wchar_t *filename) {
  size_t length;
  size_t index;
  if (filename == NULL) return FALSE;
  length = wcslen(filename);
  if (length == 0 || length > 255 || wcscmp(filename, L".") == 0 || wcscmp(filename, L"..") == 0) return FALSE;
  if (filename[length - 1] == L'.' || filename[length - 1] == L' ') return FALSE;
  for (index = 0; index < length; index += 1) if (filename[index] < 32 || wcschr(L"\\/:*?\"<>|", filename[index]) != NULL) return FALSE;
  return TRUE;
}

wchar_t *ajps_join_child(const wchar_t *root, const wchar_t *filename) {
  size_t root_length = wcslen(root), name_length = wcslen(filename);
  wchar_t *result = (wchar_t *)calloc(root_length + name_length + 2, sizeof(wchar_t));
  if (result == NULL) return NULL;
  memcpy(result, root, root_length * sizeof(wchar_t));
  if (root_length == 0 || root[root_length - 1] != L'\\') result[root_length++] = L'\\';
  memcpy(result + root_length, filename, (name_length + 1) * sizeof(wchar_t));
  return result;
}

BOOL ajps_open_plain_file(const ajps_pinned_path *parent, const wchar_t *filename, DWORD access, HANDLE *handle, BY_HANDLE_FILE_INFORMATION *information) {
  wchar_t *path;
  FILE_ATTRIBUTE_TAG_INFO tag;
  if (!ajps_safe_filename(filename)) return FALSE;
  path = ajps_join_child(parent->canonical, filename);
  if (path == NULL) return FALSE;
  *handle = CreateFileW(path, access | FILE_READ_ATTRIBUTES | DELETE, FILE_SHARE_READ | FILE_SHARE_WRITE,
    NULL, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  free(path);
  if (*handle == INVALID_HANDLE_VALUE) return FALSE;
  if (!GetFileInformationByHandleEx(*handle, FileAttributeTagInfo, &tag, sizeof(tag))
      || (tag.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0
      || !GetFileInformationByHandle(*handle, information)
      || information->nNumberOfLinks != 1) {
    CloseHandle(*handle); *handle = INVALID_HANDLE_VALUE; return FALSE;
  }
  return TRUE;
}

uint64_t ajps_file_size(const BY_HANDLE_FILE_INFORMATION *information) {
  return ((uint64_t)information->nFileSizeHigh << 32) | information->nFileSizeLow;
}

int64_t ajps_unix_mtime_ms(const BY_HANDLE_FILE_INFORMATION *information) {
  ULARGE_INTEGER value;
  value.LowPart = information->ftLastWriteTime.dwLowDateTime;
  value.HighPart = information->ftLastWriteTime.dwHighDateTime;
  if (value.QuadPart < AJPS_UNIX_EPOCH_FILETIME) return INT64_MIN;
  return (int64_t)((value.QuadPart - AJPS_UNIX_EPOCH_FILETIME) / 10000ULL);
}

BOOL ajps_information_matches(const BY_HANDLE_FILE_INFORMATION *information, uint64_t expected_size, int64_t expected_mtime_ms, ajps_identity expected_identity) {
  ajps_identity actual;
  actual.volume = information->dwVolumeSerialNumber;
  actual.file_id = ((uint64_t)information->nFileIndexHigh << 32) | information->nFileIndexLow;
  return information->nNumberOfLinks == 1
    && ajps_file_size(information) == expected_size
    && ajps_unix_mtime_ms(information) == expected_mtime_ms
    && ajps_identity_equal(actual, expected_identity);
}
