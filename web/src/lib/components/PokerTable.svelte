<script lang="ts">
	import Card from './Card.svelte';
	import { LAMPORTS_PER_SOL } from '@solana/web3.js';
	import {
		game,
		isLoading,
		isPlayerTurn,
		canCheck,
		canCall,
		amountToCall,
		isFolded,
		playerChips as playerChipsStore,
		pot as potStore,
		playerCurrentBet,
		playerState
	} from '$lib/game/store';

	interface Props {
		communityCards?: number[];
		holeCards?: number[];
		pot?: number;
		currentBet?: number;
		playerChips?: number;
	}

	let {
		communityCards = [],
		holeCards = [],
		pot = 0,
		currentBet = 0,
		playerChips = 1000
	}: Props = $props();

	let betAmountSol = $state(0.01);

	// Convert bet amount to lamports
	const betAmount = $derived(BigInt(Math.floor(betAmountSol * LAMPORTS_PER_SOL)));

	// Calculate call amount in SOL for display
	const callAmountSol = $derived(Number($amountToCall) / LAMPORTS_PER_SOL);

	// Check if actions are disabled
	const actionsDisabled = $derived($isLoading || !$isPlayerTurn || $isFolded);

	async function handleFold() {
		await game.fold();
	}

	async function handleCheck() {
		await game.check();
	}

	async function handleCall() {
		await game.call();
	}

	async function handleBet() {
		await game.bet(betAmount);
	}

	async function handleRaise() {
		// For raise, we need to bet enough to exceed current call amount
		await game.bet(betAmount);
	}
</script>

<div class="poker-table">
	<!-- Felt background -->
	<div class="felt">
		<!-- Community cards area -->
		<div class="community-area">
			<div class="community-label">Community Cards</div>
			<div class="community-cards">
				{#each [0, 1, 2, 3, 4] as i}
					{#if communityCards[i]}
						<Card cardIndex={communityCards[i]} />
					{:else}
						<div class="card-placeholder"></div>
					{/if}
				{/each}
			</div>
		</div>

		<!-- Pot display -->
		<div class="pot-display">
			<div class="pot-label">Pot</div>
			<div class="pot-amount">{pot} chips</div>
		</div>

		<!-- Player's hole cards -->
		<div class="hole-cards-area">
			<div class="hole-label">Your Cards</div>
			<div class="hole-cards">
				{#if holeCards.length >= 2}
					<Card cardIndex={holeCards[0]} />
					<Card cardIndex={holeCards[1]} />
				{:else}
					<Card faceDown={true} backStyle={3} />
					<Card faceDown={true} backStyle={3} />
				{/if}
			</div>
		</div>
	</div>

	<!-- Controls -->
	<div class="controls">
		<div class="player-info">
			<span class="chips-label">Your Chips:</span>
			<span class="chips-amount">{playerChips}</span>
			{#if !$isPlayerTurn}
				<span class="turn-indicator waiting">Waiting...</span>
			{:else}
				<span class="turn-indicator your-turn">Your Turn</span>
			{/if}
		</div>

		<div class="action-buttons">
			<button
				class="win95-button action-btn fold"
				onclick={handleFold}
				disabled={actionsDisabled}
			>
				{$isLoading ? '...' : 'Fold'}
			</button>
			{#if $canCheck}
				<button
					class="win95-button action-btn check"
					onclick={handleCheck}
					disabled={actionsDisabled}
				>
					{$isLoading ? '...' : 'Check'}
				</button>
			{/if}
			{#if $canCall}
				<button
					class="win95-button action-btn call"
					onclick={handleCall}
					disabled={actionsDisabled}
				>
					{$isLoading ? '...' : `Call ${callAmountSol.toFixed(4)}`}
				</button>
			{/if}
		</div>

		<div class="bet-controls">
			<input
				type="number"
				class="win95-input bet-input"
				bind:value={betAmountSol}
				min="0.001"
				max={playerChips}
				step="0.01"
				disabled={actionsDisabled}
			/>
			<span class="sol-label">SOL</span>
			{#if $canCheck}
				<button
					class="win95-button action-btn bet"
					onclick={handleBet}
					disabled={actionsDisabled}
				>
					{$isLoading ? '...' : 'Bet'}
				</button>
			{:else}
				<button
					class="win95-button action-btn raise"
					onclick={handleRaise}
					disabled={actionsDisabled}
				>
					{$isLoading ? '...' : 'Raise'}
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.poker-table {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: #c0c0c0;
	}

	.felt {
		flex: 1;
		background: #0d5c0d;
		border: 8px solid #4a2810;
		border-radius: 16px;
		margin: 8px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		box-shadow:
			inset 0 0 20px rgba(0, 0, 0, 0.5),
			inset 0 0 60px rgba(0, 0, 0, 0.2);
	}

	.community-area {
		text-align: center;
	}

	.community-label,
	.hole-label,
	.pot-label {
		color: #90ee90;
		font-size: 11px;
		font-weight: bold;
		text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
		margin-bottom: 8px;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.community-cards,
	.hole-cards {
		display: flex;
		gap: 8px;
		justify-content: center;
	}

	.card-placeholder {
		width: 71px;
		height: 96px;
		border: 2px dashed rgba(255, 255, 255, 0.3);
		border-radius: 4px;
	}

	.pot-display {
		text-align: center;
		background: rgba(0, 0, 0, 0.3);
		padding: 8px 24px;
		border-radius: 8px;
	}

	.pot-amount {
		color: #ffd700;
		font-size: 18px;
		font-weight: bold;
		text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
	}

	.hole-cards-area {
		text-align: center;
	}

	.controls {
		background: #c0c0c0;
		padding: 8px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		border-top: 2px solid #ffffff;
	}

	.player-info {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.chips-label {
		font-size: 10px;
		color: #808080;
	}

	.chips-amount {
		font-size: 14px;
		font-weight: bold;
		color: #000080;
	}

	.action-buttons {
		display: flex;
		gap: 4px;
	}

	.bet-controls {
		display: flex;
		gap: 4px;
		align-items: center;
	}

	.bet-input {
		width: 60px;
		text-align: right;
	}

	.win95-button {
		background: #c0c0c0;
		border: none;
		padding: 4px 12px;
		font-family: 'MS Sans Serif', sans-serif;
		font-size: 11px;
		cursor: pointer;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff,
			inset -2px -2px 0 #808080,
			inset 2px 2px 0 #dfdfdf;
	}

	.win95-button:active {
		box-shadow:
			inset 1px 1px 0 #0a0a0a,
			inset -1px -1px 0 #ffffff;
		padding: 5px 11px 3px 13px;
	}

	.win95-input {
		background: #ffffff;
		border: none;
		padding: 2px 4px;
		font-family: 'MS Sans Serif', sans-serif;
		font-size: 11px;
		box-shadow:
			inset 1px 1px 0 #0a0a0a,
			inset -1px -1px 0 #ffffff,
			inset 2px 2px 0 #808080;
	}

	.action-btn.fold {
		color: #800000;
	}

	.action-btn.call,
	.action-btn.bet,
	.action-btn.raise {
		color: #008000;
	}

	.turn-indicator {
		display: block;
		font-size: 10px;
		font-weight: bold;
		margin-top: 4px;
		padding: 2px 6px;
		border-radius: 2px;
	}

	.turn-indicator.waiting {
		color: #808080;
		background: #e0e0e0;
	}

	.turn-indicator.your-turn {
		color: #ffffff;
		background: #008000;
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.7; }
	}

	.sol-label {
		font-size: 10px;
		color: #808080;
	}
</style>
