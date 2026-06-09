# CM_MSG — Church Machine UART Messaging Protocol

**Status:** Design specification — v0.2  
**Date:** 2026-06-09  
**Scope:** Ti60 F225 (initial target); architecture applies to all CM-connected boards

---

## Guiding Principle

**No message is trusted unless it is authorized by a Golden Token.**

The Church Machine is built on capability-based security. Every memory access is
GT-validated in hardware. Every call is GT-validated in the ISA. This protocol
extends that same guarantee to the UART channel: every message — in both directions
— carries implicit authorization via a Golden Token pair. A board that does not hold
a GT for a capability cannot exercise it, even over UART. The bridge is the enforcer.
This is not an add-on. It is the protocol's reason for existing.

---

## 1. Trust Architecture

### 1.1 The chain of trust

```
┌──────────────────────────────────────────────────────────┐
│                    FPGA Board (Ti60 F225)                 │
│                                                          │
│  CALLHOME sends:  board_uid + gt_manifest                │
│  (list of GT global names the board claims to hold)      │
└────────────────────────┬─────────────────────────────────┘
                         │  UART  [0xCE][0xAA][type][seq][len][payload][crc16]
                         ▼
┌──────────────────────────────────────────────────────────┐
│                  Bridge (callhome_bridge.py)              │
│                                                          │
│  1. Parses frame — verifies magic + CRC                  │
│  2. Looks up board's GT record by board_uid              │
│  3. Checks: does board hold the Source GT for msg.type?  │
│  4. On pass → routes to handler                          │
│  5. On fail → sends ACK(GT_ERROR) + logs rejection       │
└────────────────────────┬─────────────────────────────────┘
                         │  HTTP POST / SSE
                         ▼
┌──────────────────────────────────────────────────────────┐
│                  IDE Server (app.py)                     │
│                                                          │
│  Stores GT records per board in church_machine.db        │
│  Mints, grants, and revokes GTs via admin/family panel   │
│  Destination GTs live here — never on the FPGA           │
└──────────────────────────────────────────────────────────┘
```

### 1.2 GT validation at the bridge

GT validation is intentionally in the bridge, not the firmware. This is by design:

- **Firmware stays frozen.** New GT types, new revocations, new domain rules — all
  applied on the IDE side. The FPGA never needs to be reflashed to change permissions.
- **Point-to-point channel.** The UART bridge is a 1:1 connection to one board. Once
  CALLHOME establishes the board's identity, every subsequent message is evaluated
  against that board's GT record.
- **No GT tokens in the wire frame.** Adding a 4-byte GT token to every frame would
  require the firmware to know its own tokens and pass them in every call. Instead,
  the bridge holds the mapping: `board_uid → {gt_name → token}`. The firmware just
  calls `cm_send_msg(type, seq, payload, len)`. The bridge does the rest.

### 1.3 Trust states

| State | Description | Allowed message types |
|-------|-------------|----------------------|
| **Unregistered** | CALLHOME not yet received | `0x01 CALLHOME`, `0x06 PING` only |
| **Registered** | CALLHOME received, GT record loaded | All types for which board holds GT |
| **Suspended** | Admin-suspended board | `0x01 CALLHOME` only (re-registration) |
| **Revoked GT** | Specific GT removed from record | All other GTs still valid |

### 1.4 Security properties guaranteed by this protocol

1. **Identity** — Every board is identified by a unique SHA-32 of its UID, minted once.
2. **Least privilege** — Each capability is a separate GT. A board doing callhome cannot
   browse the web unless Browse.Client was explicitly granted.
3. **Capability confinement** — `CM.Browse.Client` confines browsing to a parent-approved
   domain C-list. The hardware token IS the permission list.
4. **Revocability** — Any GT is removed server-side; takes effect on next bridge connect.
5. **Integrity** — CRC-16 on every frame. A corrupted or replayed frame is dropped.
6. **Unforgeability** — GT tokens are SHA-32 hashes. A board cannot fabricate a GT it
   was not granted.
7. **Non-escalation** — A board cannot request a GT it doesn't hold. The bridge never
   grants on demand — only the admin/family panel can mint new GTs.

---

## 2. Golden Token Registry

### 2.1 FPGA-side GTs (held by the board)

