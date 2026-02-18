module Church.Types (
    Permission(..),
    Domain(..),
    GoldenToken(..),
    Namespace(..),
    CList(..),
    Abstraction(..),
    MachineState(..),
    Fault(..),
    TraceEntry(..),
    emptyNamespace,
    emptyState,
    mkGT,
    nullGT,
    isTuring,
    isChurch,
    domainOf
) where

import qualified Data.Map as Map

data Permission = R | W | X | L | S | E
    deriving (Show, Eq, Ord)

data Domain = Turing | ChurchDomain | NoDomain
    deriving (Show, Eq)

domainOf :: Permission -> Domain
domainOf R = Turing
domainOf W = Turing
domainOf X = Turing
domainOf L = ChurchDomain
domainOf S = ChurchDomain
domainOf E = ChurchDomain

isTuring :: [Permission] -> Bool
isTuring ps = any (\p -> domainOf p == Turing) ps

isChurch :: [Permission] -> Bool
isChurch ps = all (\p -> domainOf p == ChurchDomain) ps && not (null ps)

data GoldenToken = GToken {
    gtName    :: String,
    gtPerms   :: [Permission],
    gtIndex   :: Int,
    gtVersion :: Int,
    gtBound   :: Bool,
    gtFar     :: Bool
} deriving (Show, Eq)

nullGT :: GoldenToken
nullGT = GToken "NULL" [] 0 0 False False

mkGT :: String -> [Permission] -> Int -> GoldenToken
mkGT name perms idx = GToken name perms idx 1 False False

data Namespace = Namespace {
    nsEntries :: Map.Map String GoldenToken
} deriving (Show)

emptyNamespace :: Namespace
emptyNamespace = Namespace Map.empty

newtype CList = CList {
    clSlots :: Map.Map Int GoldenToken
} deriving (Show)

data Abstraction = Abstraction {
    absName   :: String,
    absCList  :: CList,
    absMethod :: Int -> MachineState -> IO MachineState
}

instance Show Abstraction where
    show a = "<Abstraction:" ++ absName a ++ ">"

data Fault = PermFault String
           | BindFault String
           | DomainFault String
           | VersionFault String
           | NullFault String
           | ScopeFault String
    deriving (Show)

data TraceEntry = TraceLoad String Int String
               | TraceSave String Int String
               | TraceCall String String
               | TraceReturn String
               | TraceLambda String String
               | TraceTperm String String String
               | TraceFault Fault
    deriving (Show)

data MachineState = MachineState {
    msContextRegs  :: Map.Map Int GoldenToken,
    msDataRegs     :: Map.Map Int Integer,
    msNamespace    :: Namespace,
    msAbstractions :: Map.Map String Abstraction,
    msCallStack    :: [(String, Map.Map Int GoldenToken)],
    msTrace        :: [TraceEntry]
}

emptyState :: MachineState
emptyState = MachineState
    Map.empty
    Map.empty
    emptyNamespace
    Map.empty
    []
    []
