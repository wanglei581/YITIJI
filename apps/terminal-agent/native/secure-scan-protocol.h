#ifndef AJPS_SECURE_SCAN_PROTOCOL_H
#define AJPS_SECURE_SCAN_PROTOCOL_H

#include <stdint.h>

#define AJPS_PROTOCOL_V2 "AJPSR002"
#define AJPS_RESPONSE_V2 "AJPSO002"

#define OP_INSPECT 1u
#define OP_READ 2u
#define OP_FINALIZE_DELETE 3u
#define OP_FINALIZE_QUARANTINE 4u
#define OP_SWEEP_INSPECT 5u
#define OP_SWEEP_DELETE 6u

#define MAX_FIELD_BYTES 32768u
#define MAX_SCAN_BYTES (20u * 1024u * 1024u)

typedef struct ajps_identity {
  uint32_t volume;
  uint64_t file_id;
} ajps_identity;

typedef struct ajps_request {
  uint32_t operation;
  wchar_t *root;
  wchar_t *filename;
  uint64_t expected_size;
  int64_t expected_mtime_ms;
  ajps_identity root_identity;
  ajps_identity candidate_identity;
  ajps_identity unclaimed_identity;
} ajps_request;

#endif