The board reports its GT manifest in every CALLHOME. The bridge validates the manifest
against the server's authoritative GT record and loads the intersection.

| Global Name | Perms | Default | Description |
|-------------|-------|---------|-------------|
| `CM.Board.Identity` | E | Always | Minted at first registration; token = SHA32(board_uid) |
| `CM.Heartbeat` | E | Always | Lowest privilege — PING only |
| `CM.Fault.Reporter` | E | Always | FAULT + BOOT_LOG emission |
| `CM.Perf.Reporter` | E | Always | PERF counter emission |
| `CM.Lump.Loader` | E | Always | LUMP_REQ Lazy-Load access to IDE store |
| `CM.Trace.Emitter` | E | Debug builds | Instruction TRACE streaming |
| `CM.NS.Inspector` | R | Admin grant | Read-only namespace dump |
| `CM.Media.Consumer` | E | On request | Media asset fetch (images, audio, documents) |
| `CM.Browse.Client` | E | Family panel | Web browsing; C-list = approved domain GTs |

### 2.2 IDE-side GTs (held by bridge/server)

These GTs never leave the server. They name the services the FPGA invokes.

| Global Name | Perms | Description |
|-------------|-------|-------------|
| `CM.IDE.CallhomeService` | X | Receives CALLHOME; validates Board.Identity |
| `CM.IDE.HeartbeatService` | X | Returns PONG with server timestamp |
| `CM.IDE.FaultReceiver` | X | Logs faults; triggers MTBF recalc + alert emails |
| `CM.IDE.TraceReceiver` | X | Feeds live Pipeline view in IDE |
| `CM.IDE.LumpServer` | RX | Serves LUMP_DATA; checks Lump.Loader on every request |
| `CM.IDE.NSAuthority` | RX | Namespace source of truth |
| `CM.IDE.MediaServer` | RX | Serves chunked media; checks Media.Consumer |
| `CM.IDE.BrowseProxy` | RX | Fetches + renders URLs; enforces Browse.Client C-list |
| `CM.IDE.Deployer` | X | Pushes LUMP_DATA to FPGA; signs each frame |
| `CM.IDE.Commander` | X | CMD (pause/step/resume/reset); requires admin session |

### 2.3 Browse GT — capability-secured web access

`CM.Browse.Client` is a **per-device GT**. Its C-list slots hold domain GTs that a
parent explicitly approves via the IDE Family panel. This is capability-secured
parental control — no accounts, no passwords, no third-party app. The token IS the
permission.

```
CM.Browse.Client  (device c0ffee0100000001)  [E]
  C-list slot 0:  CM.Domain.BBCNews      [E]  →  bbc.co.uk
  C-list slot 1:  CM.Domain.Wikipedia    [E]  →  wikipedia.org
  C-list slot 2:  CM.Domain.KhanAcademy  [E]  →  khanacademy.org
```

Bridge enforcement on `BROWSE_REQ (0x10)`:
1. Extract hostname from URL in payload
2. Check for `CM.Domain.<X>` GT matching that hostname in Browse.Client C-list
3. **Match** → fetch and render
4. **No match** → `BROWSE_STATUS(GT_DOMAIN_NOT_PERMITTED)`, log attempt

### 2.4 GT validation error codes

| Code | Name | Meaning |
|------|------|---------|
| `0x00` | `GT_OK` | Authorized |
| `0x01` | `GT_UNKNOWN` | Board UID not in server record |
| `0x02` | `GT_NOT_HELD` | Board doesn't hold this GT type |
| `0x03` | `GT_REVOKED` | GT was revoked by IDE admin |
| `0x04` | `GT_DOMAIN_NOT_PERMITTED` | Browse domain not in C-list |
| `0x05` | `GT_INSUFFICIENT_PERMS` | GT exists but lacks required permission |
| `0x06` | `GT_TYPE_MISMATCH` | Source GT type incompatible with message |

### 2.5 GT lifecycle

