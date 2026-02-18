module Church.Abstractions (
    buildChurchMachine,
    lambdaAbstraction,
    slideRuleAbstraction,
    buildNamespace
) where

import qualified Data.Map as Map
import Church.Types
import Church.Primitives
import Church.Machine

lambdaCList :: CList
lambdaCList = CList $ Map.fromList
    [ (0, mkGT "NULL"           [L]    0)
    , (1, mkGT "ACCESS"         [L, E] 1)
    , (2, mkGT "Y_COMBINATOR"   [L, X] 2)
    , (3, mkGT "SUCC"           [L, X] 3)
    , (4, mkGT "PRED"           [L, X] 4)
    , (5, mkGT "ADD"            [L, X] 5)
    , (6, mkGT "MUL"            [L, X] 6)
    , (7, mkGT "PAIR"           [L, X] 7)
    , (8, mkGT "FST"            [L, X] 8)
    , (9, mkGT "SND"            [L, X] 9)
    , (10, mkGT "TRUE"          [L, X] 10)
    , (11, mkGT "FALSE/ZERO"    [L, X] 11)
    , (12, mkGT "IS_ZERO"       [L, X] 12)
    , (13, mkGT "SUB"           [L, X] 13)
    , (14, mkGT "DIV"           [L, X] 14)
    , (15, mkGT "POW"           [L, X] 15)
    , (16, mkGT "IF"            [L, X] 16)
    , (17, mkGT "LEQ"           [L, X] 17)
    ]

lambdaDispatch :: Int -> MachineState -> IO MachineState
lambdaDispatch selector ms = do
    let a = Map.findWithDefault 0 1 (msDataRegs ms)
    let b = Map.findWithDefault 0 2 (msDataRegs ms)
    let (result, name, arity) = case selector of
            3  -> (churchSucc a, "SUCC", 1)
            4  -> (churchPred a, "PRED", 1)
            5  -> (churchAdd a b, "ADD", 2)
            6  -> (churchMul a b, "MUL", 2)
            13 -> (churchSub a b, "SUB", 2)
            14 -> (churchDiv a b, "DIV", 2)
            15 -> (churchPow a b, "POW", 2)
            12 -> (if churchIsZero a then 1 else 0, "IS_ZERO", 1)
            _  -> (0, "UNKNOWN", 0)
    let argStr = if arity == 1 then show a ++ " → " ++ show result
                 else show a ++ ", " ++ show b ++ " → " ++ show result
    let trace = TraceLambda name argStr
    let newDRs = Map.insert 0 result (msDataRegs ms)
    return ms { msDataRegs = newDRs, msTrace = trace : msTrace ms }

lambdaAbstraction :: Abstraction
lambdaAbstraction = Abstraction
    { absName = "Lambda"
    , absCList = lambdaCList
    , absMethod = lambdaDispatch
    }

slideRuleCList :: CList
slideRuleCList = CList $ Map.fromList
    [ (0, mkGT "NULL"     [L]    0)
    , (1, mkGT "ACCESS"   [L, E] 1)
    , (2, mkGT "SR_ADD"   [L, X] 2)
    , (3, mkGT "SR_SUB"   [L, X] 3)
    , (4, mkGT "SR_MUL"   [L, X] 4)
    , (5, mkGT "SR_DIV"   [L, X] 5)
    , (6, mkGT "SR_MOD"   [L, X] 6)
    , (7, mkGT "SR_LOG"   [L, X] 7)
    , (8, mkGT "SR_EXP"   [L, X] 8)
    , (9, mkGT "SR_SQRT"  [L, X] 9)
    , (10, mkGT "SR_POW"  [L, X] 10)
    ]

slideRuleDispatch :: Int -> MachineState -> IO MachineState
slideRuleDispatch selector ms = do
    let a = Map.findWithDefault 0 1 (msDataRegs ms)
    let b = Map.findWithDefault 0 2 (msDataRegs ms)
    let (result, name) = case selector of
            2  -> (churchAdd a b,  "ADD")
            3  -> (churchSub a b,  "SUB")
            4  -> (churchMul a b,  "MUL")
            5  -> (churchDiv a b,  "DIV")
            6  -> (churchMod a b,  "MOD")
            7  -> (churchLog a,    "LOG")
            8  -> (churchExp a b,  "EXP")
            9  -> (churchSqrt a,   "SQRT")
            10 -> (churchPow a b,  "POW")
            _  -> (0, "UNKNOWN")
    let trace = TraceLambda ("SlideRule." ++ name) (show a ++ ", " ++ show b ++ " → " ++ show result)
    let newDRs = Map.insert 0 result (msDataRegs ms)
    return ms { msDataRegs = newDRs, msTrace = trace : msTrace ms }

slideRuleAbstraction :: Abstraction
slideRuleAbstraction = Abstraction
    { absName = "SlideRule"
    , absCList = slideRuleCList
    , absMethod = slideRuleDispatch
    }

buildNamespace :: Namespace
buildNamespace = Namespace $ Map.fromList
    [ ("Lambda",       mkGT "Lambda"     [L, E] 1)
    , ("SlideRule",    mkGT "SlideRule"   [L, E] 2)
    ]

buildChurchMachine :: MachineState
buildChurchMachine = MachineState
    { msContextRegs  = Map.empty
    , msDataRegs     = Map.fromList [(i, 0) | i <- [0..15]]
    , msNamespace    = buildNamespace
    , msAbstractions = Map.fromList
        [ ("Lambda",    lambdaAbstraction)
        , ("SlideRule", slideRuleAbstraction)
        ]
    , msCallStack    = []
    , msTrace        = []
    }
