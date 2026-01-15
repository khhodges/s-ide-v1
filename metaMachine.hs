-- =========================================================================
-- CTMM META-MACHINE: Main Entry Point
-- =========================================================================
-- Architect: Kenneth James Hamer-Hodges
-- 
-- This is the main entry point for the CTMM (Church-Turing Meta-Machine)
-- simulator. It orchestrates the boot sequence and enters the interactive
-- console for testing and exploration of the capability-based architecture.
--
-- Module Structure:
--   CTMM/Core/Types.hs      - Shared data types (CPUState, ContextRegister, etc.)
--   CTMM/Core/Utils.hs      - Utility functions (formatting, key operations)
--   CTMM/Instructions/*.hs  - Individual instruction implementations
--   CTMM/Console/HUD.hs     - System telemetry display
--   CTMM/Console/REPL.hs    - Interactive console
--   CTMM/Boot/Sequence.hs   - Boot sequence implementation
-- =========================================================================

module Main where

import CTMM.Boot.Sequence
import CTMM.Console.REPL (runConsole)

-- | Main entry point: Execute boot sequence then enter interactive console
main :: IO ()
main = do
    putStrLn "--- CTMM BOOT SEQUENCE START ---"
    
    cpu1 <- bootStep1_HardwareReset
    putStrLn ">> Press ENTER for Step 2..." >> getLine
    
    cpu2 <- bootStep2_LoadNamespace cpu1
    putStrLn ">> Press ENTER for Step 3..." >> getLine
    
    cpu3 <- bootStep3_LoadThread cpu2
    putStrLn ">> Press ENTER for Step 4..." >> getLine
    
    cpu4 <- bootStep4_LoadResources cpu3
    putStrLn ">> BOOT COMPLETE. ENTERING CONSOLE..."
    putStrLn ">> Try: ADD 0 1 (Computes DR0 = DR0 + DR1)" >> getLine
    
    runConsole cpu4
