# CM_MSG — Church Machine UART Messaging Protocol

**Status:** Design specification — v0.3  
**Date:** 2026-06-09  
**Scope:** Ti60 F225 (initial target); architecture applies to all CM-connected boards

---

## Guiding Principle

**No message is trusted unless it is authorized, authenticated, and encrypted by a Golden Token pair.**

The Church Machine is built on capability-based security. Every memory access is
GT-validated in hardware. Every call is GT-validated in the ISA. This protocol
extends that same guarantee to the UART channel — with encryption as a first-class
property, not an afterthought:

- **Authorization** — A board that does not hold a GT for a capability cannot exercise
  it, even over UART. The bridge enforces this on every frame.
- **Authentication** — Every frame carries an HMAC tag derived from the GT key pair.
  A forged or tampered frame is rejected before any handler is called.
- **Encryption** — Every payload is encrypted with a session key derived from the
  OGT key pair. A message in transit reveals nothing about its content to an
  observer on the wire.

This is not an add-on. It is the protocol's reason for existing.

---

## 1. Trust Architecture

### 1.1 The chain of trust

```
┌──────────────────────────────────────────────────────────────┐
│                    FPGA Board (Ti60 F225)                     │
│                                                              │
│  GT bundle in protected BRAM:                                │
│    { gt_name → (token_32, K_enc_128, K_mac_128, nonce_ctr) } │
│                                                              │
│  CALLHOME (0x01): board_uid + fpga_nonce + gt_manifest       │
│  All subsequent frames: OGT-encrypted + HMAC-authenticated   │
└──────────────────────────┬───────────────────────────────────┘
                           │  UART
                           │  [0xCE][0xAA][type][seq][flags][len]
                           │  [nonce:4][ChaCha20(payload)][HMAC-8]
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  Bridge (callhome_bridge.py)                  │
│                                                              │
│  1. Parse frame header — verify magic                        │
│  2. Look up board's GT record by board_uid                   │
│  3. Verify HMAC tag  (reject + log on failure)               │
│  4. Verify nonce > last_seen  (replay protection)            │
│  5. Decrypt payload using K_enc for this GT pair             │
│  6. Validate Source GT for msg.type                          │
│  7. On pass → route to handler                               │
│  8. On fail → send ACK(GT_ERROR) + log rejection             │
└──────────────────────────┬───────────────────────────────────┘
                           │  HTTP POST / SSE  (plaintext inside server)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  IDE Server (app.py)                         │
│                                                              │
│  Mints GT records with keys:  token_32 + K_enc + K_mac       │
│  Deploys key bundles to FPGA via LUMP_DATA (0x80)            │
│  Revokes GTs + keys server-side; no FPGA reflash needed      │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 GT validation and encryption at the bridge

GT validation and decryption are intentionally in the bridge, not the firmware. This is by design:

- **Firmware stays frozen.** New GT types, new revocations, new domain rules, new
  cipher algorithms — all applied on the IDE side. The FPGA never needs reflashing
  to change permissions or upgrade crypto.
- **Point-to-point channel.** The UART bridge is a 1:1 connection to one board. Once
  CALLHOME establishes the board's identity and completes the nonce handshake, every
  subsequent message is decrypted and validated against that board's GT record.
- **Keys, not tokens, in the wire.** The 32-bit GT token is a hardware capability
  handle — too short for cryptography. Each GT is extended with a 128-bit `K_enc`
  and `K_mac`. These keys live in the FPGA's protected BRAM and the IDE's GT record.
  The wire carries the encrypted payload and HMAC tag, not the token itself. The
  bridge recovers the plaintext and then validates the GT type map.

### 1.3 Trust states

| State | Description | Allowed message types |
|-------|-------------|----------------------|
| **Unregistered** | CALLHOME not yet received | `0x01 CALLHOME`, `0x06 PING` only |
| **Registered** | CALLHOME received, GT record loaded | All types for which board holds GT |
| **Suspended** | Admin-suspended board | `0x01 CALLHOME` only (re-registration) |
| **Revoked GT** | Specific GT removed from record | All other GTs still valid |

### 1.4 Security properties guaranteed by this protocol

1. **Identity** — Every board is identified by a unique SHA-32 of its UID, minted once at registration.
2. **Confidentiality** — Every payload is ChaCha20-encrypted using a per-GT-pair 128-bit key. An observer on the UART wire sees only ciphertext.
3. **Integrity + Authentication** — Every frame carries an 8-byte HMAC-SHA256 tag keyed with `K_mac`. A tampered frame is rejected before decryption.
4. **Replay protection** — Every frame includes a 32-bit monotonic nonce counter per GT pair. The bridge rejects any frame whose nonce ≤ `last_seen_nonce`.
5. **Least privilege** — Each capability is a separate GT with its own key pair. A board doing callhome cannot browse unless `Browse.Client` was explicitly granted — and its key was deployed.
6. **Capability confinement** — `CM.Browse.Client` confines browsing to a parent-approved domain C-list. The hardware token IS the permission list.
7. **Revocability** — Any GT and its associated keys are removed server-side. Takes effect on next bridge connect. No FPGA reflash needed.
8. **Unforgeability** — GT tokens are SHA-32 hashes; GT keys are 128-bit secrets. A board cannot fabricate a GT it was not granted, nor derive a key it was not deployed.
9. **Non-escalation** — A board cannot request a GT it doesn't hold. The bridge never grants on demand — only the admin/family panel mints GTs.

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

### 2.4 GT validation and crypto error codes

| Code | Name | Meaning |
|------|------|---------|
| `0x00` | `GT_OK` | Authorized, authenticated, decrypted |
| `0x01` | `GT_UNKNOWN` | Board UID not in server record |
| `0x02` | `GT_NOT_HELD` | Board doesn't hold this GT type |
| `0x03` | `GT_REVOKED` | GT was revoked; keys invalidated |
| `0x04` | `GT_DOMAIN_NOT_PERMITTED` | Browse domain not in C-list |
| `0x05` | `GT_INSUFFICIENT_PERMS` | GT exists but lacks required permission |
| `0x06` | `GT_TYPE_MISMATCH` | Source GT type incompatible with message |
| `0x07` | `GT_HMAC_FAIL` | HMAC tag verification failed — reject + alert |
| `0x08` | `GT_REPLAY` | Nonce ≤ last_seen — replay attack detected |
| `0x09` | `GT_DECRYPT_FAIL` | ChaCha20 decryption error |
| `0x0A` | `GT_NO_KEY` | GT held but key bundle not yet deployed |

### 2.5 GT lifecycle

```
REGISTRATION (first CALLHOME from new board)
  Bridge receives CALLHOME with board_uid + fpga_nonce_32
  → Server mints CM.Board.Identity:
       token_32  = SHA32(uid)
       K_enc_128 = HKDF-SHA256(IKM=SHA256(uid), salt="CM_ENC_v1", info=gt_name)
       K_mac_128 = HKDF-SHA256(IKM=SHA256(uid), salt="CM_MAC_v1", info=gt_name)
  → Server grants default set with keys:
       CM.Heartbeat, CM.Fault.Reporter, CM.Perf.Reporter, CM.Lump.Loader
  → GT record + keys persisted in church_machine.db (keys stored encrypted at rest)
  → Bridge sends ACK with ide_nonce_32 + HMAC(K_mac, ide_nonce || fpga_nonce)
  → From this point all frames are OGT-encrypted

