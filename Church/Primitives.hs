module Church.Primitives (
    churchSucc,
    churchPred,
    churchAdd,
    churchMul,
    churchPow,
    churchSub,
    churchDiv,
    churchMod,
    churchIsZero,
    churchLeq,
    churchSqrt,
    churchLog,
    churchExp,
    churchAbs
) where

churchSucc :: Integer -> Integer
churchSucc n = n + 1

churchPred :: Integer -> Integer
churchPred n = max 0 (n - 1)

churchAdd :: Integer -> Integer -> Integer
churchAdd a b = a + b

churchMul :: Integer -> Integer -> Integer
churchMul a b = a * b

churchSub :: Integer -> Integer -> Integer
churchSub a b = max 0 (a - b)

churchPow :: Integer -> Integer -> Integer
churchPow _ 0 = 1
churchPow b e = b * churchPow b (e - 1)

churchIsZero :: Integer -> Bool
churchIsZero 0 = True
churchIsZero _ = False

churchLeq :: Integer -> Integer -> Bool
churchLeq a b = a <= b

churchDiv :: Integer -> Integer -> Integer
churchDiv _ 0 = 0
churchDiv a b = go a 0
    where go remaining count
            | remaining < b = count
            | otherwise     = go (remaining - b) (count + 1)

churchMod :: Integer -> Integer -> Integer
churchMod a b = churchSub a (churchMul b (churchDiv a b))

churchSqrt :: Integer -> Integer
churchSqrt 0 = 0
churchSqrt n = go 1
    where go guess
            | guess * guess > n  = guess - 1
            | guess * guess == n = guess
            | otherwise          = go (guess + 1)

churchLog :: Integer -> Integer
churchLog n
    | n <= 1    = 0
    | otherwise = 1 + churchLog (churchDiv n 10)

churchExp :: Integer -> Integer -> Integer
churchExp = churchPow

churchAbs :: Integer -> Integer
churchAbs n = if n < 0 then negate n else n
