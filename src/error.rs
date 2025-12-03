//! Custom error types for the Mental Poker program

use pinocchio::program_error::ProgramError;

/// Custom errors for the poker program
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u32)]
pub enum PokerError {
    // State errors (100-199)
    /// Invalid game state for this operation
    InvalidState = 100,
    /// Invalid shuffling state
    InvalidShufflingState = 101,
    /// Invalid drawing state
    InvalidDrawingState = 102,
    /// Invalid betting state
    InvalidBettingState = 103,
    /// Invalid Texas Hold'em state
    InvalidTexasState = 104,
    /// Invalid community cards state
    InvalidCommunityCardsState = 105,

    // Authorization errors (200-299)
    /// Unauthorized action
    Unauthorized = 200,
    /// Not your turn
    NotYourTurn = 201,
    /// Not a player in this game
    NotAPlayer = 202,
    /// Already a player in this game
    AlreadyPlayer = 203,
    /// Invalid signer
    InvalidSigner = 204,
    /// Invalid owner
    InvalidOwner = 205,

    // Game logic errors (300-399)
    /// Game is full
    GameFull = 300,
    /// Insufficient chips
    InsufficientChips = 301,
    /// Invalid bet amount
    InvalidBetAmount = 302,
    /// Player already folded
    AlreadyFolded = 303,
    /// Deck not yet submitted
    DeckNotSubmitted = 304,
    /// Card already revealed
    CardAlreadyRevealed = 305,
    /// Invalid commitment hash
    InvalidCommitment = 306,
    /// Cannot draw more cards
    CannotDrawMoreCards = 307,
    /// Invalid vector size
    InvalidVectorSize = 308,
    /// No cards left in deck
    NoCardsLeft = 309,
    /// Invalid card index
    InvalidCardIndex = 310,
    /// Player already revealed this card
    PlayerAlreadyRevealed = 311,
    /// Cannot open this card (not owner)
    NotCardOwner = 312,
    /// Invalid small blind amount
    InvalidSmallBlind = 313,
    /// Invalid big blind amount
    InvalidBigBlind = 314,
    /// Deck already submitted
    DeckAlreadySubmitted = 315,
    /// Game already initialized
    AlreadyInitialized = 316,
    /// Min buy-in too low
    MinBuyInTooLow = 317,
    /// Slash timeout not met
    SlashTimeoutNotMet = 318,
    /// Game already finishing
    GameAlreadyFinishing = 319,
    /// Game hasn't started
    GameHasntStarted = 320,
    /// Cannot open community card
    NotCommunityCard = 321,
    /// Invalid number of players
    InvalidNumPlayers = 322,

    // Crypto errors (400-499)
    /// Invalid elliptic curve point
    InvalidPoint = 400,
    /// Invalid scalar value
    InvalidScalar = 401,
    /// Elliptic curve operation failed
    ECOperationFailed = 402,

    // Hand errors (500-599)
    /// Invalid hand submitted
    InvalidHand = 500,
    /// Duplicate cards in hand
    DuplicateCards = 501,
    /// Illegal card (not from player's cards or community cards)
    IllegalCard = 502,

    // Account errors (600-699)
    /// Invalid PDA
    InvalidPDA = 600,
    /// Account not initialized
    AccountNotInitialized = 601,
    /// Account already initialized
    AccountAlreadyInitialized = 602,
    /// Invalid account data
    InvalidAccountData = 603,
    /// Insufficient funds for rent
    InsufficientRent = 604,

    // Resolution errors (700-799)
    /// Pot has already been claimed
    PotAlreadyClaimed = 700,
    /// Pot has not been claimed yet
    PotNotClaimed = 701,
    /// No winner could be determined
    NoWinner = 702,
    /// Cannot leave the game at this time
    CannotLeaveNow = 703,
    /// Timeout not yet reached for slash
    TimeoutNotReached = 704,
    /// Invalid game phase for this operation
    InvalidGamePhase = 705,
    /// Game is not finished yet
    GameNotFinished = 706,
    /// Invalid authority for this operation
    InvalidAuthority = 707,
    /// Invalid game ID
    InvalidGameId = 708,

    // Split transaction errors (800-899)
    /// Part1 must be submitted before Part2
    Part1NotSubmitted = 800,
    /// Part1 already submitted, send Part2
    Part1AlreadySubmitted = 801,
    /// EC point decompression failed
    DecompressionFailed = 802,
}

impl From<PokerError> for ProgramError {
    fn from(e: PokerError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
