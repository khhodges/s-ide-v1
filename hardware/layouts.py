from amaranth import *
from amaranth.lib.data import StructLayout

GT_LAYOUT = StructLayout({
    "slot_id": unsigned(16),
    "gt_seq":  unsigned(7),
    "gt_type": unsigned(2),
    "perms":   unsigned(6),
    "b_flag":  unsigned(1),
})

CAP_REG_LAYOUT = StructLayout({
    "word0_gt":       GT_LAYOUT,
    "word1_location": unsigned(32),
    "word2_w2":       unsigned(32),
    "word3_w3":       unsigned(32),
})

WORD2_LAYOUT = StructLayout({
    "limit_offset": unsigned(21),
    "gt_seq":       unsigned(7),
    "spare":        unsigned(4),
})

WORD3_LAYOUT = StructLayout({
    "crc":   unsigned(16),
    "g_bit": unsigned(1),
    "spare": unsigned(15),
})

LUMP_HEADER_LAYOUT = StructLayout({
    "r":         unsigned(1),
    "c":         unsigned(1),
    "h":         unsigned(1),
    "mw":        unsigned(6),
    "typ":       unsigned(2),
    "cc":        unsigned(8),
    "n_minus_6": unsigned(4),
    "ver":       unsigned(4),
    "magic":     unsigned(5),
})

# 4-word Namespace Entry layout (stride = slot_id << 4, i.e. 16 bytes):
#   word0_location (+0):  code base address (32-bit pointer)
#   word1_w2       (+4):  WORD2_LAYOUT  — limit_offset[20:0] | gt_seq[6:0] | spare[3:0]
#   word2_w3       (+8):  WORD3_LAYOUT  — crc[15:0] | g_bit | spare[14:0]
#   word3_lump     (+12): LUMP_HEADER_LAYOUT — cached lump header (mw, cc, n_minus_6, …)
NS_ENTRY_LAYOUT = StructLayout({
    "word0_location": unsigned(32),
    "word1_w2":       unsigned(32),
    "word2_w3":       unsigned(32),
    "word3_lump":     unsigned(32),
})

COND_FLAGS_LAYOUT = StructLayout({
    "N": unsigned(1),
    "Z": unsigned(1),
    "C": unsigned(1),
    "V": unsigned(1),
})