```
REGISTRATION (first CALLHOME from new board)
  Bridge receives CALLHOME with board_uid
  → Server mints CM.Board.Identity (token = SHA32(uid))
  → Server grants default set:
      CM.Heartbeat, CM.Fault.Reporter, CM.Perf.Reporter, CM.Lump.Loader
  → GT record persisted in church_machine.db

CAPABILITY EXPANSION (admin panel)
  Admin enables tracing  → grants CM.Trace.Emitter
  Admin grants media     → grants CM.Media.Consumer

FAMILY BROWSE SETUP (Family panel)
  Parent adds "bbc.co.uk"
  → Server mints CM.Domain.BBCNews (token = SHA32("bbc.co.uk"))
  → Server builds/updates CM.Browse.Client with new domain in C-list
  → GT bundle deployed to FPGA via LUMP_DATA (0x80) at next connect

REVOCATION
  Admin removes a GT from device record
  → Next bridge connect: bridge rejects that message type with GT_REVOKED
  → FPGA logs rejection; gracefully disables the capability
  → No firmware change, no reflash required
```

---

## 3. Wire Format

Every message — in both directions — uses the same trusted envelope:

```
[0xCE][0xAA][type:1][seq:2][len:2][payload: len bytes][crc16:2]
```

| Field | Bytes | Description |
|-------|-------|-------------|
| `0xCE 0xAA` | 2 | Magic sync bytes — re-synchronises parser after noise or reset |
| `type` | 1 | Message type (0x00–0x7F = FPGA→IDE; 0x80–0xFF = IDE→FPGA) |
| `seq` | 2 | Sequence number — pairs requests with responses (little-endian) |
| `len` | 2 | Payload length in bytes (little-endian; max 65535) |
| `payload` | len | Type-specific data (see Section 5) |
| `crc16` | 2 | CRC-16/CCITT over `type + seq + len + payload` (little-endian) |

Minimum frame size: 9 bytes (zero-length payload).  
The parser scans for `0xCE 0xAA` to re-sync after any corruption.  
A frame with a bad CRC is silently dropped and counted in the bridge's error log.

**GT authorization is implicit in the type byte.** The bridge maps `type → required
Source GT` (Section 2.3 table) and validates against the board's current GT record
before the handler is ever called.

### Firmware API (frozen after first flash)

The entire protocol surface exposed to firmware is three functions:

```c
/* Send any message. GT validation happens in the bridge, not here. */
void cm_send_msg(uint8_t type, uint16_t seq,
                 const uint8_t *payload, uint16_t len);

/* Receive loop — call from main loop or UART ISR. */
void cm_poll_rx(void);

/* Handle incoming messages from the IDE. Override as needed. */
__attribute__((weak))
void cm_on_msg(uint8_t type, uint16_t seq,
               const uint8_t *payload, uint16_t len);
```

The firmware never handles GT logic. This is intentional. Firmware is frozen once
these three functions are working. Every future capability — media, browsing, tracing
— is added on the bridge and IDE side only.

---

## 4. Bridge — Trusted Router

`callhome_bridge.py` is the trust enforcement point. No message reaches the IDE
server without passing through it.

```python
CM_MSG_TYPE_GT = {
    0x01: "CM.Board.Identity",
    0x02: "CM.Fault.Reporter",
    0x03: "CM.Trace.Emitter",
    0x04: "CM.Lump.Loader",
    0x05: "CM.NS.Inspector",
    0x06: "CM.Heartbeat",
    0x07: "CM.Fault.Reporter",
    0x08: "CM.Perf.Reporter",
    0x09: "CM.Media.Consumer",
    0x0A: "CM.Media.Consumer",
    0x10: "CM.Browse.Client",
    0x11: "CM.Browse.Client",
    0x12: "CM.Browse.Client",
    0x13: "CM.Browse.Client",
    0x14: "CM.Browse.Client",
}

CM_HANDLERS = {
    0x01: handle_callhome,
    0x02: handle_fault,
    0x03: handle_trace,
    0x04: handle_lump_req,
    0x05: handle_ns_dump,
    0x06: handle_ping,
    0x08: handle_perf,
    0x09: handle_media_req,
    0x10: handle_browse_req,
    # New types added here — no firmware change ever needed
}

def on_frame(msg_type, seq, payload):
    required_gt = CM_MSG_TYPE_GT.get(msg_type)
    if required_gt:
        err = validate_gt(board_uid, required_gt, msg_type)
        if err != GT_OK:
            send_ack_error(seq, err)
            log.warning("GT rejected: type=0x%02X board=%s err=%s",
                        msg_type, board_uid, err)
            return

    handler = CM_HANDLERS.get(msg_type)
    if handler:
        handler(seq, payload)
    else:
        log.info("Unhandled CM_MSG type=0x%02X seq=%d len=%d "
                 "(future type — ignored)", msg_type, seq, len(payload))
```

