//! Hand ranking and comparison
//!
//! Ported from TexasHoldEmApi.sol

use super::hand_utils::HandEnum;

/// Compare two hands
/// Returns: 0 = tie, 1 = hand1 wins, 2 = hand2 wins
pub fn compare_hands(
    hand1: HandEnum,
    hand_cards1: &[i8],
    hand2: HandEnum,
    hand_cards2: &[i8],
) -> u8 {
    // Lower enum value = better hand (RoyalFlush=0 is best)
    if (hand1 as u8) > (hand2 as u8) {
        return 2; // hand2 wins
    } else if (hand1 as u8) < (hand2 as u8) {
        return 1; // hand1 wins
    }

    // Same hand type - compare card values
    let mut is_tie = true;
    let mut is_hand2_winner = false;

    for i in 0..5 {
        if i >= hand_cards1.len() || i >= hand_cards2.len() {
            break;
        }
        if !is_tie {
            continue;
        }

        is_tie = is_tie && hand_cards1[i] == hand_cards2[i];
        if !is_tie {
            is_hand2_winner = is_hand2_winner || hand_cards1[i] < hand_cards2[i];
        }
    }

    if is_tie {
        0
    } else if is_hand2_winner {
        2
    } else {
        1
    }
}

/// Rank a hand against other submitted hands
/// Updates the player's rank based on comparison with other hands
pub fn rank_hand(
    player_hand: HandEnum,
    player_cards: &[i8],
    other_hands: &[(HandEnum, Vec<i8>)],
) -> u8 {
    let mut rank = 0u8;

    for (other_hand, other_cards) in other_hands {
        let result = compare_hands(player_hand, player_cards, *other_hand, other_cards);
        if result == 2 {
            // This hand is better, increment its rank
            rank += 1;
        }
    }

    rank
}

/// Get the winners from a list of players with their ranks
/// Returns indices of players with the highest rank
pub fn get_winners(ranks: &[u8]) -> Vec<usize> {
    if ranks.is_empty() {
        return vec![];
    }

    let max_rank = *ranks.iter().max().unwrap_or(&0);
    ranks
        .iter()
        .enumerate()
        .filter(|(_, &r)| r == max_rank)
        .map(|(i, _)| i)
        .collect()
}

/// Calculate side pot distribution
/// Returns: sorted array of side pot step amounts
pub fn calculate_side_pot_diffs(mut bets: Vec<u64>) -> Vec<u64> {
    // Sort bets
    bets.sort();

    // Calculate differences
    let mut side_pot_size: u64 = 0;
    for bet in &mut bets {
        let original = *bet;
        *bet = original.saturating_sub(side_pot_size);
        side_pot_size += *bet;
    }

    bets
}

/// Sort array using bubble sort
pub fn sort_array(arr: &mut [u64]) {
    let n = arr.len();
    for i in 0..n {
        for j in (i + 1)..n {
            if arr[i] > arr[j] {
                arr.swap(i, j);
            }
        }
    }
}

/// Distribute chips equally among winners, handling remainders
pub fn distribute_chips(
    total_chips: u64,
    num_winners: usize,
    decimal_multiplier: u64,
) -> (u64, u64) {
    if num_winners == 0 {
        return (0, total_chips);
    }

    let chips_per_player = ((total_chips / decimal_multiplier) / (num_winners as u64)) * decimal_multiplier;
    let remainder = total_chips - (chips_per_player * num_winners as u64);

    (chips_per_player, remainder)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_hands_different_types() {
        let hand1 = HandEnum::Flush;
        let hand2 = HandEnum::Straight;
        let cards1 = [13, 12, 10, 8, 5];
        let cards2 = [9, 8, 7, 6, 5];

        let result = compare_hands(hand1, &cards1, hand2, &cards2);
        assert_eq!(result, 1); // Flush beats Straight
    }

    #[test]
    fn test_compare_hands_same_type_different_cards() {
        let hand1 = HandEnum::Pair;
        let hand2 = HandEnum::Pair;
        let cards1 = [13, 12, 10, 8, 0]; // Pair of Aces
        let cards2 = [12, 11, 10, 8, 0]; // Pair of Kings

        let result = compare_hands(hand1, &cards1, hand2, &cards2);
        assert_eq!(result, 1); // Aces beat Kings
    }

    #[test]
    fn test_compare_hands_tie() {
        let hand1 = HandEnum::HighCard;
        let hand2 = HandEnum::HighCard;
        let cards1 = [13, 12, 10, 8, 5];
        let cards2 = [13, 12, 10, 8, 5];

        let result = compare_hands(hand1, &cards1, hand2, &cards2);
        assert_eq!(result, 0); // Tie
    }

    #[test]
    fn test_side_pot_calculation() {
        let bets = vec![50, 100, 150];
        let diffs = calculate_side_pot_diffs(bets);
        assert_eq!(diffs, vec![50, 50, 50]);
    }

    #[test]
    fn test_distribute_chips() {
        let (per_player, remainder) = distribute_chips(100, 3, 1);
        assert_eq!(per_player, 33);
        assert_eq!(remainder, 1);
    }
}
