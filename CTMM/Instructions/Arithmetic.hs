-- =========================================================================
-- CTMM.Instructions.Arithmetic: ARM-style Arithmetic Operations
-- =========================================================================
-- Implements arithmetic instructions with flag updates matching ARM semantics.
-- All operations update NZCV condition flags.

module CTMM.Instructions.Arithmetic (
    instrADD,
    instrSUB,
    instrMUL,
    instrMOV,
    instrMVN,
    instrNEG,
    instrADDI,
    instrSUBI,
    computeFlags
) where

import qualified Data.Map as Map
import Data.Word (Word64)
import Data.Bits (testBit, complement)
import CTMM.Core.Types

-- | Compute ARM-style NZCV condition flags for a result.
computeFlags :: String -> Word64 -> Word64 -> Word64 -> ConditionFlags
computeFlags op a b result = CondFlags {
    flagN = testBit result 63,
    flagZ = result == 0,
    flagC = case op of
        "ADD" -> result < a
        "SUB" -> a >= b
        "NEG" -> b == 0
        _     -> False,
    flagV = case op of
        "ADD" -> signedOverflowAdd a b result
        "SUB" -> signedOverflowSub a b result
        "NEG" -> signedOverflowSub 0 b result
        _     -> False
}

signedOverflowAdd :: Word64 -> Word64 -> Word64 -> Bool
signedOverflowAdd a b result =
    let signA = testBit a 63
        signB = testBit b 63
        signR = testBit result 63
    in (signA == signB) && (signA /= signR)

signedOverflowSub :: Word64 -> Word64 -> Word64 -> Bool
signedOverflowSub a b result =
    let signA = testBit a 63
        signB = testBit b 63
        signR = testBit result 63
    in (signA /= signB) && (signB == signR)

-- | ADD: DR[dest] = DR[dest] + DR[src]
instrADD :: CPUState -> Int -> Int -> CPUState
instrADD cpu destIdx srcIdx = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        vSrc  = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res   = vDest + vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = computeFlags "ADD" vDest vSrc res
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | SUB: DR[dest] = DR[dest] - DR[src]
instrSUB :: CPUState -> Int -> Int -> CPUState
instrSUB cpu destIdx srcIdx = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        vSrc  = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res   = vDest - vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = computeFlags "SUB" vDest vSrc res
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | MUL: DR[dest] = DR[dest] * DR[src]
instrMUL :: CPUState -> Int -> Int -> CPUState
instrMUL cpu destIdx srcIdx = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        vSrc  = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res   = vDest * vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = False,
            flagV = False
        }
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | MOV: DR[dest] = DR[src] (copy register)
instrMOV :: CPUState -> Int -> Int -> CPUState
instrMOV cpu destIdx srcIdx = 
    let vSrc = Map.findWithDefault 0 srcIdx (d_regs cpu)
        newDRs = Map.insert destIdx vSrc (d_regs cpu)
        newFlags = CondFlags {
            flagN = testBit vSrc 63,
            flagZ = vSrc == 0,
            flagC = flagC (condFlags cpu),
            flagV = flagV (condFlags cpu)
        }
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | MVN: DR[dest] = NOT DR[src] (bitwise NOT, move negated)
instrMVN :: CPUState -> Int -> Int -> CPUState
instrMVN cpu destIdx srcIdx = 
    let vSrc = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res  = complement vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = CondFlags {
            flagN = testBit res 63,
            flagZ = res == 0,
            flagC = flagC (condFlags cpu),
            flagV = flagV (condFlags cpu)
        }
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | NEG: DR[dest] = -DR[src] (two's complement negate)
instrNEG :: CPUState -> Int -> Int -> CPUState
instrNEG cpu destIdx srcIdx = 
    let vSrc = Map.findWithDefault 0 srcIdx (d_regs cpu)
        res  = 0 - vSrc
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = computeFlags "NEG" 0 vSrc res
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | ADDI: DR[dest] = DR[dest] + immediate
instrADDI :: CPUState -> Int -> Word64 -> CPUState
instrADDI cpu destIdx imm = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        res   = vDest + imm
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = computeFlags "ADD" vDest imm res
    in cpu { d_regs = newDRs, condFlags = newFlags }

-- | SUBI: DR[dest] = DR[dest] - immediate
instrSUBI :: CPUState -> Int -> Word64 -> CPUState
instrSUBI cpu destIdx imm = 
    let vDest = Map.findWithDefault 0 destIdx (d_regs cpu)
        res   = vDest - imm
        newDRs = Map.insert destIdx res (d_regs cpu)
        newFlags = computeFlags "SUB" vDest imm res
    in cpu { d_regs = newDRs, condFlags = newFlags }