CAPABILITY EXPANSION (admin panel)
  Admin enables tracing  → mints CM.Trace.Emitter (new K_enc, K_mac)
  Admin grants media     → mints CM.Media.Consumer (new K_enc, K_mac)
  → New GT bundle (token + keys) queued for LUMP_DATA deploy

FAMILY BROWSE SETUP (Family panel)
  Parent adds "bbc.co.uk"
  → Server mints CM.Domain.BBCNews (token = SHA32("bbc.co.uk"))
  → Server builds/updates CM.Browse.Client with new domain in C-list
  → Full GT bundle redeployed to FPGA via LUMP_DATA (0x80) at next connect

REVOCATION
  Admin removes a GT from device record
  → Keys for that GT deleted from server DB immediately
  → Next bridge connect: bridge sends GT_REVOKED for messages of that type
  → FPGA logs rejection; gracefully disables the capability
  → No firmware change, no reflash required
```

### 2.6 OGT-Encryption — key structure

Each GT is a **triple**: the hardware token, an encryption key, and an authentication key.

```
OGT = {
    gt_name:   "CM.Fault.Reporter",       // global human-readable name
    token_32:  0xA3F1C28E,                // 32-bit hardware capability handle
    K_enc:     <128-bit secret>,          // ChaCha20 stream cipher key
    K_mac:     <128-bit secret>,          // HMAC-SHA256 authentication key
    nonce_ctr: 0,                         // monotonic per-GT-pair counter
}
```

**Key derivation** (at GT mint time, server-side only):

```python
import hashlib, hmac
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes

