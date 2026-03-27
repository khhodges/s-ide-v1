"""hardware/outform.py — ChurchOutform: Absent-Outform lazy-load handler.

Triggered when mLoad encounters a c-list Golden Token whose typ field == 11
(Outform), indicating the lump is not yet resident in physical memory.

Protocol (all confirmed in task spec):
  1. Send a tunnel request: 6 bytes (GT raw 32-bit LE, slot_id 16-bit LE).
  2. Receive a ZIP Local File Header (30 bytes fixed, field-by-field).
  3. Validate: signature, flags bit-3, compression method, uncompressed size.
  4. Derive n from uncompressed_size (must be power-of-2 multiple of 4 words,
     6 ≤ n ≤ 14).
  5. Request memory allocation (size = 2^n words).
  6. Skip filename (L bytes, independent counter).
  7. Skip extra field (E bytes, independent counter — never combined with L).
  8. Inflate data into allocated base (STORE: direct copy; DEFLATE/RLE: stubbed).
  9. Verify CRC-32 of inflated data against header value.
 10. Call Mint.Lump(base, n) → issues E-GT, writes NS slot.

Out of scope:
  - DEFLATE Huffman+LZ77 internals (stubbed; separate hardware task).
  - RLE internals (stubbed; separate hardware task).
  - Mint.Lump internal implementation (called via interface ports).
  - Integration into core.py.

Fault types defined in hw_types.py (OUTFORM_FAULT_* constants added below).
"""

from amaranth import *
from amaranth.lib.data import View

from .hw_types import FaultType

# ── Outform-specific fault codes (extend the 5-bit FaultType space) ──────────
OUTFORM_FAULT_SIG    = 0x11   # ZIP signature != 0x04034B50
OUTFORM_FAULT_FLAGS  = 0x12   # General purpose bit 3 = 1 (data descriptor / streaming)
OUTFORM_FAULT_METHOD = 0x13   # Compression method != 0 (STORE) or 8 (DEFLATE)
OUTFORM_FAULT_N      = 0x14   # n < 6, n > 14, or size not a power-of-2 word count
OUTFORM_FAULT_CRC32  = 0x15   # CRC-32 of inflated data does not match ZIP header
OUTFORM_FAULT_ALLOC  = 0x16   # Memory allocator returned fault
OUTFORM_FAULT_MINT   = 0x17   # Mint.Lump rejected the inflated lump

# ── ZIP constants ─────────────────────────────────────────────────────────────
ZIP_SIGNATURE   = 0x04034B50  # Local File Header magic number (big-endian repr)
METHOD_STORE    = 0           # Compression method: no compression
METHOD_DEFLATE  = 8           # Compression method: DEFLATE

# ZIP LFH fixed region is 30 bytes (indices 0..29).
ZIP_HDR_LEN = 30

# CRC-32 polynomial (IEEE 802.3, bit-reflected)
CRC32_POLY   = 0xEDB88320
CRC32_INIT   = 0xFFFFFFFF   # initial value
CRC32_FINAL  = 0xFFFFFFFF   # final XOR

# Tunnel request: 6 bytes — gt_raw[31:0] LE then slot_id[15:0] LE
TUNNEL_REQ_LEN = 6


