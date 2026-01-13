-- =========================================================================
-- PP250.Instructions.Shift: ARM-style Shift and Rotate Operations
-- =========================================================================
-- Implements bit shift and rotate instructions.
-- LSL (Logical Shift Left), LSR (Logical Shift Right),
-- ASR (Arithmetic Shift Right), ROR (Rotate Right)

module PP250.Instructions.Shift (
    instrLSL,
    instrLSR,
    instrASR,
    instrROR
) where

import qualified Data.Map as Map
import Data.Word (Word64)
import Data.Bits (shiftL, shiftR, testBit, (.|.), (.&.), complement)
import PP250.Core.Types

-- | LSL: Logical Shift Left - DR[dest] = DR[src] << amount
-- Shifts bits left, fills with zeros on right
-- Carry flag gets the last bit shifted out
instrLSL :: CPUState -> Int -> Int -> Int -> CPUState
instrLSL cpu destIdx srcIdx amount = 
    let vSrc = Map.findWithDefault 0 srcIdx (d_regs cpu)
        amt  = amount `mod` 64
        res  = if amt == 0 then vSrc else shiftL vSrc amt
        carry = if amt == 0 then flagC (condFlags cpu)
                else if amt <= 64 then testBit vSrc (64 - amt)
                else False
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = carry,
            flagV = flagV (condFlags cpu)
        }
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | LSR: Logical Shift Right - DR[dest] = DR[src] >> amount (unsigned)
-- Shifts bits right, fills with zeros on left
-- Carry flag gets the last bit shifted out
instrLSR :: CPUState -> Int -> Int -> Int -> CPUState
instrLSR cpu destIdx srcIdx amount = 
    let vSrc = Map.findWithDefault 0 srcIdx (d_regs cpu)
        amt  = amount `mod` 64
        res  = if amt == 0 then vSrc else shiftR vSrc amt
        carry = if amt == 0 then flagC (condFlags cpu)
                else if amt <= 64 then testBit vSrc (amt - 1)
                else False
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = carry,
            flagV = flagV (condFlags cpu)
        }
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | ASR: Arithmetic Shift Right - preserves sign bit
-- Shifts bits right, replicates sign bit on left (for signed values)
instrASR :: CPUState -> Int -> Int -> Int -> CPUState
instrASR cpu destIdx srcIdx amount = 
    let vSrc = Map.findWithDefault 0 srcIdx (d_regs cpu)
        amt  = amount `mod` 64
        signBit = testBit vSrc 63
        shifted = shiftR vSrc amt
        signExtend = if signBit && amt > 0
                     then complement (shiftR (complement 0) amt)
                     else 0
        res = shifted .|. signExtend
        carry = if amt == 0 then flagC (condFlags cpu)
                else if amt <= 64 then testBit vSrc (amt - 1)
                else signBit
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = carry,
            flagV = flagV (condFlags cpu)
        }
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | ROR: Rotate Right - bits shifted out on right wrap to left
instrROR :: CPUState -> Int -> Int -> Int -> CPUState
instrROR cpu destIdx srcIdx amount = 
    let vSrc = Map.findWithDefault 0 srcIdx (d_regs cpu)
        amt  = amount `mod` 64
        rightPart = shiftR vSrc amt
        leftPart  = shiftL vSrc (64 - amt)
        res = if amt == 0 then vSrc else rightPart .|. leftPart
        carry = if amt == 0 then flagC (condFlags cpu)
                else testBit res 63
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = carry,
            flagV = flagV (condFlags cpu)
        }
    in cpu { d_regs = newDRs, condFlags = newFlags }
