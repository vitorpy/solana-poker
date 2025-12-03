//! Instruction processor

use pinocchio::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult, msg};

use crate::instructions::*;

/// Instruction discriminators
#[repr(u8)]
pub enum PokerInstruction {
    InitializeGame = 0,
    JoinGame = 1,
    Generate = 2,
    MapDeck = 3,
    Shuffle = 4,
    Lock = 5,
    Draw = 6,
    Reveal = 7,
    PlaceBlind = 8,
    Bet = 9,
    Fold = 10,
    DealCommunity = 11,
    OpenCommunityCard = 12,
    Open = 13,
    SubmitBestHand = 14,
    ClaimPot = 15,
    StartNextGame = 16,
    Leave = 17,
    Slash = 18,
    CloseGame = 19,
    ShufflePart1 = 20,
    ShufflePart2 = 21,
    LockPart1 = 22,
    LockPart2 = 23,
    TestCompression = 24,
    MapDeckPart1 = 25,
    MapDeckPart2 = 26,
}

impl TryFrom<u8> for PokerInstruction {
    type Error = ProgramError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(PokerInstruction::InitializeGame),
            1 => Ok(PokerInstruction::JoinGame),
            2 => Ok(PokerInstruction::Generate),
            3 => Ok(PokerInstruction::MapDeck),
            4 => Ok(PokerInstruction::Shuffle),
            5 => Ok(PokerInstruction::Lock),
            6 => Ok(PokerInstruction::Draw),
            7 => Ok(PokerInstruction::Reveal),
            8 => Ok(PokerInstruction::PlaceBlind),
            9 => Ok(PokerInstruction::Bet),
            10 => Ok(PokerInstruction::Fold),
            11 => Ok(PokerInstruction::DealCommunity),
            12 => Ok(PokerInstruction::OpenCommunityCard),
            13 => Ok(PokerInstruction::Open),
            14 => Ok(PokerInstruction::SubmitBestHand),
            15 => Ok(PokerInstruction::ClaimPot),
            16 => Ok(PokerInstruction::StartNextGame),
            17 => Ok(PokerInstruction::Leave),
            18 => Ok(PokerInstruction::Slash),
            19 => Ok(PokerInstruction::CloseGame),
            20 => Ok(PokerInstruction::ShufflePart1),
            21 => Ok(PokerInstruction::ShufflePart2),
            22 => Ok(PokerInstruction::LockPart1),
            23 => Ok(PokerInstruction::LockPart2),
            24 => Ok(PokerInstruction::TestCompression),
            25 => Ok(PokerInstruction::MapDeckPart1),
            26 => Ok(PokerInstruction::MapDeckPart2),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

/// Process an instruction
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let instruction = PokerInstruction::try_from(instruction_data[0])?;
    let data = &instruction_data[1..];

    match instruction {
        PokerInstruction::InitializeGame => {
            msg!("Instruction: InitializeGame");
            process_initialize_game(program_id, accounts, data)
        }
        PokerInstruction::JoinGame => {
            msg!("Instruction: JoinGame");
            process_join_game(program_id, accounts, data)
        }
        PokerInstruction::Generate => {
            msg!("Instruction: Generate");
            process_generate(program_id, accounts, data)
        }
        PokerInstruction::MapDeck => {
            msg!("Instruction: MapDeck");
            process_map_deck(program_id, accounts, data)
        }
        PokerInstruction::Shuffle => {
            msg!("Instruction: Shuffle");
            process_shuffle(program_id, accounts, data)
        }
        PokerInstruction::Lock => {
            msg!("Instruction: Lock");
            process_lock(program_id, accounts, data)
        }
        PokerInstruction::Draw => {
            msg!("Instruction: Draw");
            process_draw(program_id, accounts, data)
        }
        PokerInstruction::Reveal => {
            msg!("Instruction: Reveal");
            process_reveal(program_id, accounts, data)
        }
        PokerInstruction::PlaceBlind => {
            msg!("Instruction: PlaceBlind");
            process_place_blind(program_id, accounts, data)
        }
        PokerInstruction::Bet => {
            msg!("Instruction: Bet");
            process_bet(program_id, accounts, data)
        }
        PokerInstruction::Fold => {
            msg!("Instruction: Fold");
            process_fold(program_id, accounts, data)
        }
        PokerInstruction::DealCommunity => {
            msg!("Instruction: DealCommunity");
            process_deal_community(program_id, accounts, data)
        }
        PokerInstruction::OpenCommunityCard => {
            msg!("Instruction: OpenCommunityCard");
            process_open_community_card(program_id, accounts, data)
        }
        PokerInstruction::Open => {
            msg!("Instruction: Open");
            process_open(program_id, accounts, data)
        }
        PokerInstruction::SubmitBestHand => {
            msg!("Instruction: SubmitBestHand");
            process_submit_best_hand(program_id, accounts, data)
        }
        PokerInstruction::ClaimPot => {
            msg!("Instruction: ClaimPot");
            process_claim_pot(program_id, accounts, data)
        }
        PokerInstruction::StartNextGame => {
            msg!("Instruction: StartNextGame");
            process_start_next_game(program_id, accounts, data)
        }
        PokerInstruction::Leave => {
            msg!("Instruction: Leave");
            process_leave(program_id, accounts, data)
        }
        PokerInstruction::Slash => {
            msg!("Instruction: Slash");
            process_slash(program_id, accounts, data)
        }
        PokerInstruction::CloseGame => {
            msg!("Instruction: CloseGame");
            process_close_game(program_id, accounts, data)
        }
        PokerInstruction::ShufflePart1 => {
            msg!("Instruction: ShufflePart1");
            process_shuffle_part1(program_id, accounts, data)
        }
        PokerInstruction::ShufflePart2 => {
            msg!("Instruction: ShufflePart2");
            process_shuffle_part2(program_id, accounts, data)
        }
        PokerInstruction::LockPart1 => {
            msg!("Instruction: LockPart1");
            process_lock_part1(program_id, accounts, data)
        }
        PokerInstruction::LockPart2 => {
            msg!("Instruction: LockPart2");
            process_lock_part2(program_id, accounts, data)
        }
        PokerInstruction::TestCompression => {
            msg!("Instruction: TestCompression");
            process_test_compression(program_id, accounts, data)
        }
        PokerInstruction::MapDeckPart1 => {
            msg!("Instruction: MapDeckPart1");
            process_map_deck_part1(program_id, accounts, data)
        }
        PokerInstruction::MapDeckPart2 => {
            msg!("Instruction: MapDeckPart2");
            process_map_deck_part2(program_id, accounts, data)
        }
    }
}
