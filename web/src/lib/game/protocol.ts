/**
 * High-level protocol orchestration for mental poker
 *
 * This module handles the automatic progression through protocol phases
 * when it's our turn to act.
 */

import { get } from 'svelte/store';
import {
	game,
	gameState,
	playerState,
	playerList,
	isPlayerTurn,
	currentPhase,
	currentShufflingState,
	requiredAction,
	gameConfig
} from './store';
import { wallet } from '$lib/wallet/store';
import { GamePhase, ShufflingState, TexasHoldEmState, DrawingState } from './constants';

/**
 * Auto-execute the next required protocol action
 * Returns true if an action was executed, false otherwise
 */
export async function executeNextAction(): Promise<boolean> {
	const action = get(requiredAction);
	if (!action) return false;

	console.log('[protocol] Executing action:', action.action, action.description);

	switch (action.action) {
		case 'generate':
			return await game.generate();

		case 'mapDeck':
			return await game.mapDeck();

		case 'shuffle':
			return await game.shuffle();

		case 'lock':
			return await game.lock();

		case 'draw':
			return await game.draw();

		case 'reveal':
			if (action.cardIndex !== undefined) {
				return await game.reveal(action.cardIndex);
			}
			return false;

		case 'placeBlind':
			// Calculate blind amount based on position
			const config = get(gameConfig);
			const state = get(playerState);
			if (!config || !state) return false;

			const dealerIndex = config.dealerIndex;
			const myIndex = state.seatIndex;
			const playerCount = config.currentPlayers;

			// Small blind is first after dealer
			const sbIndex = (dealerIndex + 1) % playerCount;
			// Big blind is second after dealer (or same as SB in heads-up)
			const bbIndex = (dealerIndex + 2) % playerCount;

			let blindAmount: bigint;
			if (myIndex === sbIndex) {
				blindAmount = config.smallBlind;
			} else if (myIndex === bbIndex) {
				blindAmount = config.smallBlind * 2n;
			} else {
				return false;
			}

			return await game.placeBlind(blindAmount);

		default:
			console.log('[protocol] Unknown action:', action.action);
			return false;
	}
}

/**
 * Run the full shuffle protocol automatically
 * This handles Generate -> MapDeck -> Shuffle -> Lock for our turn
 */
export async function runShuffleProtocol(): Promise<boolean> {
	const phase = get(currentPhase);
	const shuffleState = get(currentShufflingState);

	console.log('[protocol] Running shuffle protocol, phase:', phase, 'shuffle state:', shuffleState);

	if (phase !== GamePhase.Shuffling) {
		console.log('[protocol] Not in shuffling phase');
		return false;
	}

	// Keep executing actions while we have something to do
	let executedAny = false;
	let actionExecuted = true;

	while (actionExecuted) {
		actionExecuted = await executeNextAction();
		if (actionExecuted) {
			executedAny = true;
			// Small delay between actions
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	return executedAny;
}

/**
 * Run the draw protocol for drawing hole cards
 * Each player draws 2 cards, and other players reveal after each draw
 */
export async function runDrawProtocol(): Promise<boolean> {
	const phase = get(currentPhase);

	console.log('[protocol] Running draw protocol, phase:', phase);

	if (phase !== GamePhase.Drawing) {
		console.log('[protocol] Not in drawing phase');
		return false;
	}

	// Keep executing actions while we have something to do
	let executedAny = false;
	let actionExecuted = true;

	while (actionExecuted) {
		actionExecuted = await executeNextAction();
		if (actionExecuted) {
			executedAny = true;
			// Small delay between actions
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	return executedAny;
}

/**
 * Run the blind posting protocol
 */
export async function runBlindProtocol(): Promise<boolean> {
	const state = get(gameState);
	if (!state) return false;

	// Check if we're in the blind posting state
	if (state.texasState !== TexasHoldEmState.Setup) {
		console.log('[protocol] Not in setup/blind posting state');
		return false;
	}

	const isOurTurn = get(isPlayerTurn);
	if (!isOurTurn) {
		console.log('[protocol] Not our turn to place blind');
		return false;
	}

	// Determine blind amount
	const config = get(gameConfig);
	const pState = get(playerState);
	if (!config || !pState) return false;

	const dealerIndex = config.dealerIndex;
	const myIndex = pState.seatIndex;
	const playerCount = config.currentPlayers;

	// Small blind is first after dealer
	const sbIndex = (dealerIndex + 1) % playerCount;

	let blindAmount: bigint;
	if (myIndex === sbIndex) {
		blindAmount = config.smallBlind;
		console.log('[protocol] Placing small blind:', blindAmount.toString());
	} else {
		blindAmount = config.smallBlind * 2n;
		console.log('[protocol] Placing big blind:', blindAmount.toString());
	}

	return await game.placeBlind(blindAmount);
}

/**
 * Check if we need to auto-execute any protocol action
 * This is called periodically to advance the game state
 */
export async function checkAndExecuteProtocol(): Promise<boolean> {
	const action = get(requiredAction);
	if (!action) return false;

	console.log('[protocol] Required action detected:', action);

	return await executeNextAction();
}

/**
 * Get human-readable description of current protocol state
 */
export function getProtocolStateDescription(): string {
	const phase = get(currentPhase);
	const shuffleState = get(currentShufflingState);
	const state = get(gameState);
	const isOurTurn = get(isPlayerTurn);

	if (!state) return 'Loading...';

	switch (phase) {
		case GamePhase.WaitingForPlayers:
			return 'Waiting for players to join';

		case GamePhase.Shuffling:
			switch (shuffleState) {
				case ShufflingState.NotStarted:
					return 'Preparing to shuffle';
				case ShufflingState.Committing:
					return 'Waiting for all players to commit';
				case ShufflingState.Generating:
					return isOurTurn ? 'Your turn: Submit shuffle seed' : 'Waiting for shuffle seed';
				case ShufflingState.Shuffling:
					if (!state.isDeckSubmitted) {
						return isOurTurn ? 'Your turn: Map initial deck' : 'Waiting for deck mapping';
					}
					return isOurTurn ? 'Your turn: Shuffle deck' : 'Waiting for shuffle';
				case ShufflingState.Locking:
					return isOurTurn ? 'Your turn: Lock cards' : 'Waiting for card locking';
				default:
					return 'Shuffling...';
			}

		case GamePhase.Drawing:
			const drawingState = state.drawingState;
			if (drawingState === 1) {
				// Picking
				return isOurTurn ? 'Your turn: Draw a card' : 'Waiting for draw';
			} else if (drawingState === 2) {
				// Revealing
				return isOurTurn ? 'Waiting for reveal' : 'Your turn: Reveal card';
			}
			return 'Drawing cards...';

		case GamePhase.Opening:
			return 'Showdown';

		case GamePhase.Finished:
			return 'Game finished';

		default:
			return 'Unknown state';
	}
}