Unknown type bytes are **logged and ignored** — a future firmware that emits a new
type works against an old bridge without crashing or triggering a security alert.

---

## 5. Message Type Registry

### 5.1 System — FPGA → IDE

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x01` | `CALLHOME` | `CM.Board.Identity` | `CM.IDE.CallhomeService` | ✅ Done | JSON: board, uid, nia, fw, boot_ok, fault, gt_manifest |
| `0x02` | `FAULT` | `CM.Fault.Reporter` | `CM.IDE.FaultReceiver` | P1 | JSON: code, mnemonic, nia, gt, stage, tier, catch_invoked |
| `0x03` | `TRACE` | `CM.Trace.Emitter` | `CM.IDE.TraceReceiver` | P2 | Binary: nia(4)+opcode(1)+dr0(4)+dr1(4) |
| `0x04` | `LUMP_REQ` | `CM.Lump.Loader` | `CM.IDE.LumpServer` | P2 | token(8)+hint_ns_slot(2) |
| `0x05` | `NS_DUMP` | `CM.NS.Inspector` | `CM.IDE.NSAuthority` | P3 | Binary array: slot(2)+token(8)+perms(1) |
| `0x06` | `PING` | `CM.Heartbeat` | `CM.IDE.HeartbeatService` | P1 | No payload |
| `0x07` | `BOOT_LOG` | `CM.Fault.Reporter` | `CM.IDE.FaultReceiver` | P3 | UTF-8 string: boot step |
| `0x08` | `PERF` | `CM.Perf.Reporter` | `CM.IDE.FaultReceiver` | P3 | uptime_ms(4)+instr(4)+faults(2)+boots(2) |

### 5.2 Media — FPGA → IDE

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x09` | `MEDIA_REQ` | `CM.Media.Consumer` | `CM.IDE.MediaServer` | P3 | token(8)+offset(4)+chunk_len(2) |
| `0x0A` | `MEDIA_ACK` | `CM.Media.Consumer` | `CM.IDE.MediaServer` | P3 | token(8)+offset(4) — buffer ready |

### 5.3 Browse — FPGA → IDE

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x10` | `BROWSE_REQ` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | url_len(2)+url+width(2)+height(2)+mode(1) |
| `0x11` | `BROWSE_NAV` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | direction(1): 0=back,1=fwd,2=reload |
| `0x12` | `BROWSE_CLICK` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | x(2)+y(2) |
| `0x13` | `BROWSE_SCROLL` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | delta_lines(2) |
| `0x14` | `BROWSE_INPUT` | `CM.Browse.Client` | `CM.IDE.BrowseProxy` | P4 | element_id(2)+text_len(2)+utf8 |

### 5.4 LUMP / Commands — IDE → FPGA

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x80` | `LUMP_DATA` | `CM.IDE.Deployer` | `CM.Lump.Loader` | P2 | token(8)+bram_addr(4)+BEEF-framed binary |
| `0x81` | `CMD` | `CM.IDE.Commander` | `CM.Board.Identity` | P2 | cmd(1): 0=pause,1=step,2=resume,3=reset,4=query_ns |
| `0x82` | `ACK` | *(mirrors source of acked msg)* | *(mirrors dest)* | P1 | seq(2)+gt_err(1)+detail |
| `0x83` | `PONG` | `CM.IDE.HeartbeatService` | `CM.Heartbeat` | P1 | server_time_ms(8) |

