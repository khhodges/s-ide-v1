-- =========================================================================
-- CTMM.Instructions.Branch: ARM-style Branch Operations
-- =========================================================================
-- Implements conditional and unconditional branching.
-- B (Branch), BL (Branch with Link) with condition code support.

module CTMM.Instructions.Branch (
    instrB,
    instrBL
) where

import qualified Data.Map as Map
import Data.Word (Word64)
import CTMM.Core.Types
import CTMM.Instructions.Compare (checkCondition)

-- | B: Branch - Jump to a new instruction offset
-- Can be conditional based on NZCV flags
-- Returns Either error message or new CPU state
instrB :: CPUState -> String -> Int -> Either String CPUState
instrB cpu cond offset = 
    if checkCondition (condFlags cpu) cond
        then Right cpu { ip_Offset = offset }
        else Right cpu  -- Condition not met, no branch taken

-- | BL: Branch with Link - Jump and save return address
-- Saves current IP+1 to DR7 (as a simple link register simulation)
-- Can be conditional based on NZCV flags
instrBL :: CPUState -> String -> Int -> Either String CPUState
instrBL cpu cond offset = 
    if checkCondition (condFlags cpu) cond
        then 
            let linkAddr = fromIntegral (ip_Offset cpu + 1) :: Word64
                newDRs = Map.insert 7 linkAddr (d_regs cpu)
            in Right cpu { ip_Offset = offset, d_regs = newDRs }
        else Right cpu  -- Condition not met, no branch taken
