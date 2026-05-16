from amaranth import *
from amaranth.lib.data import StructLayout

GT_LAYOUT = StructLayout({
    "gt_type": unsigned(2),   # [1:0]  — 00=NULL 01=Inform 10=Outform 11=Abstract
    "f_flag":  unsigned(1),   # [2]    — Far indicator (per-token; was in NS_LIMIT_LAYOUT)
    "spare":   unsigned(1),   # [3]    — reserved/zero
    "dom":     unsigned(1),   # [4]    — domain: 0=Turing {X,W,R}, 1=Church {E,S,L}
    "perm":    unsigned(3),   # [7:5]  — 3-bit payload (dom=0: X/W/R; dom=1: E/S/L)
    "index":   unsigned(17),  # [24:8] — namespace slot index
    "version": unsigned(7),   # [31:25]— revocation counter
})

# GT encoding reference (ctmm_cap_amaranth variant):
#   Turing domain (dom=0): perm[2]=X, perm[1]=W, perm[0]=R
#   Church  domain (dom=1): perm[2]=E, perm[1]=S, perm[0]=L

CAP_REG_LAYOUT = StructLayout({
    "word0_gt":       GT_LAYOUT,
    "word1_location": unsigned(32),
    "word2_limit":    unsigned(32),
    "word3_seals":    unsigned(32),
})

# 4-word Namespace Entry layout (stride = index << 4, i.e. 16 bytes per entry):
#   word0_location   (+0):  lump base byte address (32-bit pointer)
#   word1_limit      (+4):  WORD2_LAYOUT — limit, g_bit, gt_seq (authority word)
#   word2_integrity  (+8):  integrity32(word0_location, word1_limit) — 32-bit check
#   word3_seals      (+12): FNV seal for mLoad validation (version|seal)
#
# The Abstract GT word from the source cap register is the 5th word of the
# CR15 M-window shadow (XR11 = GT, XR12 = word0_location, XR13 = word1_limit,
# XR14 = word2_integrity).  word3_seals is advisory and carried in XR15.
NS_ENTRY_LAYOUT = StructLayout({
    "word0_location":  unsigned(32),
    "word1_limit":     unsigned(32),
    "word2_integrity": unsigned(32),   # integrity32(word0_location, word1_limit)
    "word3_seals":     unsigned(32),   # FNV seal for mLoad validation (version|seal)
})

NS_LIMIT_LAYOUT = StructLayout({
    "limit":    unsigned(17),
    "reserved": unsigned(13),  # was 12; +1 absorbed from former f_flag (now in GT word)
    "g_bit":    unsigned(1),
    "b_flag":   unsigned(1),
})

SEALS_LAYOUT = StructLayout({
    "seal":    unsigned(25),
    "version": unsigned(7),
})

COND_FLAGS_LAYOUT = StructLayout({
    "N": unsigned(1),
    "Z": unsigned(1),
    "C": unsigned(1),
    "V": unsigned(1),
})