### 5.5 Media Delivery — IDE → FPGA

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x84` | `MEDIA_META` | `CM.IDE.MediaServer` | `CM.Media.Consumer` | P3 | token(8)+media_type(1)+fmt(1)+total_size(4)+meta_json |
| `0x85` | `MEDIA_CHUNK` | `CM.IDE.MediaServer` | `CM.Media.Consumer` | P3 | token(8)+offset(4)+data[...] |
| `0x86` | `AUDIO_STREAM` | `CM.IDE.MediaServer` | `CM.Media.Consumer` | P3 | token(8)+fmt(1)+chunk[...] |

### 5.6 Browse Responses — IDE → FPGA

| Type | Name | Source GT | Destination GT | Priority | Payload |
|------|------|-----------|----------------|----------|---------|
| `0x88` | `BROWSE_META` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+url+title |
| `0x89` | `BROWSE_FRAME` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+tile_x(2)+tile_y(2)+rgb565[...] |
| `0x8A` | `BROWSE_TEXT` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+structured_text |
| `0x8B` | `BROWSE_LINKS` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+{x(2),y(2),w(2),h(2),url_hash(4)}[] |
| `0x8C` | `BROWSE_STATUS` | `CM.IDE.BrowseProxy` | `CM.Browse.Client` | P4 | page_id(2)+status(1)+gt_err(1) |

---

## 6. Media Format Codes

### 6.1 Documents (`media_type = 0x01`)

| fmt | Name | Description |
|-----|------|-------------|
| `0x01` | `DOC_UTF8` | Plain text, paginated by FPGA |
| `0x02` | `DOC_LINES` | Pre-wrapped fixed-width lines |
| `0x03` | `DOC_PDF_RASTER` | Page pre-rasterized to RGB565 by IDE |

### 6.2 Images (`media_type = 0x02`)

| fmt | Name | Description |
|-----|------|-------------|
| `0x01` | `IMG_RGB565` | Raw 16bpp — width×height in MEDIA_META |
| `0x02` | `IMG_RGB888` | Raw 24bpp |
| `0x03` | `IMG_JPEG` | JPEG compressed |
| `0x04` | `IMG_RLE` | Run-length encoded — good for diagrams |
| `0x05` | `IMG_1BPP` | 1-bit monochrome — e-ink, OLED |
| `0x06` | `IMG_TILE` | Tiled RGB565 for large displays |

### 6.3 Audio (`media_type = 0x03`)

| fmt | Name | Rate | Notes |
|-----|------|------|-------|
| `0x01` | `AUD_MULAW_8K` | 8 kHz µ-law | Telephony / speech; 8 KB/s — fits 115200 |
| `0x02` | `AUD_PCM_8K16` | 8 kHz 16-bit | Clear speech; 16 KB/s |
| `0x03` | `AUD_ADPCM_22K` | 22 kHz ADPCM | 4:1 compression; 5.5 KB/s |
| `0x04` | `AUD_PCM_44K16` | 44.1 kHz 16-bit | HiFi music; 176 KB/s — needs 921600 baud |
| `0x05` | `AUD_PCM_48K16` | 48 kHz 16-bit | Studio HiFi |
| `0x06` | `AUD_OPUS` | Variable | Best quality/bandwidth ratio |
| `0x07` | `AUD_TTS_REQ` | — | FPGA sends UTF-8 text; IDE returns audio |
| `0x08` | `AUD_SPEECH_16K` | 16 kHz 16-bit | Speech recognition quality |

### 6.4 HTML Browse render modes

| mode | Name | Bridge tool | Bandwidth |
|------|------|------------|-----------|
| `0x00` | TEXT | `requests` + BeautifulSoup | ~1–5 KB per page |
| `0x01` | SIMPLE | BS4 structured DOM | ~5–20 KB |
| `0x02` | RASTER | Playwright headless screenshot | ~300 KB tiled |
| `0x03` | WIKI | Dedicated Wikipedia extractor | ~3 KB |

---

## 7. Bandwidth Budget

At 115200 baud the usable payload throughput is approximately **10 KB/s**.

| Use case | Bandwidth | Fits at 115200? |
|----------|-----------|-----------------|
| CALLHOME (1 Hz) | ~200 B/s | ✅ |
| FAULT events | burst only | ✅ |
| TRACE (sampled 10 Hz) | ~130 B/s | ✅ |
| Speech µ-law 8kHz | 8 KB/s | ✅ just fits |
| ADPCM 22 kHz | ~5.5 KB/s | ✅ comfortable |
| LUMP deploy 16 KB | ~1.6 s one-shot | ✅ |
| JPEG image 100 KB | ~10 s one-shot | ✅ with tile cache |
| HTML TEXT page | <1 s | ✅ |
| HiFi music 44.1kHz | 176 KB/s | ❌ needs 921600 baud |

For HiFi: `UART_CLOCKDIV = 25_000_000 / (8 × 921600) ≈ 3`.  
A `CMD (0x81)` sub-command `5=set_baud` negotiates higher rates at runtime without
firmware changes.

---

## 8. Implementation Priorities

### Phase 1 — Foundation (one firmware flash, then frozen)

| Item | Files |
|------|-------|
| `cm_send_msg` / `cm_poll_rx` / `cm_on_msg` in firmware | `hardware/soc_minimal/firmware/main.c` |
| Re-wrap existing CALLHOME as `MSG_CALLHOME (0x01)` | firmware |
| Bridge parser: framing + CRC + GT dispatch | `hardware/soc_combined/callhome_bridge.py` |
| `handle_callhome (0x01)` — existing behaviour, new path | bridge |
| `handle_ping (0x06)` + `PONG (0x83)` round-trip | bridge |
| GT validation layer: `validate_gt()` + `send_ack_error()` | bridge |

**Outcome:** Protocol live. GT enforcement active. All future work is IDE/bridge only.

### Phase 2 — Deploy + Fault

| Item | Files |
|------|-------|
| `LUMP_DATA (0x80)` — IDE pushes LUMP over UART | bridge + server + FPGA UART RX |
| `FAULT (0x02)` — full event with tier/GT/NIA | firmware + bridge + server |
| IDE fault popup from hardware fault events | `simulator/app-misc.js` |
| MTBF chart in Dashboard per NIA (hardware source) | server + IDE |

### Phase 3 — Trace + Lazy-Load

| Item | Files |
|------|-------|
| `TRACE (0x03)` — emit on CALL/RETURN | firmware |
| Pipeline view live from hardware TRACE | IDE |
| `LUMP_REQ (0x04)` + `LUMP_DATA (0x80)` Lazy-Load | firmware + bridge + server |
| `NS_DUMP (0x05)` — namespace agreement check | firmware + bridge |

### Phase 4 — Media

| Item | Files |
|------|-------|
| `MEDIA_REQ/CHUNK` chunked delivery | bridge + server |
| Audio: µ-law 8kHz → DAC/PWM output | firmware + hardware |
| `AUD_TTS_REQ` — text-to-speech via bridge | bridge |
| Image: RGB565 tiles → FPGA framebuffer | bridge + firmware |

### Phase 5 — Browse

| Item | Files |
|------|-------|
| `BROWSE_REQ` TEXT mode (BeautifulSoup) | bridge |
| `BROWSE_REQ` RASTER mode (Playwright) | bridge |
| Browse GT C-list enforcement in bridge | bridge + server |
| Click / scroll / input messages | bridge + firmware input handler |
| Parent domain-list management in IDE Family panel | IDE + server |

---

## 9. File Inventory

| File | Role |
|------|------|
| `hardware/soc_minimal/firmware/main.c` | Firmware — add `cm_send_msg`, `cm_poll_rx` |
| `hardware/soc_combined/callhome_bridge.py` | Bridge — GT validation + typed dispatch |
| `server/app.py` | Server — GT records, fault/trace/media endpoints |
| `server/models.py` | DB — `gt_records`, `fault_events`, `trace_log`, `media_cache` |
| `simulator/app-misc.js` | IDE — fault popups, trace view, browse UI |
| `docs/cm-msg-protocol.md` | This document — authoritative spec |

---

## 10. Versioning

Protocol version is carried in the `CALLHOME` payload as `"proto":1`. Old bridges
receiving unknown type bytes skip the frame (log + continue). Old FPGA firmware
receiving unknown IDE→FPGA types calls `cm_on_msg` which is a no-op by default.

**Protocol version 1** covers all types in this document.  
Future versions increment `proto`; firmware never changes.

---

*The security model in Sections 1 and 2 is not optional infrastructure — it is the
point of this protocol. Every implementation decision must preserve the seven
security properties in Section 1.4. When in doubt, enforce at the bridge.*
