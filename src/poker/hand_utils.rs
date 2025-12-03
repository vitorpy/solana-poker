//! Hand evaluation utilities
//!
//! Ported from PokerHandUtils.sol
//!
//! Evaluates 5-card poker hands and returns the hand type and ranked cards for tiebreaking

use super::card::{get_card_name, get_card_order_value};

/// Poker hand types from best to worst
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum HandEnum {
    RoyalFlush = 0,
    StraightFlush = 1,
    FourOfAKind = 2,
    FullHouse = 3,
    Flush = 4,
    Straight = 5,
    ThreeOfAKind = 6,
    TwoPair = 7,
    Pair = 8,
    HighCard = 9,
}

impl From<u8> for HandEnum {
    fn from(value: u8) -> Self {
        match value {
            0 => HandEnum::RoyalFlush,
            1 => HandEnum::StraightFlush,
            2 => HandEnum::FourOfAKind,
            3 => HandEnum::FullHouse,
            4 => HandEnum::Flush,
            5 => HandEnum::Straight,
            6 => HandEnum::ThreeOfAKind,
            7 => HandEnum::TwoPair,
            8 => HandEnum::Pair,
            9 => HandEnum::HighCard,
            _ => HandEnum::HighCard,
        }
    }
}

/// Sort hand by card order value (descending)
pub fn sort_hand(cards: &mut [i8; 5]) {
    // Insertion sort (efficient for small arrays)
    for i in 1..5 {
        let key = cards[i];
        let mut j = i;
        while j > 0 && cards[j - 1] < key {
            cards[j] = cards[j - 1];
            j -= 1;
        }
        cards[j] = key;
    }
}

