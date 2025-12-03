<script lang="ts">
	import { game, gameId, isLoading, gameError, isWaitingForPlayers, playersInGame, maxPlayers } from '$lib/game/store';
	import { connected } from '$lib/wallet/store';
	import { LAMPORTS_PER_SOL } from '@solana/web3.js';

	interface Props {
		onCreated?: (gameId: string) => void;
		onCancel?: () => void;
	}

	let { onCreated, onCancel }: Props = $props();

	let smallBlindSol = $state(0.01);
	let minBuyInSol = $state(0.1);
	let createdGameId = $state<string | null>(null);
	let copied = $state(false);

	const smallBlind = $derived(BigInt(Math.floor(smallBlindSol * LAMPORTS_PER_SOL)));
	const minBuyIn = $derived(BigInt(Math.floor(minBuyInSol * LAMPORTS_PER_SOL)));

	async function handleCreate() {
		if (!$connected) return;

		const gameIdResult = await game.createGame(2, smallBlind, minBuyIn);
		if (gameIdResult) {
			createdGameId = gameIdResult;
			onCreated?.(gameIdResult);
		}
	}

	function getShareUrl(): string {
		if (!createdGameId) return '';
		const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
		return `${baseUrl}/join/${createdGameId}`;
	}

	async function copyToClipboard() {
		const url = getShareUrl();
		if (url) {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => copied = false, 2000);
		}
	}
</script>

<div class="create-table">
	{#if !createdGameId}
		<div class="form">
			<h3>Create New Table</h3>
			<p>Heads-up Texas Hold'em (2 players)</p>

			<div class="field">
				<label for="small-blind">Small Blind (SOL):</label>
				<input
					id="small-blind"
					type="number"
					class="win95-input"
					bind:value={smallBlindSol}
					min="0.001"
					step="0.001"
				/>
			</div>

			<div class="field">
				<label for="min-buy-in">Min Buy-in (SOL):</label>
				<input
					id="min-buy-in"
					type="number"
					class="win95-input"
					bind:value={minBuyInSol}
					min="0.01"
					step="0.01"
				/>
			</div>

			{#if $gameError}
				<div class="error">{$gameError}</div>
			{/if}

			<div class="buttons">
				<button
					class="win95-button"
					onclick={handleCreate}
					disabled={!$connected || $isLoading}
				>
					{$isLoading ? 'Creating...' : 'Create Table'}
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
	{:else}
		<div class="created">
			<h3>Table Created!</h3>

			<div class="share-section">
				<p>Share this link with your opponent:</p>
				<div class="share-url">
					<input
						type="text"
						class="win95-input url-input"
						value={getShareUrl()}
						readonly
					/>
					<button class="win95-button" onclick={copyToClipboard}>
						{copied ? 'Copied!' : 'Copy'}
					</button>
				</div>
			</div>

			<div class="status">
				<div class="waiting-indicator"></div>
				<span>Waiting for opponent... ({$playersInGame}/{$maxPlayers} players)</span>
			</div>

			{#if !$isWaitingForPlayers && $playersInGame >= $maxPlayers}
				<p class="ready">Game is ready to start!</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.create-table {
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
		margin: 8px 0;
		padding: 4px;
		background: #ffeeee;
	}

	.warning {
		color: #808000;
		font-style: italic;
	}

	.share-section {
		margin: 12px 0;
	}

	.share-url {
		display: flex;
		gap: 4px;
		margin-top: 4px;
	}

	.url-input {
		flex: 1;
		font-family: monospace;
		font-size: 10px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		padding: 8px;
		background: #ffffcc;
	}

	.waiting-indicator {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #ffcc00;
		animation: pulse 1s infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

	.ready {
		color: #008000;
		font-weight: bold;
	}
</style>