class ChurchOutform(Elaboratable):
    """Absent-Outform lazy-load handler.

    All tunnel I/O is byte-granular (rx_data / tx_data).  Memory writes for
    the inflate path are 32-bit word-granular (mem_wr_*).  Mint.Lump is
    called via a single-cycle mint_call pulse and awaits mint_done / mint_fault.
    """

    def __init__(self):
        # ── trigger / status ─────────────────────────────────────────────────
        self.outform_start = Signal()       # single-cycle start pulse
        self.outform_busy  = Signal()       # asserted throughout operation
        self.outform_done  = Signal()       # single-cycle completion
        self.outform_fault = Signal()       # single-cycle fault indication
        self.outform_fault_type = Signal(5) # 5-bit fault code (OUTFORM_FAULT_*)

        # ── incoming Outform identity ─────────────────────────────────────────
        # The raw 32-bit GT word of the absent Outform entry, and its NS slot.
        self.gt_raw  = Signal(32)  # E-GT from the NS entry (used in tunnel request)
        self.slot_id = Signal(16)  # NS slot index (used in tunnel request)

        # ── tunnel byte stream ────────────────────────────────────────────────
        # TX: sending a request to the Home Base IDE.
        self.tx_valid = Signal()   # drive high for one cycle per byte
        self.tx_data  = Signal(8)  # byte to transmit

        # RX: receiving ZIP response from the IDE.
        self.rx_valid = Signal()   # byte available from IDE
        self.rx_data  = Signal(8)  # received byte

        # ── memory allocator interface ────────────────────────────────────────
        self.alloc_req  = Signal()   # pulse: request 2^n-word block
        self.alloc_n    = Signal(5)  # log2(words) for allocation
        self.alloc_done = Signal()   # allocator assigned address
        self.alloc_fault= Signal()   # allocator failed
        self.alloc_base = Signal(32) # byte base address of allocated block

        # ── memory write port (inflate destination) ───────────────────────────
        self.mem_wr_addr = Signal(32)  # byte address (word-aligned)
        self.mem_wr_data = Signal(32)  # 32-bit word
        self.mem_wr_en   = Signal()    # write strobe

        # ── Mint.Lump interface ───────────────────────────────────────────────
        self.mint_call  = Signal()    # pulse: invoke Mint.Lump(base, n)
        self.mint_base  = Signal(32)  # byte base of inflated lump
        self.mint_n     = Signal(5)   # log2(words) = n
        self.mint_done  = Signal()    # Mint completed successfully
        self.mint_fault = Signal()    # Mint rejected the lump
        self.result_gt  = Signal(32)  # E-GT issued by Mint (valid at outform_done)

    # ── Internal CRC-32 combinatorial update (byte granular) ─────────────────
    @staticmethod
    def _crc32_byte(m, crc_in, byte_in, crc_out):
        """Add combinatorial wiring to update crc_in by one byte → crc_out.

        Uses the reflected IEEE 802.3 polynomial 0xEDB88320, bit-serial over
        8 iterations unrolled at Python elaboration time.

        Args:
            m        -- Amaranth Module
            crc_in   -- Signal(32): current CRC value
            byte_in  -- Signal(8): incoming byte (bits [7:0] processed LSB-first)
            crc_out  -- Signal(32): result (must be declared by caller)
        """
        stage = crc_in
        for i in range(8):
            xor_bit = Signal(name=f"crc32_xb_{i}")
            nxt     = Signal(32, name=f"crc32_s_{i}")
            m.d.comb += xor_bit.eq(stage[0] ^ byte_in[i])
            m.d.comb += nxt.eq((stage >> 1) ^ Mux(xor_bit, CRC32_POLY, 0))
            stage = nxt
        m.d.comb += crc_out.eq(stage)

    def elaborate(self, platform):
        m = Module()

        # ── FSM registers ─────────────────────────────────────────────────────
        hdr_byte_cnt  = Signal(5)   # 0..29 — byte position within ZIP fixed header
        tx_byte_cnt   = Signal(3)   # 0..5 — tunnel request byte sent
        fname_cnt     = Signal(16)  # L-counter (filename skip)
        extra_cnt     = Signal(16)  # E-counter (extra field skip — INDEPENDENT)

        # Latched ZIP header fields (little-endian, assembled byte by byte)
        sig_reg        = Signal(32)  # bytes  0-3
        flags_reg      = Signal(16)  # bytes  6-7
        method_reg     = Signal(16)  # bytes  8-9
        crc32_stored   = Signal(32)  # bytes 14-17
        comp_size_reg  = Signal(32)  # bytes 18-21  (informational)
        ucomp_size_reg = Signal(32)  # bytes 22-25
        fname_len_reg  = Signal(16)  # bytes 26-27 (L — filename length)
        extra_len_reg  = Signal(16)  # bytes 28-29 (E — extra field length)

        # Derived from ucomp_size
        word_count_reg = Signal(32)  # ucomp_size / 4
        n_reg          = Signal(5)   # log2(word_count), 6..14

        # Allocator / inflate state
        base_reg       = Signal(32)  # allocated byte base address
        wr_word_cnt    = Signal(32)  # words written so far during INFLATE
        byte_buf       = Signal(32)  # accumulates 4 bytes before a word write
        byte_buf_cnt   = Signal(2)   # 0..3 bytes accumulated in byte_buf
        total_words    = Signal(32)  # lump size in 32-bit words (= word_count_reg)

        # CRC-32 accumulator (updated per inflated byte)
        crc_acc        = Signal(32)  # running CRC-32 accumulator
        crc_next       = Signal(32)  # combinatorial next value for one byte

        # Mint result
        result_gt_reg  = Signal(32)

        # ── CRC-32 combinatorial wiring ───────────────────────────────────────
        # Wired from crc_acc and rx_data; latched by FSM when a byte is consumed
        self._crc32_byte(m, crc_acc, self.rx_data, crc_next)

        # ── Tunnel request byte multiplexor ───────────────────────────────────
        # 6-byte request: gt_raw[7:0], [15:8], [23:16], [31:24],
        #                 slot_id[7:0], slot_id[15:8]
        tx_byte = Signal(8)
        with m.Switch(tx_byte_cnt):
            with m.Case(0): m.d.comb += tx_byte.eq(self.gt_raw[ 0: 8])
            with m.Case(1): m.d.comb += tx_byte.eq(self.gt_raw[ 8:16])
            with m.Case(2): m.d.comb += tx_byte.eq(self.gt_raw[16:24])
            with m.Case(3): m.d.comb += tx_byte.eq(self.gt_raw[24:32])
            with m.Case(4): m.d.comb += tx_byte.eq(self.slot_id[0:8])
            with m.Case(5): m.d.comb += tx_byte.eq(self.slot_id[8:16])
            with m.Default(): m.d.comb += tx_byte.eq(0)

        # ── Default output drives ─────────────────────────────────────────────
        m.d.comb += [
            self.tx_data.eq(tx_byte),
            self.mint_base.eq(base_reg),
            self.mint_n.eq(n_reg),
            self.result_gt.eq(result_gt_reg),
        ]

        # ── FSM ───────────────────────────────────────────────────────────────
        with m.FSM(name="outform"):

            # ── IDLE ─────────────────────────────────────────────────────────
            with m.State("IDLE"):
                m.d.comb += self.outform_busy.eq(0)
                with m.If(self.outform_start):
                    m.d.sync += [
                        hdr_byte_cnt .eq(0),
                        tx_byte_cnt  .eq(0),
                        fname_cnt    .eq(0),
                        extra_cnt    .eq(0),
                        sig_reg      .eq(0),
                        flags_reg    .eq(0),
                        method_reg   .eq(0),
                        crc32_stored .eq(0),
                        comp_size_reg.eq(0),
                        ucomp_size_reg.eq(0),
                        fname_len_reg.eq(0),
                        extra_len_reg.eq(0),
                        word_count_reg.eq(0),
                        n_reg        .eq(0),
                        crc_acc      .eq(CRC32_INIT),
                        wr_word_cnt  .eq(0),
                        byte_buf     .eq(0),
                        byte_buf_cnt .eq(0),
                        result_gt_reg.eq(0),
                    ]
                    m.next = "TUNNEL_CONNECT"

            # ── TUNNEL_CONNECT ────────────────────────────────────────────────
            # Send 6-byte request (gt_raw LE, slot_id LE) to the IDE tunnel.
            with m.State("TUNNEL_CONNECT"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    self.tx_valid.eq(1),
                ]
                m.d.sync += tx_byte_cnt.eq(tx_byte_cnt + 1)
                with m.If(tx_byte_cnt == TUNNEL_REQ_LEN - 1):
                    m.d.sync += tx_byte_cnt.eq(0)
                    m.next = "RECV_HDR"

            # ── RECV_HDR ──────────────────────────────────────────────────────
            # Receive ZIP LFH fixed region byte by byte (30 bytes, indices 0..29).
            # Each field is extracted from its known byte position.
            with m.State("RECV_HDR"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(self.rx_valid):
                    # Assemble multi-byte fields (little-endian)
                    with m.Switch(hdr_byte_cnt):
                        with m.Case(0):  m.d.sync += sig_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(1):  m.d.sync += sig_reg[ 8:16].eq(self.rx_data)
                        with m.Case(2):  m.d.sync += sig_reg[16:24].eq(self.rx_data)
                        with m.Case(3):  m.d.sync += sig_reg[24:32].eq(self.rx_data)
                        with m.Case(6):  m.d.sync += flags_reg[ 0:8].eq(self.rx_data)
                        with m.Case(7):  m.d.sync += flags_reg[ 8:16].eq(self.rx_data)
                        with m.Case(8):  m.d.sync += method_reg[ 0:8].eq(self.rx_data)
                        with m.Case(9):  m.d.sync += method_reg[ 8:16].eq(self.rx_data)
                        with m.Case(14): m.d.sync += crc32_stored[ 0: 8].eq(self.rx_data)
                        with m.Case(15): m.d.sync += crc32_stored[ 8:16].eq(self.rx_data)
                        with m.Case(16): m.d.sync += crc32_stored[16:24].eq(self.rx_data)
                        with m.Case(17): m.d.sync += crc32_stored[24:32].eq(self.rx_data)
                        with m.Case(18): m.d.sync += comp_size_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(19): m.d.sync += comp_size_reg[ 8:16].eq(self.rx_data)
                        with m.Case(20): m.d.sync += comp_size_reg[16:24].eq(self.rx_data)
                        with m.Case(21): m.d.sync += comp_size_reg[24:32].eq(self.rx_data)
                        with m.Case(22): m.d.sync += ucomp_size_reg[ 0: 8].eq(self.rx_data)
                        with m.Case(23): m.d.sync += ucomp_size_reg[ 8:16].eq(self.rx_data)
                        with m.Case(24): m.d.sync += ucomp_size_reg[16:24].eq(self.rx_data)
                        with m.Case(25): m.d.sync += ucomp_size_reg[24:32].eq(self.rx_data)
                        with m.Case(26): m.d.sync += fname_len_reg[ 0:8].eq(self.rx_data)
                        with m.Case(27): m.d.sync += fname_len_reg[ 8:16].eq(self.rx_data)
                        with m.Case(28): m.d.sync += extra_len_reg[ 0:8].eq(self.rx_data)
                        with m.Case(29): m.d.sync += extra_len_reg[ 8:16].eq(self.rx_data)
                    m.d.sync += hdr_byte_cnt.eq(hdr_byte_cnt + 1)
                    with m.If(hdr_byte_cnt == ZIP_HDR_LEN - 1):
                        m.next = "CHECK_SIG"

            # ── CHECK_SIG ─────────────────────────────────────────────────────
            # Verify the ZIP Local File Header signature.
            with m.State("CHECK_SIG"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(sig_reg != ZIP_SIGNATURE):
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_SIG)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_FLAGS"

            # ── CHECK_FLAGS ───────────────────────────────────────────────────
            # Bit 3 of general purpose flag = 1 → data descriptor / streaming.
            # Streaming mode is rejected: CRC-32 and sizes are in the header,
            # not appended after the data.
            with m.State("CHECK_FLAGS"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(flags_reg[3]):
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_FLAGS)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "READ_UCSIZE"

            # ── READ_UCSIZE ───────────────────────────────────────────────────
            # Compute word count and check byte alignment.
            # ZIP uncompressed_size must be divisible by 4 (word-aligned lump).
            with m.State("READ_UCSIZE"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(ucomp_size_reg[0:2] != 0):
                    # Not word-aligned — reject
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_N)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += word_count_reg.eq(ucomp_size_reg >> 2)
                    m.next = "DERIVE_N"

            # ── DERIVE_N ──────────────────────────────────────────────────────
            # word_count must be a power of 2 in [64, 16384].
            # n = log2(word_count); valid range 6 ≤ n ≤ 14.
            # Reject: word_count == 0; not power of 2; n < 6; n > 14.
            with m.State("DERIVE_N"):
                m.d.comb += self.outform_busy.eq(1)

                # Power-of-2 check: (x & (x-1)) == 0 for x > 0
                is_pow2 = Signal()
                m.d.comb += is_pow2.eq(
                    (word_count_reg != 0) &
                    ((word_count_reg & (word_count_reg - 1)) == 0)
                )

                # Compute log2 via one-hot match (word_count is small: max 16384)
                n_computed = Signal(5)
                with m.Switch(word_count_reg):
                    for bit in range(6, 15):    # 2^6=64 .. 2^14=16384
                        with m.Case(1 << bit):
                            m.d.comb += n_computed.eq(bit)
                    with m.Default():
                        m.d.comb += n_computed.eq(0)

                with m.If(~is_pow2 | (n_computed < 6) | (n_computed > 14)):
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_N)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += [
                        n_reg.eq(n_computed),
                        total_words.eq(word_count_reg),
                    ]
                    m.next = "ALLOC"

            # ── ALLOC ─────────────────────────────────────────────────────────
            # Request memory allocation of 2^n words.  Await alloc_done.
            with m.State("ALLOC"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    self.alloc_req.eq(1),
                    self.alloc_n.eq(n_reg),
                ]
                with m.If(self.alloc_fault):
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_ALLOC)]
                    m.next = "FAULT"
                with m.Elif(self.alloc_done):
                    m.d.sync += [
                        base_reg.eq(self.alloc_base),
                        wr_word_cnt.eq(0),
                        byte_buf_cnt.eq(0),
                        byte_buf.eq(0),
                        crc_acc.eq(CRC32_INIT),
                        fname_cnt.eq(fname_len_reg),   # prime L-counter
                    ]
                    m.next = "SKIP_FNAME"

            # ── SKIP_FNAME ────────────────────────────────────────────────────
            # Consume exactly L (fname_len_reg) bytes from the tunnel.
            # fname_cnt is a SEPARATE signal — it never participates in E-field
            # arithmetic.  If L == 0 transition immediately.
            with m.State("SKIP_FNAME"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(fname_cnt == 0):
                    # L = 0 or all bytes consumed → prime E-counter, move on
                    m.d.sync += extra_cnt.eq(extra_len_reg)
                    m.next = "SKIP_EXTRA"
                with m.Elif(self.rx_valid):
                    m.d.sync += fname_cnt.eq(fname_cnt - 1)

            # ── SKIP_EXTRA ────────────────────────────────────────────────────
            # Consume exactly E (extra_len_reg) bytes from the tunnel.
            # extra_cnt is INDEPENDENT of fname_cnt — no shared arithmetic.
            # If E == 0 transition immediately.
            with m.State("SKIP_EXTRA"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(extra_cnt == 0):
                    m.next = "INFLATE"
                with m.Elif(self.rx_valid):
                    m.d.sync += extra_cnt.eq(extra_cnt - 1)

            # ── INFLATE ───────────────────────────────────────────────────────
            # Dispatch on compression method, copy data into allocated region.
            #
            # STORE (method=0): bytes arrive from tunnel → accumulate 4 per word,
            #   write word to memory, update CRC-32.
            # DEFLATE (method=8): TODO — full Huffman+LZ77 sub-FSM is a separate
            #   hardware task; fault for now.
            # Any other method: fault OUTFORM_FAULT_METHOD.
            with m.State("INFLATE"):
                m.d.comb += self.outform_busy.eq(1)
                with m.If(method_reg == METHOD_STORE):
                    with m.If(self.rx_valid):
                        # Accumulate byte into 4-byte buffer (little-endian)
                        with m.Switch(byte_buf_cnt):
                            with m.Case(0):
                                m.d.sync += byte_buf[ 0: 8].eq(self.rx_data)
                            with m.Case(1):
                                m.d.sync += byte_buf[ 8:16].eq(self.rx_data)
                            with m.Case(2):
                                m.d.sync += byte_buf[16:24].eq(self.rx_data)
                            with m.Case(3):
                                m.d.sync += byte_buf[24:32].eq(self.rx_data)
                        # Update CRC-32 for this byte
                        m.d.sync += crc_acc.eq(crc_next)
                        m.d.sync += byte_buf_cnt.eq(byte_buf_cnt + 1)

                    with m.If(byte_buf_cnt == 3):
                        # 4-byte word complete — write to memory
                        # Byte address: base + word_index * 4
                        m.d.comb += [
                            self.mem_wr_addr.eq(base_reg + (wr_word_cnt << 2)),
                            self.mem_wr_data.eq(byte_buf),
                            self.mem_wr_en.eq(1),
                        ]
                        m.d.sync += wr_word_cnt.eq(wr_word_cnt + 1)
                        with m.If(wr_word_cnt + 1 == total_words):
                            m.next = "CHECK_CRC32"

                with m.Elif(method_reg == METHOD_DEFLATE):
                    # TODO: DEFLATE (Huffman+LZ77) sub-FSM — separate hardware task.
                    # For now, fault to avoid silent data corruption.
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_METHOD)]
                    m.next = "FAULT"

                with m.Else():
                    # Unknown / unsupported method (incl. custom RLE):
                    # TODO: RLE sub-FSM when RLE method code is standardised.
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_METHOD)]
                    m.next = "FAULT"

            # ── CHECK_CRC32 ───────────────────────────────────────────────────
            # Compare accumulated CRC-32 (final-XOR applied) with stored value.
            with m.State("CHECK_CRC32"):
                m.d.comb += self.outform_busy.eq(1)
                crc_final = Signal(32)
                m.d.comb += crc_final.eq(crc_acc ^ CRC32_FINAL)
                with m.If(crc_final != crc32_stored):
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_CRC32)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "MINT"

            # ── MINT ─────────────────────────────────────────────────────────
            # Pulse mint_call for one cycle, then await mint_done / mint_fault.
            with m.State("MINT"):
                m.d.comb += [
                    self.outform_busy.eq(1),
                    self.mint_call.eq(1),
                ]
                with m.If(self.mint_fault):
                    m.d.sync += [self.outform_fault_type.eq(OUTFORM_FAULT_MINT)]
                    m.next = "FAULT"
                with m.Elif(self.mint_done):
                    m.next = "COMPLETE"

            # ── COMPLETE ─────────────────────────────────────────────────────
            with m.State("COMPLETE"):
                m.d.comb += [
                    self.outform_busy.eq(0),
                    self.outform_done.eq(1),
                ]
                m.next = "IDLE"

            # ── FAULT ─────────────────────────────────────────────────────────
            with m.State("FAULT"):
                m.d.comb += [
                    self.outform_busy.eq(0),
                    self.outform_fault.eq(1),
                ]
                m.next = "IDLE"

        return m
