-- =========================================================================
-- PP250.Instructions.Logic: ARM-style Logical Operations
-- =========================================================================
-- Implements bitwise logic instructions with flag updates.
-- AND, ORR (OR), EOR (XOR), BIC (bit clear), NOT operations.

module PP250.Instructions.Logic (
    instrAND,
    instrORR,
    instrEOR,
    instrBIC,
    instrNOT
) where

import qualified Data.Map as Map
import Data.Word (Word64)
import Data.Bits ((.&.), (.|.), xor, complement)
import PP250.Core.Types

-- | Helper to compute flags for logical operations
-- Logical ops set N and Z, preserve C and V
logicFlags :: CPUState -> Word64 -> ConditionFlags
logicFlags cpu result = CondFlags {
    flagN = result >= 0x8000000000000000,
    flagZ = result == 0,
    flagC = flagC (condFlags cpu),
    flagV = flagV (condFlags cpu)
}

-- | AND: DR[dest] = DR[dest] AND DR[src]
instrAND :: CPUState -> Int -> Int -> CPUState
instrAND cpu destIdx srcIdx = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        vSrc  = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res   = vDest .&. vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
    in cpu { d_regs = newDRs, condFlags = logicFlags cpu res }

-- | ORR: DR[dest] = DR[dest] OR DR[src]
instrORR :: CPUState -> Int -> Int -> CPUState
instrORR cpu destIdx srcIdx = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        vSrc  = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res   = vDest .|. vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
    in cpu { d_regs = newDRs, condFlags = logicFlags cpu res }

-- | EOR: DR[dest] = DR[dest] XOR DR[src] (Exclusive OR)
instrEOR :: CPUState -> Int -> Int -> CPUState
instrEOR cpu destIdx srcIdx = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        vSrc  = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res   = vDest `xor` vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
    in cpu { d_regs = newDRs, condFlags = logicFlags cpu res }

-- | BIC: DR[dest] = DR[dest] AND (NOT DR[src]) (Bit Clear)
instrBIC :: CPUState -> Int -> Int -> CPUState
instrBIC cpu destIdx srcIdx = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        vSrc  = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res   = vDest .&. complement vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
    in cpu { d_regs = newDRs, condFlags = logicFlags cpu res }

-- | NOT: DR[dest] = NOT DR[src] (Bitwise NOT / One's Complement)
instrNOT :: CPUState -> Int -> Int -> CPUState
instrNOT cpu destIdx srcIdx = 
    let vSrc = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res  = complement vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
    in cpu { d_regs = newDRs, condFlags = logicFlags cpu res }
