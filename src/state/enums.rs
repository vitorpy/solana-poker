//! State machine enums matching the Solidity implementation
//!
//! Ported from TexasHoldEmTypes.sol

/// Major game phases for the mental poker protocol
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum GamePhase {
    #[default]
    WaitingForPlayers = 0,
    Shuffling = 1,
    Drawing = 2,
    Opening = 3,
    Finished = 4,
}

impl From<u8> for GamePhase {
    fn from(value: u8) -> Self {
        match value {
            0 => GamePhase::WaitingForPlayers,
            1 => GamePhase::Shuffling,
            2 => GamePhase::Drawing,
            3 => GamePhase::Opening,
            4 => GamePhase::Finished,
            _ => GamePhase::WaitingForPlayers,
        }
    }
}

/// Substate for the shuffling subprotocol
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum ShufflingState {
    #[default]
    NotStarted = 0,
    Committing = 1,
    Generating = 2,
    Shuffling = 3,
    Locking = 4,
}

impl From<u8> for ShufflingState {
    fn from(value: u8) -> Self {
        match value {
            0 => ShufflingState::NotStarted,
            1 => ShufflingState::Committing,
            2 => ShufflingState::Generating,
            3 => ShufflingState::Shuffling,
            4 => ShufflingState::Locking,
            _ => ShufflingState::NotStarted,
        }
    }
}

/// Substate for the drawing subprotocol
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum DrawingState {
    #[default]
    NotDrawn = 0,
    Picking = 1,
    Revealing = 2,
}

impl From<u8> for DrawingState {
    fn from(value: u8) -> Self {
        match value {
            0 => DrawingState::NotDrawn,
            1 => DrawingState::Picking,
            2 => DrawingState::Revealing,
            _ => DrawingState::NotDrawn,
        }
    }
}

/// Major Texas Hold'em game states
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum TexasHoldEmState {
    #[default]
    NotStarted = 0,
    Setup = 1,
    Drawing = 2,
    CommunityCardsAwaiting = 3,
    Betting = 4,
    Revealing = 5,
    SubmitBest = 6,
    ClaimPot = 7,
    StartNext = 8,
    Finished = 9,
}

impl From<u8> for TexasHoldEmState {
    fn from(value: u8) -> Self {
        match value {
            0 => TexasHoldEmState::NotStarted,
            1 => TexasHoldEmState::Setup,
            2 => TexasHoldEmState::Drawing,
            3 => TexasHoldEmState::CommunityCardsAwaiting,
            4 => TexasHoldEmState::Betting,
            5 => TexasHoldEmState::Revealing,
            6 => TexasHoldEmState::SubmitBest,
            7 => TexasHoldEmState::ClaimPot,
            8 => TexasHoldEmState::StartNext,
            9 => TexasHoldEmState::Finished,
            _ => TexasHoldEmState::NotStarted,
        }
    }
}

/// Major betting round states
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum BettingRoundState {
    #[default]
    Blinds = 0,
    PreFlop = 1,
    PostFlop = 2,
    PostTurn = 3,
    Showdown = 4,
}

impl From<u8> for BettingRoundState {
    fn from(value: u8) -> Self {
        match value {
            0 => BettingRoundState::Blinds,
            1 => BettingRoundState::PreFlop,
            2 => BettingRoundState::PostFlop,
            3 => BettingRoundState::PostTurn,
            4 => BettingRoundState::Showdown,
            _ => BettingRoundState::Blinds,
        }
    }
}

/// Community cards dealing state
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum CommunityCardsState {
    #[default]
    Opening = 0,
    FlopAwaiting = 1,
    TurnAwaiting = 2,
    RiverAwaiting = 3,
}

impl From<u8> for CommunityCardsState {
    fn from(value: u8) -> Self {
        match value {
            0 => CommunityCardsState::Opening,
            1 => CommunityCardsState::FlopAwaiting,
            2 => CommunityCardsState::TurnAwaiting,
            3 => CommunityCardsState::RiverAwaiting,
            _ => CommunityCardsState::Opening,
        }
    }
}