def mint_ogt_keys(board_uid: bytes, gt_name: str) -> tuple[bytes, bytes]:
    ikm = hashlib.sha256(board_uid).digest()
    K_enc = HKDF(hashes.SHA256(), 16, salt=b"CM_ENC_v1", info=gt_name.encode()).derive(ikm)
    K_mac = HKDF(hashes.SHA256(), 16, salt=b"CM_MAC_v1", info=gt_name.encode()).derive(ikm)
    return K_enc, K_mac
```

Every GT for a given board gets a unique key pair. Revoking a GT invalidates only
that GT's keys — other capabilities on the same board are unaffected.

**Key deployment**: The IDE packages all active GT keys for a board into a
protected LUMP (type=keystore, NULL policy, no NS slot). This LUMP is
transmitted as a `LUMP_DATA (0x80)` frame — which is itself encrypted with
`CM.IDE.Deployer`'s key before the key bundle is inside. The FPGA writes the
bundle to protected BRAM. Firmware reads keys from BRAM via `cm_get_key()`.

**Session nonce handshake** (on every bridge connect):

```
FPGA  →  CALLHOME(fpga_nonce)  →  Bridge
FPGA  ←  ACK(ide_nonce, HMAC(K_mac, ide_nonce||fpga_nonce))  ←  Bridge

