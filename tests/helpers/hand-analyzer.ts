/**
 * Hand evaluation and analysis for Solana Poker tests
 *
 * Ported from moonpoker-contracts/test/helpers/handAnalyzer.js
 * Hand evaluation logic matches src/poker/hand_utils.rs
 */

import { PointTuple, transformTupleToPoint, areCardsEqual, getCardName } from './crypto';

// Card suits: Clubs=0, Diamonds=1, Hearts=2, Spades=3
const CARD_SUITS = ['C', 'D', 'H', 'S'];

// Card values: A=0, 2=1, 3=2, ..., T=9, J=10, Q=11, K=12
// For hand notation: A, 2, 3, 4, 5, 6, 7, 8, 9, T, J, Q, K
const CARD_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

// Hand enum matching Rust HandEnum (lower = better)
export enum HandEnum {
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

/**
 * Get card order value (Ace = 13, King = 12, ..., 2 = 1)
 */
export function getCardOrderValue(cardValue: number): number {
  // Ace is highest (13)
  if (cardValue === 0) return 13;
  return cardValue;
}

/**
 * Get card name and suit from card index (0-51)
 * Returns [value (0-12), suit (0-3)]
 */
export function getCardValueAndSuit(cardIndex: number): [number, number] {
  const suit = Math.floor(cardIndex / 13);
  const value = cardIndex % 13;
  return [value, suit];
}

/**
 * Convert card index to notation (e.g., "KS" for King of Spades)
 */
export function cardToNotation(cardIndex: number): string {
  const [value, suit] = getCardValueAndSuit(cardIndex);
  return `${CARD_VALUES[value]}${CARD_SUITS[suit]}`;
}

/**
 * Sort hand by card order value (descending)
 */
function sortHand(cards: number[]): number[] {
  return [...cards].sort((a, b) => {
    const orderA = getCardOrderValue(a % 13);
    const orderB = getCardOrderValue(b % 13);
    return orderB - orderA;
  });
}

/**
 * Evaluate a 5-card hand
 * Returns [HandEnum, ranked cards for tiebreaking]
 * Matches src/poker/hand_utils.rs evaluate_hand
 */
export function evaluateHand(cards: number[]): [HandEnum, number[]] {
  if (cards.length !== 5) {
    throw new Error('Hand must have exactly 5 cards');
  }

  let retOrder: number[] = [-1, -1, -1, -1, -1];
  let sortCards: number[] = [];
  let handVal = HandEnum.HighCard;

  const suits: number[] = [0, 0, 0, 0];
  const valMatch: number[] = new Array(13).fill(0);
  const pairs: number[] = [-1, -1];

  // Initial pass through cards
  for (let i = 0; i < 5; i++) {
    const [cardValue, cardSuit] = getCardValueAndSuit(cards[i]);
    valMatch[cardValue]++;
    sortCards.push(getCardOrderValue(cardValue));

    // Test for 4 of a kind
    if (valMatch[cardValue] === 4 && handVal > HandEnum.FourOfAKind) {
      handVal = HandEnum.FourOfAKind;
      retOrder[0] = getCardOrderValue(cardValue);
    } else if (valMatch[cardValue] === 3 && handVal > HandEnum.ThreeOfAKind) {
      handVal = HandEnum.ThreeOfAKind;
      retOrder[0] = getCardOrderValue(cardValue);
    } else if (valMatch[cardValue] === 2) {
      // Handle pairs
      if (pairs[0] === -1) {
        pairs[0] = getCardOrderValue(cardValue);
      } else {
        pairs[1] = getCardOrderValue(cardValue);
      }
    }

    suits[cardSuit]++;

    // Handle flush situations
    if (suits[cardSuit] === 5) {
      sortCards.sort((a, b) => b - a);

      if (sortCards[0] - sortCards[4] === 4) {
        if (sortCards[0] === 13) {
          // Ace high = Royal Flush
          handVal = HandEnum.RoyalFlush;
        } else {
          handVal = HandEnum.StraightFlush;
        }
        return [handVal, sortCards];
      } else if (
        sortCards[0] === 13 &&
        sortCards[1] === 4 &&
        sortCards[1] - sortCards[4] === 3
      ) {
        // Ace low straight flush (A-2-3-4-5)
        handVal = HandEnum.StraightFlush;
        retOrder = [4, 3, 2, 1, 0];
        return [handVal, retOrder];
      } else {
        // It's a flush
        handVal = HandEnum.Flush;
        return [handVal, sortCards];
      }
    }
  }

  // Check 4oaK and 3oaK
  if (handVal === HandEnum.FourOfAKind) {
    for (let i = 0; i < 5; i++) {
      if (sortCards[i] !== retOrder[0]) {
        retOrder[1] = sortCards[i];
        return [handVal, retOrder];
      }
    }
  } else if (handVal === HandEnum.ThreeOfAKind) {
    // Check for full house
    if (pairs[1] > -1) {
      handVal = HandEnum.FullHouse;
      if (pairs[0] === retOrder[0]) {
        retOrder[1] = pairs[1];
      } else {
        retOrder[1] = pairs[0];
      }
      return [handVal, retOrder];
    }

    // 3oaK - find the kickers
    for (let i = 0; i < 5; i++) {
      if (sortCards[i] !== retOrder[0]) {
        if (sortCards[i] > retOrder[1]) {
          retOrder[2] = retOrder[1];
          retOrder[1] = sortCards[i];
        } else {
          retOrder[2] = sortCards[i];
        }
      }
    }
    return [handVal, retOrder];
  }

  // Check for straights if not 3 of a kind or pairs
  if (handVal > HandEnum.ThreeOfAKind) {
    // No pair - could be a straight
    if (pairs[0] === -1) {
      sortCards.sort((a, b) => b - a);

      if (sortCards[0] - sortCards[4] === 4) {
        handVal = HandEnum.Straight;
        return [handVal, sortCards];
      } else if (
        sortCards[0] === 13 &&
        sortCards[1] === 4 &&
        sortCards[1] - sortCards[4] === 3
      ) {
        // Ace low straight
        handVal = HandEnum.Straight;
        retOrder = [4, 3, 2, 1, 0];
        return [handVal, retOrder];
      } else {
        // High card only
        handVal = HandEnum.HighCard;
        return [handVal, sortCards];
      }
    } else {
      // Pair or two pair
      if (pairs[1] !== -1) {
        // Two pair
        handVal = HandEnum.TwoPair;
        if (pairs[0] > pairs[1]) {
          retOrder[0] = pairs[0];
          retOrder[1] = pairs[1];
        } else {
          retOrder[0] = pairs[1];
          retOrder[1] = pairs[0];
        }

        // Find the final kicker
        for (let i = 0; i < 5; i++) {
          if (sortCards[i] !== pairs[0] && sortCards[i] !== pairs[1]) {
            retOrder[2] = sortCards[i];
          }
        }
        return [handVal, retOrder];
      } else {
        // Just a pair
        sortCards.sort((a, b) => b - a);
        handVal = HandEnum.Pair;
        retOrder[0] = pairs[0];

        let cnt = 1;
        for (let i = 0; i < 5; i++) {
          if (sortCards[i] !== pairs[0]) {
            retOrder[cnt] = sortCards[i];
            cnt++;
          }
        }
        return [handVal, retOrder];
      }
    }
  }

  return [handVal, retOrder];
}

/**
 * Score a poker hand (lower score = better hand)
 * Used for selecting best hand from 7 cards
 */
export function scorePokerHand(cards: number[]): { hand: HandEnum; score: number; ranked: number[] } {
  const [hand, ranked] = evaluateHand(cards);

  // Create a comparable score (lower = better)
  // Hand type is most significant, then ranked cards
  let score = hand * 10000000;
  for (let i = 0; i < ranked.length && i < 5; i++) {
    score += ranked[i] * Math.pow(100, 4 - i);
  }

  // Invert score since we want lower to be better but our ranking is reversed
  score = 10000000000 - score;

  return { hand, score, ranked };
}

/**
 * Get hand name string
 */
export function getHandName(hand: HandEnum): string {
  const names = [
    'Royal Flush',
    'Straight Flush',
    'Four of a Kind',
    'Full House',
    'Flush',
    'Straight',
    'Three of a Kind',
    'Two Pair',
    'Pair',
    'High Card',
  ];
  return names[hand] || 'Unknown';
}

/**
 * Select the best 5-card hand from 7 cards (2 hole + 5 community)
 * Returns the indices of the 5 best cards
 */
export function selectBestHand(ownedCards: number[], communityCards: number[]): number[] {
  const allCards = [...ownedCards, ...communityCards];

  if (allCards.length < 5) {
    throw new Error('Need at least 5 cards to select best hand');
  }

  let bestHand: number[] = [];
  let bestScore = -1;
  let bestHandEnum = HandEnum.HighCard;

  // Generate all 5-card combinations from the available cards
  for (let c0 = 0; c0 < allCards.length; c0++) {
    for (let c1 = c0 + 1; c1 < allCards.length; c1++) {
      for (let c2 = c1 + 1; c2 < allCards.length; c2++) {
        for (let c3 = c2 + 1; c3 < allCards.length; c3++) {
          for (let c4 = c3 + 1; c4 < allCards.length; c4++) {
            const currentHand = [
              allCards[c0],
              allCards[c1],
              allCards[c2],
              allCards[c3],
              allCards[c4],
            ];

            const { hand, score } = scorePokerHand(currentHand);

            if (bestHand.length === 0 || score > bestScore) {
              bestHand = currentHand;
              bestScore = score;
              bestHandEnum = hand;
            }
          }
        }
      }
    }
  }

  console.log(
    `BEST HAND: ${bestHand.map(c => getCardName(c)).join(' ')}, ` +
    `HAND: ${getHandName(bestHandEnum)}`
  );

  return bestHand;
}

/**
 * Convert card EC points to card indices using accumulator mapping
 */
export async function getCards(
  cardPoints: any[],
  accumulatorDeckQx: Uint8Array[],
  accumulatorDeckQy: Uint8Array[]
): Promise<number[]> {
  const cards: number[] = [];

  for (const cardPoint of cardPoints) {
    // Get the point's x and y coordinates
    const qx = cardPoint.getX ? cardPoint.getX().toArrayLike(Buffer, 'be', 32) : cardPoint.x;
    const qy = cardPoint.getY ? cardPoint.getY().toArrayLike(Buffer, 'be', 32) : cardPoint.y;

    // Find matching card in accumulator deck
    let found = false;
    for (let i = 0; i < 52; i++) {
      const deckQx = accumulatorDeckQx[i];
      const deckQy = accumulatorDeckQy[i];

      if (
        Buffer.compare(qx, deckQx) === 0 &&
        Buffer.compare(qy, deckQy) === 0
      ) {
        cards.push(i);
        found = true;
        break;
      }
    }

    if (!found) {
      throw new Error('Card point not found in accumulator deck');
    }
  }

  return cards;
}

/**
 * Convert card indices back to EC points
 */
export function convertHandToPoints(
  hand: number[],
  ownedCards: number[],
  ownedCardsPoints: any[],
  communityCards: number[],
  communityCardsPoints: any[]
): any[] {
  const handPoints: any[] = [];

  for (const card of hand) {
    // Check owned cards
    const ownedIdx = ownedCards.indexOf(card);
    if (ownedIdx >= 0) {
      handPoints.push(ownedCardsPoints[ownedIdx]);
      continue;
    }

    // Check community cards
    const commIdx = communityCards.indexOf(card);
    if (commIdx >= 0) {
      handPoints.push(communityCardsPoints[commIdx]);
      continue;
    }

    throw new Error(`Card ${card} not found in owned or community cards`);
  }

  return handPoints;
}

/**
 * Select best hand from EC points and return the 5 best EC points
 * Main function for test use
 */
export async function selectBestHandPoints(
  ownedCardsPoints: any[],
  communityCardsPoints: any[],
  accumulatorDeckQx: Uint8Array[],
  accumulatorDeckQy: Uint8Array[]
): Promise<any[]> {
  // Convert points to card indices
  const ownedCards = await getCards(ownedCardsPoints, accumulatorDeckQx, accumulatorDeckQy);
  const communityCards = await getCards(communityCardsPoints, accumulatorDeckQx, accumulatorDeckQy);

  // Select best 5 cards
  const bestHand = selectBestHand(ownedCards, communityCards);

  // Convert back to EC points
  const bestHandPoints = convertHandToPoints(
    bestHand,
    ownedCards,
    ownedCardsPoints,
    communityCards,
    communityCardsPoints
  );

  return bestHandPoints;
}

/**
 * Compare two hands
 * Returns: 0 = tie, 1 = hand1 wins, 2 = hand2 wins
 */
export function compareHands(
  hand1: HandEnum,
  handCards1: number[],
  hand2: HandEnum,
  handCards2: number[]
): number {
  // Lower enum value = better hand
  if (hand1 > hand2) {
    return 2; // hand2 wins
  } else if (hand1 < hand2) {
    return 1; // hand1 wins
  }

  // Same hand type - compare card values
  for (let i = 0; i < 5; i++) {
    if (i >= handCards1.length || i >= handCards2.length) {
      break;
    }
    if (handCards1[i] > handCards2[i]) {
      return 1; // hand1 wins
    } else if (handCards1[i] < handCards2[i]) {
      return 2; // hand2 wins
    }
  }

  return 0; // Tie
}

// Re-export crypto helpers for convenience
export { getCardName } from './crypto';