/// Evaluate a 5-card hand
///
/// Returns: (HandEnum, ranked cards for tiebreaking)
/// The ranked cards are ordered by importance for comparison
pub fn evaluate_hand(cards: [i8; 5]) -> (HandEnum, [i8; 5]) {
    let mut ret_order: [i8; 5] = [-1, -1, -1, -1, -1];
    let mut sort_cards: [i8; 5] = [0; 5];
    let mut hand_val = HandEnum::HighCard;

    let mut suits: [u8; 4] = [0; 4];
    let mut val_match: [u8; 13] = [0; 13];

    let mut pairs: [i8; 2] = [-1, -1];

    // Initial pass through cards
    for i in 0..5 {
        let (card_value, card_suit) = get_card_name(cards[i]);
        let test_value = card_value as u8;
        val_match[test_value as usize] += 1;
        sort_cards[i] = get_card_order_value(card_value);

        // Test for 4 of a kind
        if val_match[test_value as usize] == 4 && (hand_val as u8) > (HandEnum::FourOfAKind as u8) {
            hand_val = HandEnum::FourOfAKind;
            ret_order[0] = get_card_order_value(card_value);
        } else if val_match[test_value as usize] == 3
            && (hand_val as u8) > (HandEnum::ThreeOfAKind as u8)
        {
            hand_val = HandEnum::ThreeOfAKind;
            ret_order[0] = get_card_order_value(card_value);
        } else if val_match[test_value as usize] == 2 {
            // Handle pairs
            if pairs[0] == -1 {
                pairs[0] = get_card_order_value(card_value);
            } else {
                pairs[1] = get_card_order_value(card_value);
            }
        }

        suits[card_suit as usize] += 1;

        // Handle flush situations
        if suits[card_suit as usize] == 5 {
            sort_hand(&mut sort_cards);

            if sort_cards[0] - sort_cards[4] == 4 {
                if sort_cards[0] == 13 {
                    // Ace high = Royal Flush
                    hand_val = HandEnum::RoyalFlush;
                } else {
                    hand_val = HandEnum::StraightFlush;
                }
                return (hand_val, sort_cards);
            } else if sort_cards[0] == 13
                && sort_cards[1] == 4
                && sort_cards[1] - sort_cards[4] == 3
            {
                // Ace low straight flush (A-2-3-4-5)
                hand_val = HandEnum::StraightFlush;
                ret_order = [4, 3, 2, 1, 0];
                return (hand_val, ret_order);
            } else {
                // It's a flush
                hand_val = HandEnum::Flush;
                return (hand_val, sort_cards);
            }
        }
    }

    // Check 4oaK and 3oaK
    if hand_val == HandEnum::FourOfAKind {
        for i in 0..5 {
            if sort_cards[i] != ret_order[0] {
                ret_order[1] = sort_cards[i];
                return (hand_val, ret_order);
            }
        }
    } else if hand_val == HandEnum::ThreeOfAKind {
        // Check for full house
        if pairs[1] > -1 {
            hand_val = HandEnum::FullHouse;
            if pairs[0] == ret_order[0] {
                ret_order[1] = pairs[1];
            } else {
                ret_order[1] = pairs[0];
            }
            return (hand_val, ret_order);
        }

        // 3oaK - find the kickers
        for i in 0..5 {
            if sort_cards[i] != ret_order[0] {
                if sort_cards[i] > ret_order[1] {
                    ret_order[2] = ret_order[1];
                    ret_order[1] = sort_cards[i];
                } else {
                    ret_order[2] = sort_cards[i];
                }
            }
        }
        return (hand_val, ret_order);
    }

    // Check for straights if not 3 of a kind or pairs
    if (hand_val as u8) > (HandEnum::ThreeOfAKind as u8) {
        // No pair - could be a straight
        if pairs[0] == -1 {
            sort_hand(&mut sort_cards);

            if sort_cards[0] - sort_cards[4] == 4 {
                hand_val = HandEnum::Straight;
                return (hand_val, sort_cards);
            } else if sort_cards[0] == 13
                && sort_cards[1] == 4
                && sort_cards[1] - sort_cards[4] == 3
            {
                // Ace low straight
                hand_val = HandEnum::Straight;
                ret_order = [4, 3, 2, 1, 0];
                return (hand_val, ret_order);
            } else {
                // High card only
                hand_val = HandEnum::HighCard;
                return (hand_val, sort_cards);
            }
        } else {
            // Pair or two pair
            if pairs[1] != -1 {
                // Two pair
                hand_val = HandEnum::TwoPair;
                if pairs[0] > pairs[1] {
                    ret_order[0] = pairs[0];
                    ret_order[1] = pairs[1];
                } else {
                    ret_order[0] = pairs[1];
                    ret_order[1] = pairs[0];
                }

                // Find the final kicker
                for i in 0..5 {
                    if sort_cards[i] != pairs[0] && sort_cards[i] != pairs[1] {
                        ret_order[2] = sort_cards[i];
                    }
                }
                return (hand_val, ret_order);
            } else {
                // Just a pair
                sort_hand(&mut sort_cards);
                hand_val = HandEnum::Pair;
                ret_order[0] = pairs[0];

                let mut cnt = 1;
                for i in 0..5 {
                    if sort_cards[i] != pairs[0] {
                        ret_order[cnt] = sort_cards[i];
                        cnt += 1;
                    }
                }
                return (hand_val, ret_order);
            }
        }
    }

    (hand_val, ret_order)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_high_card() {
        // 2C, 5D, 7H, 9S, KC
        let cards = [1, 17, 32, 47, 12];
        let (hand, _ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::HighCard);
    }

    #[test]
    fn test_pair() {
        // AC, AD, 5H, 7S, KC
        let cards = [0, 13, 30, 45, 12];
        let (hand, ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::Pair);
        assert_eq!(ranked[0], 13); // Ace high
    }

    #[test]
    fn test_two_pair() {
        // AC, AD, KH, KS, 5C
        let cards = [0, 13, 38, 51, 4];
        let (hand, ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::TwoPair);
        assert_eq!(ranked[0], 13); // Aces
        assert_eq!(ranked[1], 12); // Kings
    }

    #[test]
    fn test_three_of_kind() {
        // AC, AD, AH, 7S, KC
        let cards = [0, 13, 26, 45, 12];
        let (hand, ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::ThreeOfAKind);
        assert_eq!(ranked[0], 13); // Aces
    }

    #[test]
    fn test_straight() {
        // 5C, 6D, 7H, 8S, 9C
        let cards = [4, 18, 32, 46, 8];
        let (hand, _ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::Straight);
    }

    #[test]
    fn test_flush() {
        // 2C, 5C, 7C, 9C, KC
        let cards = [1, 4, 6, 8, 12];
        let (hand, _ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::Flush);
    }

    #[test]
    fn test_full_house() {
        // AC, AD, AH, KS, KC
        let cards = [0, 13, 26, 51, 12];
        let (hand, ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::FullHouse);
        assert_eq!(ranked[0], 13); // Aces (trips)
        assert_eq!(ranked[1], 12); // Kings (pair)
    }

    #[test]
    fn test_four_of_kind() {
        // AC, AD, AH, AS, KC
        let cards = [0, 13, 26, 39, 12];
        let (hand, ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::FourOfAKind);
        assert_eq!(ranked[0], 13); // Aces
    }

    #[test]
    fn test_straight_flush() {
        // 5C, 6C, 7C, 8C, 9C
        let cards = [4, 5, 6, 7, 8];
        let (hand, _ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::StraightFlush);
    }

    #[test]
    fn test_royal_flush() {
        // TC, JC, QC, KC, AC
        let cards = [9, 10, 11, 12, 0];
        let (hand, _ranked) = evaluate_hand(cards);
        assert_eq!(hand, HandEnum::RoyalFlush);
    }
}