Session nonce base = SHA32(fpga_nonce XOR ide_nonce)
Per-frame nonce    = session_nonce_base + frame_counter (monotonically increasing)
```

The XOR-then-hash of both nonces means neither party can pre-determine nonces,
preventing an attacker who controls one side from forcing nonce reuse.

**Implementation tiers** (phased rollout):

| Tier | Frame protection | When | Notes |
|------|-----------------|------|-------|
| 0 — Plain | CRC-16 only | Phase 1 | Today's format; no encryption |
| 1 — Authenticated | HMAC-8, no encryption | Phase 2 | Add `flags` byte; HMAC replaces CRC |
| 2 — Encrypted | ChaCha20 + HMAC-8 | Phase 3 | Full OGT-Encryption |

Tier is negotiated in the CALLHOME payload (`"enc":0/1/2`). The bridge accepts
the highest tier the FPGA supports. Old firmware always sends `"enc":0` (Tier 0)
and the bridge falls back gracefully.

---

## 3. Wire Format

### 3.1 Tier 0 — Plain (Phase 1, no encryption)

Used only for the initial `CALLHOME (0x01)` and `PING (0x06)` before the key
bundle has been deployed. This is the bootstrap frame format.

```
[0xCE][0xAA][type:1][seq:2][len:2][payload: len bytes][crc16:2]
```

| Field | Bytes | Description |
|-------|-------|-------------|
| `0xCE 0xAA` | 2 | Magic sync bytes — re-synchronises parser after noise |
| `type` | 1 | Message type (0x00–0x7F = FPGA→IDE; 0x80–0xFF = IDE→FPGA) |
| `seq` | 2 | Sequence number, little-endian |
| `len` | 2 | Payload length, little-endian |
| `payload` | len | Plaintext type-specific data |
| `crc16` | 2 | CRC-16/CCITT over `type+seq+len+payload` |

### 3.2 Tier 1 — Authenticated (Phase 2, HMAC only)

Tier 0 with CRC replaced by an 8-byte HMAC-SHA256 tag. Payload still plaintext.
Used when the key bundle has been deployed but the firmware hasn't enabled ChaCha20.

```
[0xCE][0xAA][type:1][seq:2][flags:1][len:2][payload: len bytes][hmac8:8]
```

| Field | Bytes | Description |
|-------|-------|-------------|
| `flags` | 1 | Bit 0=AUTH, Bit 1=ENC, Bits 2–7 reserved (0) |
| `hmac8` | 8 | First 8 bytes of HMAC-SHA256(K_mac, type\|\|seq\|\|flags\|\|len\|\|payload) |

### 3.3 Tier 2 — OGT-Encrypted (Phase 3, full protection)

The canonical secure frame. Every payload is encrypted with ChaCha20 keyed by
the source GT's `K_enc`. The HMAC covers the ciphertext, not the plaintext
(encrypt-then-MAC). The nonce is the per-GT-pair monotonic counter, preventing
replay.

```
[0xCE][0xAA][type:1][seq:2][flags:1][len:2][nonce:4][ciphertext: len bytes][hmac8:8]
```

| Field | Bytes | Description |
|-------|-------|-------------|
| `flags` | 1 | `0x03` = AUTH\|ENC |
| `nonce` | 4 | Per-GT-pair counter (little-endian, monotonically increasing) |
| `ciphertext` | len | ChaCha20(K_enc, nonce\|\|seq, plaintext_payload) |
| `hmac8` | 8 | HMAC-SHA256(K_mac, type\|\|seq\|\|flags\|\|len\|\|nonce\|\|ciphertext)[0:8] |

**Decryption order at bridge:**
1. Verify magic `0xCE 0xAA`
2. Read `flags` — determine tier
3. Verify HMAC-8 over ciphertext (reject immediately on failure → `GT_HMAC_FAIL`)
4. Verify `nonce > last_nonce[board_uid][gt_name]` (reject → `GT_REPLAY`)
5. Decrypt ciphertext → plaintext payload
6. Validate Source GT for `type` → route to handler

**The HMAC check always comes before decryption.** This is the standard
encrypt-then-MAC ordering: it prevents padding oracle and length-extension attacks.

Minimum Tier 2 frame size: 9 + 4 + 8 = **21 bytes** (zero-length payload).

### 3.4 Tier negotiation

The `CALLHOME (0x01)` payload includes `"enc": N` where N = 0, 1, or 2:
- N=0 → Tier 0 only (old firmware, no keys)
- N=1 → Tier 1 (keys deployed, no ChaCha20)
- N=2 → Tier 2 (full OGT-Encryption)

The bridge responds with `ACK` carrying the agreed tier. Both sides use that tier
for all subsequent frames in the session.

### 3.5 Firmware API (frozen after first flash)

The entire protocol surface exposed to firmware — encryption included — is four
functions. Encryption is transparent to the caller:

```c
/* Send a message. Encryption tier selected automatically from BRAM key bundle. */
void cm_send_msg(uint8_t type, uint16_t seq,
                 const uint8_t *payload, uint16_t len);

/* Receive loop — call from main loop or UART ISR. Decrypts transparently. */
void cm_poll_rx(void);

