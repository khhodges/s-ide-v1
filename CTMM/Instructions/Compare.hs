-- =========================================================================
-- CTMM.Instructions.Compare: ARM-style Compare and Test Operations
-- =========================================================================
-- Implements comparison instructions that only set flags (no result stored).
-- CMP, CMN, TST, TEQ operations for conditional execution support.

module CTMM.Instructions.Compare (
    instrCMP,
    instrCMN,
    instrTST,
    instrTEQ,
    checkCondition
) where

import qualified Data.Map as Map
import Data.Word (Word64)
import Data.Bits ((.&.), xor, testBit)
import CTMM.Core.Types

-- | Helper for signed overflow detection in subtraction
signedOverflowSub :: Word64 -> Word64 -> Word64 -> Bool
signedOverflowSub a b result =
    let signA = testBit a 63
        signB = testBit b 63
        signR = testBit result 63
    in (signA /= signB) && (signB == signR)

-- | Helper for signed overflow detection in addition
signedOverflowAdd :: Word64 -> Word64 -> Word64 -> Bool
signedOverflowAdd a b result =
    let signA = testBit a 63
        signB = testBit b 63
        signR = testBit result 63
    in (signA == signB) && (signA /= signR)

-- | CMP: Compare - sets flags based on DR[a] - DR[b]
-- Does not store result, only updates NZCV flags
instrCMP :: CPUState -> Int -> Int -> CPUState
instrCMP cpu aIdx bIdx = 
    let vA = Map.findWithDefault 0 aIdx (d_regs cpu)
        vB = Map.findWithDefault 0 bIdx (d_regs cpu)
        res = vA - vB
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = vA >= vB,
            flagV = signedOverflowSub vA vB res
        }
    in cpu { condFlags = newFlags }

-- | CMN: Compare Negative - sets flags based on DR[a] + DR[b]
-- Used to compare against negative values
instrCMN :: CPUState -> Int -> Int -> CPUState
instrCMN cpu aIdx bIdx = 
    let vA = Map.findWithDefault 0 aIdx (d_regs cpu)
        vB = Map.findWithDefault 0 bIdx (d_regs cpu)
        res = vA + vB
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = res < vA,
            flagV = signedOverflowAdd vA vB res
        }
    in cpu { condFlags = newFlags }

-- | TST: Test bits - sets flags based on DR[a] AND DR[b]
-- Used to test if specific bits are set
instrTST :: CPUState -> Int -> Int -> CPUState
instrTST cpu aIdx bIdx = 
    let vA = Map.findWithDefault 0 aIdx (d_regs cpu)
        vB = Map.findWithDefault 0 bIdx (d_regs cpu)
        res = vA .&. vB
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = flagC (condFlags cpu),
            flagV = flagV (condFlags cpu)
        }
    in cpu { condFlags = newFlags }

-- | TEQ: Test Equivalence - sets flags based on DR[a] XOR DR[b]
-- Z flag set if values are equal
instrTEQ :: CPUState -> Int -> Int -> CPUState
instrTEQ cpu aIdx bIdx = 
    let vA = Map.findWithDefault 0 aIdx (d_regs cpu)
        vB = Map.findWithDefault 0 bIdx (d_regs cpu)
        res = vA `xor` vB
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = flagC (condFlags cpu),
            flagV = flagV (condFlags cpu)
        }
    in cpu { condFlags = newFlags }

-- | Check if a condition code is satisfied based on current flags
-- Supports all standard ARM condition codes
checkCondition :: ConditionFlags -> String -> Bool
checkCondition flags cond = case cond of
    "EQ" -> flagZ flags                                    -- Equal (Z=1)
    "NE" -> not (flagZ flags)                              -- Not Equal (Z=0)
    "CS" -> flagC flags                                    -- Carry Set (C=1)
    "HS" -> flagC flags                                    -- Unsigned >= (same as CS)
    "CC" -> not (flagC flags)                              -- Carry Clear (C=0)
    "LO" -> not (flagC flags)                              -- Unsigned < (same as CC)
    "MI" -> flagN flags                                    -- Minus/Negative (N=1)
    "PL" -> not (flagN flags)                              -- Plus/Positive (N=0)
    "VS" -> flagV flags                                    -- Overflow Set (V=1)
    "VC" -> not (flagV flags)                              -- Overflow Clear (V=0)
    "HI" -> flagC flags && not (flagZ flags)               -- Unsigned > (C=1 AND Z=0)
    "LS" -> not (flagC flags) || flagZ flags               -- Unsigned <= (C=0 OR Z=1)
    "GE" -> flagN flags == flagV flags                     -- Signed >= (N=V)
    "LT" -> flagN flags /= flagV flags                     -- Signed < (N!=V)
    "GT" -> not (flagZ flags) && (flagN flags == flagV flags) -- Signed > (Z=0 AND N=V)
    "LE" -> flagZ flags || (flagN flags /= flagV flags)    -- Signed <= (Z=1 OR N!=V)
    "AL" -> True                                           -- Always (unconditional)
    ""   -> True                                           -- No condition = always
    _    -> False                                          -- Unknown condition
