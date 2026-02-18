module Church.Machine (
    churchLOAD,
    churchSAVE,
    churchCALL,
    churchRETURN,
    churchLAMBDA,
    churchTPERM,
    churchLOAD_CLIST,
    traceToString,
    showTrace,
    hasPermission
) where

import qualified Data.Map as Map
import Church.Types

hasPermission :: GoldenToken -> Permission -> Bool
hasPermission gt perm = perm `elem` gtPerms gt

churchLOAD :: MachineState -> Int -> String -> IO (Either Fault MachineState)
churchLOAD ms crDest name = do
    let ns = msNamespace ms
    case Map.lookup name (nsEntries ns) of
        Nothing ->
            return $ Left (NullFault ("Name not found in namespace: " ++ name))
        Just gt ->
            if not (hasPermission gt L)
                then return $ Left (PermFault ("LOAD requires L permission on '" ++ name ++ "'"))
                else do
                    let newCRs = Map.insert crDest gt (msContextRegs ms)
                    let trace = TraceLoad name crDest (show (gtPerms gt))
                    return $ Right (ms { msContextRegs = newCRs, msTrace = trace : msTrace ms })

churchLOAD_CLIST :: MachineState -> Int -> CList -> Int -> IO (Either Fault MachineState)
churchLOAD_CLIST ms crDest clist slot = do
    case Map.lookup slot (clSlots clist) of
        Nothing ->
            return $ Left (NullFault ("C-List slot " ++ show slot ++ " is empty"))
        Just gt ->
            if not (hasPermission gt L)
                then return $ Left (PermFault ("LOAD requires L permission on C-List slot " ++ show slot))
                else do
                    let newCRs = Map.insert crDest gt (msContextRegs ms)
                    let trace = TraceLoad (gtName gt) crDest ("[" ++ show slot ++ "] " ++ show (gtPerms gt))
                    return $ Right (ms { msContextRegs = newCRs, msTrace = trace : msTrace ms })

churchSAVE :: MachineState -> Int -> String -> Integer -> IO (Either Fault MachineState)
churchSAVE ms crSrc slot value = do
    let cr = Map.findWithDefault nullGT crSrc (msContextRegs ms)
    if gtName cr == "NULL"
        then return $ Left (NullFault "SAVE from NULL capability")
        else if not (hasPermission cr S)
            then return $ Left (PermFault ("SAVE requires S permission on '" ++ gtName cr ++ "'"))
            else do
                let newDRs = Map.insert crSrc value (msDataRegs ms)
                let trace = TraceSave (gtName cr) crSrc slot
                return $ Right (ms { msDataRegs = newDRs, msTrace = trace : msTrace ms })

churchCALL :: MachineState -> Int -> IO (Either Fault MachineState)
churchCALL ms crTarget = do
    let cr = Map.findWithDefault nullGT crTarget (msContextRegs ms)
    if gtName cr == "NULL"
        then return $ Left (NullFault "CALL to NULL capability")
        else if not (hasPermission cr E)
            then return $ Left (PermFault ("CALL requires E permission on '" ++ gtName cr ++ "'"))
            else do
                let savedScope = (gtName cr, msContextRegs ms)
                let trace = TraceCall (gtName cr) (show (gtPerms cr))
                return $ Right (ms { msCallStack = savedScope : msCallStack ms
                                   , msTrace = trace : msTrace ms })

churchRETURN :: MachineState -> IO (Either Fault MachineState)
churchRETURN ms = do
    case msCallStack ms of
        [] -> return $ Left (ScopeFault "RETURN with empty call stack")
        ((name, savedCRs):rest) -> do
            let trace = TraceReturn name
            return $ Right (ms { msContextRegs = savedCRs
                               , msCallStack = rest
                               , msTrace = trace : msTrace ms })

churchLAMBDA :: MachineState -> Int -> IO (Either Fault MachineState)
churchLAMBDA ms crTarget = do
    let cr = Map.findWithDefault nullGT crTarget (msContextRegs ms)
    if gtName cr == "NULL"
        then return $ Left (NullFault "LAMBDA on NULL capability")
        else if not (hasPermission cr X)
            then return $ Left (PermFault ("LAMBDA requires X permission on '" ++ gtName cr ++ "'"))
            else do
                let trace = TraceLambda (gtName cr) "applied"
                return $ Right (ms { msTrace = trace : msTrace ms })

churchTPERM :: MachineState -> Int -> [Permission] -> IO (Either Fault MachineState)
churchTPERM ms crTarget required = do
    let cr = Map.findWithDefault nullGT crTarget (msContextRegs ms)
    if gtName cr == "NULL"
        then return $ Left (NullFault "TPERM on NULL capability")
        else do
            let missing = filter (not . hasPermission cr) required
            if null missing
                then do
                    let trace = TraceTperm (gtName cr) (show required) "PASS"
                    return $ Right (ms { msTrace = trace : msTrace ms })
                else
                    return $ Left (PermFault ("TPERM FAIL on '" ++ gtName cr ++ "': missing " ++ show missing))

traceToString :: TraceEntry -> String
traceToString (TraceLoad name cr perms) =
    "  [LOAD]   CR" ++ show cr ++ " ← " ++ name ++ " " ++ perms
traceToString (TraceSave name cr slot) =
    "  [SAVE]   " ++ name ++ " CR" ++ show cr ++ " → slot " ++ slot
traceToString (TraceCall name perms) =
    "  [CALL]   → " ++ name ++ " " ++ perms
traceToString (TraceReturn name) =
    "  [RETURN] ← " ++ name
traceToString (TraceLambda name result) =
    "  [LAMBDA] " ++ name ++ ": " ++ result
traceToString (TraceTperm name perms result) =
    "  [TPERM]  " ++ name ++ " " ++ perms ++ " → " ++ result
traceToString (TraceFault f) =
    "  [FAULT]  " ++ show f

showTrace :: MachineState -> IO ()
showTrace ms = do
    let entries = reverse (msTrace ms)
    mapM_ (putStrLn . traceToString) entries