/* Called with decrypted plaintext payload after auth + replay checks pass. */
__attribute__((weak))
void cm_on_msg(uint8_t type, uint16_t seq,
               const uint8_t *payload, uint16_t len);

/* Internal — reads K_enc/K_mac for a GT from protected BRAM keystore. */
static void cm_get_key(uint8_t msg_type, uint8_t *k_enc, uint8_t *k_mac);
```

The firmware never handles key derivation, HMAC verification, or nonce management.
Those are `cm_send_msg` / `cm_poll_rx` internals. Application code calls
`cm_send_msg` and receives decrypted plaintext in `cm_on_msg`. Encryption is
invisible to every layer above it — exactly as capability enforcement is invisible
to application code in the Church Machine ISA.

---

## 4. Bridge — Trusted Router

`callhome_bridge.py` is the **only** trust enforcement point. No message reaches the
IDE server without passing through its full verification pipeline:
**magic → HMAC → replay → decrypt → GT check → handler**.

```python
# Maps message type → required Source GT global name
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

def on_raw_frame(msg_type, seq, flags, nonce, raw_payload):
    """
    Full OGT verification pipeline. Called with raw (possibly encrypted) bytes.
    Steps run in this exact order — never rearranged.
    """
    gt_name = CM_MSG_TYPE_GT.get(msg_type)

    # --- Step 1: HMAC verification (encrypt-then-MAC — check before decrypt) ---
    if flags & FLAG_AUTH:
        err = verify_hmac(board_uid, gt_name, msg_type, seq, flags, nonce, raw_payload)
        if err != GT_OK:
            send_ack_error(seq, GT_HMAC_FAIL)
            log.critical("HMAC FAIL type=0x%02X board=%s — possible tampering", msg_type, board_uid)
            return

    # --- Step 2: Replay protection ---
    if flags & FLAG_AUTH:
        if nonce <= last_nonce.get((board_uid, gt_name), -1):
            send_ack_error(seq, GT_REPLAY)
            log.critical("REPLAY type=0x%02X board=%s nonce=%d", msg_type, board_uid, nonce)
            return
        last_nonce[(board_uid, gt_name)] = nonce

    # --- Step 3: Decrypt ---
    if flags & FLAG_ENC:
        payload = chacha20_decrypt(board_uid, gt_name, nonce, raw_payload)
        if payload is None:
            send_ack_error(seq, GT_DECRYPT_FAIL)
            return
    else:
        payload = raw_payload  # Tier 0 / Tier 1 — plaintext

    # --- Step 4: GT authorization ---
    if gt_name:
        err = validate_gt(board_uid, gt_name, msg_type)
        if err != GT_OK:
            send_ack_error(seq, err)
            log.warning("GT rejected: type=0x%02X board=%s err=%s", msg_type, board_uid, err)
            return

    # --- Step 5: Dispatch ---
    handler = CM_HANDLERS.get(msg_type)
    if handler:
        handler(seq, payload)
    else:
        log.info("Unhandled CM_MSG type=0x%02X seq=%d (future type — ignored)",
                 msg_type, seq)
```

**The pipeline order is not negotiable:** HMAC before replay before decrypt before
GT check. Swapping any two steps opens an attack vector. HMAC first ensures the
bridge never spends compute on decrypting a frame it will reject.

Unknown type bytes pass the crypto pipeline and are then **logged and ignored** —
a future firmware emitting a new type works against an old bridge safely.

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

*The security model in Sections 1–3 is not optional infrastructure — it is the
point of this protocol. Every implementation decision must preserve the nine
security properties in Section 1.4. The bridge pipeline order in Section 4
(HMAC → replay → decrypt → GT → dispatch) is invariant and must never be reordered.
When in doubt, enforce at the bridge. When adding a new GT, mint its K_enc and K_mac
at the same time as its token_32 — a GT without keys is incomplete.*
