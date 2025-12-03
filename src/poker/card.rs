//! Card representations
//!
//! Ported from PokerHandUtils.sol

/// Card ID enum (0-51)
/// Ace = 0, Two = 1, ... King = 12 for each suit
/// Suits: Clubs (0-12), Diamonds (13-25), Hearts (26-38), Spades (39-51)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CardId {
    // Clubs (0-12)
    AceClubs = 0,
    TwoClubs = 1,
    ThreeClubs = 2,
    FourClubs = 3,
    FiveClubs = 4,
    SixClubs = 5,
    SevenClubs = 6,
    EightClubs = 7,
    NineClubs = 8,
    TenClubs = 9,
    JackClubs = 10,
    QueenClubs = 11,
    KingClubs = 12,
    // Diamonds (13-25)
    AceDiamonds = 13,
    TwoDiamonds = 14,
    ThreeDiamonds = 15,
    FourDiamonds = 16,
    FiveDiamonds = 17,
    SixDiamonds = 18,
    SevenDiamonds = 19,
    EightDiamonds = 20,
    NineDiamonds = 21,
    TenDiamonds = 22,
    JackDiamonds = 23,
    QueenDiamonds = 24,
    KingDiamonds = 25,
    // Hearts (26-38)
    AceHearts = 26,
    TwoHearts = 27,
    ThreeHearts = 28,
    FourHearts = 29,
    FiveHearts = 30,
    SixHearts = 31,
    SevenHearts = 32,
    EightHearts = 33,
    NineHearts = 34,
    TenHearts = 35,
    JackHearts = 36,
    QueenHearts = 37,
    KingHearts = 38,
    // Spades (39-51)
    AceSpades = 39,
    TwoSpades = 40,
    ThreeSpades = 41,
    FourSpades = 42,
    FiveSpades = 43,
    SixSpades = 44,
    SevenSpades = 45,
    EightSpades = 46,
    NineSpades = 47,
    TenSpades = 48,
    JackSpades = 49,
    QueenSpades = 50,
    KingSpades = 51,
}

impl From<u8> for CardId {
    fn from(value: u8) -> Self {
        if value < 52 {
            unsafe { core::mem::transmute(value) }
        } else {
            CardId::AceClubs // Default
        }
    }
}

impl From<i8> for CardId {
    fn from(value: i8) -> Self {
        if value >= 0 && value < 52 {
            unsafe { core::mem::transmute(value as u8) }
        } else {
            CardId::AceClubs // Default
        }
    }
}

/// Card value (rank)
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum CardValue {
    Ace = 0,
    Two = 1,
    Three = 2,
    Four = 3,
    Five = 4,
    Six = 5,
    Seven = 6,
    Eight = 7,
    Nine = 8,
    Ten = 9,
    Jack = 10,
    Queen = 11,
    King = 12,
    AceHigh = 13, // For straights where Ace is high
}

impl From<u8> for CardValue {
    fn from(value: u8) -> Self {
        match value {
            0 => CardValue::Ace,
            1 => CardValue::Two,
            2 => CardValue::Three,
            3 => CardValue::Four,
            4 => CardValue::Five,
            5 => CardValue::Six,
            6 => CardValue::Seven,
            7 => CardValue::Eight,
            8 => CardValue::Nine,
            9 => CardValue::Ten,
            10 => CardValue::Jack,
            11 => CardValue::Queen,
            12 => CardValue::King,
            13 => CardValue::AceHigh,
            _ => CardValue::Ace,
        }
    }
}

/// Card suit
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum CardSuit {
    Clubs = 0,
    Diamonds = 1,
    Hearts = 2,
    Spades = 3,
}

impl From<u8> for CardSuit {
    fn from(value: u8) -> Self {
        match value {
            0 => CardSuit::Clubs,
            1 => CardSuit::Diamonds,
            2 => CardSuit::Hearts,
            3 => CardSuit::Spades,
            _ => CardSuit::Clubs,
        }
    }
}

/// Get the value and suit from a card code (0-51)
pub fn get_card_name(code: i8) -> (CardValue, CardSuit) {
    if code < 0 || code >= 52 {
        return (CardValue::Ace, CardSuit::Clubs);
    }
    let value = CardValue::from((code % 13) as u8);
    let suit = CardSuit::from((code / 13) as u8);
    (value, suit)
}

/// Get card code from value and suit
pub fn get_card_code(value: CardValue, suit: CardSuit) -> i8 {
    (suit as i8) * 13 + (value as i8)
}

/// Get the order value for a card (Ace high = 13)
/// Used for ranking hands
pub fn get_card_order_value(value: CardValue) -> i8 {
    if value == CardValue::Ace {
        CardValue::AceHigh as i8
    } else {
        value as i8
    }
}

/// Check if a card code is valid
pub fn is_valid_card(code: i8) -> bool {
    code >= 0 && code < 52
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_card_name() {
        let (value, suit) = get_card_name(0);
        assert_eq!(value, CardValue::Ace);
        assert_eq!(suit, CardSuit::Clubs);

        let (value, suit) = get_card_name(12);
        assert_eq!(value, CardValue::King);
        assert_eq!(suit, CardSuit::Clubs);

        let (value, suit) = get_card_name(13);
        assert_eq!(value, CardValue::Ace);
        assert_eq!(suit, CardSuit::Diamonds);

        let (value, suit) = get_card_name(51);
        assert_eq!(value, CardValue::King);
        assert_eq!(suit, CardSuit::Spades);
    }

    #[test]
    fn test_card_order_value() {
        assert_eq!(get_card_order_value(CardValue::Ace), 13);
        assert_eq!(get_card_order_value(CardValue::Two), 1);
        assert_eq!(get_card_order_value(CardValue::King), 12);
    }
}
