<script lang="ts">
	import { game, isLoading, gameError, type GameConfigData } from '$lib/game/store';
	import { connected } from '$lib/wallet/store';
	import { LAMPORTS_PER_SOL } from '@solana/web3.js';

	interface Props {
		prefillGameId?: string;
		onJoined?: () => void;
		onCancel?: () => void;
	}

	let { prefillGameId = '', onJoined, onCancel }: Props = $props();

	let gameIdInput = $state(prefillGameId);
	let depositSol = $state(0.1);
	let gameInfo = $state<GameConfigData | null>(null);
	let lookupError = $state<string | null>(null);
	let isLookingUp = $state(false);
	let hasAutoLooked = $state(false);

	const depositAmount = $derived(BigInt(Math.floor(depositSol * LAMPORTS_PER_SOL)));

	// Auto-lookup when prefillGameId is set on mount or changes
	$effect(() => {
		if (prefillGameId && !hasAutoLooked) {
			hasAutoLooked = true;
			gameIdInput = prefillGameId;
			lookupGame();
		}
	});

	async function lookupGame() {
		if (!gameIdInput.trim()) {
			gameInfo = null;
			lookupError = null;
			return;
		}

		isLookingUp = true;
		lookupError = null;

		try {
			const info = await game.lookupGame(gameIdInput.trim());
			if (info) {
				gameInfo = info;
				// Set default deposit to min buy-in
				depositSol = Number(info.minBuyIn) / LAMPORTS_PER_SOL;
			} else {
				gameInfo = null;
				lookupError = 'Game not found';
			}
		} catch (e) {
			gameInfo = null;
			lookupError = 'Invalid game ID';
		}

		isLookingUp = false;
	}

	async function handleJoin() {
		if (!$connected || !gameIdInput.trim()) return;

		const success = await game.joinGame(gameIdInput.trim(), depositAmount);
		if (success) {
			onJoined?.();
		}
	}

	function formatSol(lamports: bigint): string {
		return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
	}
</script>

<div class="join-table">
	<h3>Join Existing Table</h3>

	<div class="field">
		<label for="game-id">Game ID:</label>
		<div class="game-id-input">
			<input
				id="game-id"
				type="text"
				class="win95-input"
				placeholder="Enter game ID or paste invite link"
				bind:value={gameIdInput}
				onblur={lookupGame}
			/>
			<button
				class="win95-button"
				onclick={lookupGame}
				disabled={isLookingUp}
			>
				{isLookingUp ? '...' : 'Lookup'}
			</button>
		</div>
	</div>

	{#if lookupError}
		<div class="error">{lookupError}</div>
	{/if}

	{#if gameInfo}
		<div class="game-info">
			<div class="groupbox">
				<div class="groupbox-title">Game Info</div>
				<div class="info-row">
					<span class="label">Players:</span>
					<span class="value">{gameInfo.currentPlayers}/{gameInfo.maxPlayers}</span>
				</div>
				<div class="info-row">
					<span class="label">Small Blind:</span>
					<span class="value">{formatSol(gameInfo.smallBlind)} SOL</span>
				</div>
				<div class="info-row">
					<span class="label">Min Buy-in:</span>
					<span class="value">{formatSol(gameInfo.minBuyIn)} SOL</span>
				</div>
				<div class="info-row">
					<span class="label">Status:</span>
					<span class="value" class:accepting={gameInfo.isAcceptingPlayers}>
						{gameInfo.isAcceptingPlayers ? 'Accepting Players' : 'Full'}
					</span>
				</div>
			</div>
		</div>

		{#if gameInfo.isAcceptingPlayers}
			<div class="field">
				<label for="deposit">Your Buy-in (SOL):</label>
				<input
					id="deposit"
					type="number"
					class="win95-input"
					bind:value={depositSol}
					min={Number(gameInfo.minBuyIn) / LAMPORTS_PER_SOL}
					step="0.01"
				/>
				{#if depositAmount < gameInfo.minBuyIn}
					<span class="hint error">Minimum: {formatSol(gameInfo.minBuyIn)} SOL</span>
				{/if}
			</div>
		{/if}
	{/if}

	{#if $gameError}
		<div class="error">{$gameError}</div>
	{/if}

	<div class="buttons">
		<button
			class="win95-button"
			onclick={handleJoin}
			disabled={!$connected || $isLoading || !gameInfo || !gameInfo.isAcceptingPlayers || depositAmount < (gameInfo?.minBuyIn ?? BigInt(0))}
		>
			{$isLoading ? 'Joining...' : 'Join Game'}
		</button>
		{#if onCancel}
			<button class="win95-button" onclick={onCancel}>
				Cancel
			</button>
		{/if}
	</div>

	{#if !$connected}
		<p class="warning">Connect your wallet first</p>
	{/if}
</div>

<style>
	.join-table {
		padding: 8px;
	}

	h3 {
		margin: 0 0 8px 0;
		font-size: 12px;
	}

	p {
		margin: 4px 0;
		font-size: 11px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 8px;
	}

	.field label {
		font-size: 11px;
	}

	.game-id-input {
		display: flex;
		gap: 4px;
	}

	.game-id-input input {
		flex: 1;
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

	.win95-button {
		background: #c0c0c0;
		border: none;
		padding: 4px 12px;
		font-family: 'MS Sans Serif', sans-serif;
		font-size: 11px;
		cursor: pointer;
		min-width: 75px;
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

	.win95-button:disabled {
		color: #808080;
		cursor: default;
	}

	.buttons {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}

	.error {
		color: #800000;
		font-size: 11px;
		margin: 4px 0;
	}

	.warning {
		color: #808000;
		font-style: italic;
		font-size: 11px;
	}

	.hint {
		font-size: 10px;
		color: #808080;
	}

	.game-info {
		margin: 8px 0;
	}

	.groupbox {
		border: 1px solid #808080;
		border-top-color: #ffffff;
		border-left-color: #ffffff;
		padding: 12px 8px 8px 8px;
		position: relative;
	}

	.groupbox-title {
		position: absolute;
		top: -8px;
		left: 8px;
		background: #c0c0c0;
		padding: 0 4px;
		font-weight: bold;
		font-size: 11px;
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		margin: 4px 0;
		font-size: 11px;
	}

	.label {
		color: #808080;
	}

	.value {
		font-weight: bold;
	}

	.value.accepting {
		color: #008000;
	}
</style>
