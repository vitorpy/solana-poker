<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import Window from '$lib/components/Window.svelte';
	import Wallet from '$lib/components/Wallet.svelte';
	import PokerTable from '$lib/components/PokerTable.svelte';
	import Taskbar from '$lib/components/Taskbar.svelte';
	import {
		game,
		isInGame,
		gameConfig,
		gameState,
		playerState,
		playersInGame,
		maxPlayers,
		pot,
		playerChips,
		currentPhase,
		currentShufflingState,
		texasState,
		bettingRound,
		isPlayerTurn,
		gameError,
		protocolStatus,
		requiredAction,
		isLoading
	} from '$lib/game/store';
	import { GamePhase, ShufflingState, TexasHoldEmState, BettingRoundState } from '$lib/game/constants';
	import { LAMPORTS_PER_SOL } from '@solana/web3.js';
	import bs58 from 'bs58';
	import { checkAndExecuteProtocol, getProtocolStateDescription } from '$lib/game/protocol';

	// Get game ID from URL
	const gameIdBase58 = $derived($page.params.gameId);

	// Convert to bytes for store operations
	let gameIdBytes = $derived.by(() => {
		try {
			return bs58.decode(gameIdBase58);
		} catch {
			return null;
		}
	});

	// Auto-protocol execution
	let autoProtocolEnabled = $state(true);
	let protocolCheckInterval: ReturnType<typeof setInterval> | null = null;
	let isExecutingProtocol = $state(false);

	// Format SOL amount
	function formatSol(lamports: bigint): string {
		return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4);
	}

	// Get phase display text using protocol helper
	function getPhaseText(): string {
		return getProtocolStateDescription();
	}

	// Debug: get raw state values
	function getDebugInfo(): string {
		if (!$gameState) return '';
		return `Phase:${$currentPhase} Shuffle:${$currentShufflingState} Texas:${$texasState} Bet:${$bettingRound} Turn:${$isPlayerTurn ? 'YOU' : 'OPP'}`;
	}

	function handleLeave() {
		game.leaveGame();
		goto('/');
	}

	// Auto-execute protocol actions when it's our turn
	async function runProtocolCheck() {
		if (!autoProtocolEnabled || isExecutingProtocol || $isLoading) return;

		const action = $requiredAction;
		if (!action) return;

		// Don't auto-execute betting actions - those are manual
		if (action.action === 'bet' || action.action === 'fold' || action.action === 'check') {
			return;
		}

		console.log('[game] Auto-executing protocol action:', action);
		isExecutingProtocol = true;

		try {
			await checkAndExecuteProtocol();
		} catch (error) {
			console.error('[game] Protocol execution error:', error);
		} finally {
			isExecutingProtocol = false;
		}
	}

	// Manual protocol action button
	async function executeManualAction() {
		if (isExecutingProtocol || $isLoading) return;

		isExecutingProtocol = true;
		try {
			await checkAndExecuteProtocol();
		} catch (error) {
			console.error('[game] Manual protocol execution error:', error);
		} finally {
			isExecutingProtocol = false;
		}
	}

	// If not in game, try to reconnect or redirect
	onMount(() => {
		if (!$isInGame && gameIdBytes) {
			goto(`/join/${gameIdBase58}`);
			return;
		}

		// Start protocol check interval
		protocolCheckInterval = setInterval(runProtocolCheck, 1000);
	});

	onDestroy(() => {
		if (protocolCheckInterval) {
			clearInterval(protocolCheckInterval);
		}
	});
</script>

<div class="desktop">
	<Window
		title="Solana Poker - Game"
		x={50}
		y={30}
		width={700}
		height={500}
	>
		{#if $isInGame}
			<div class="game-container">
				<div class="game-header">
					<div class="game-info">
						<span class="phase">{getPhaseText()}</span>
						<span class="players">Players: {$playersInGame}/{$maxPlayers}</span>
						<span class="debug">{getDebugInfo()}</span>
					</div>
					<div class="header-actions">
						<label class="auto-toggle">
							<input type="checkbox" bind:checked={autoProtocolEnabled} />
							Auto
						</label>
						<button class="win95-button leave-btn" onclick={handleLeave}>
							Leave Game
						</button>
					</div>
				</div>

				{#if $gameError}
					<div class="error-banner">{$gameError}</div>
				{/if}

				{#if $protocolStatus}
					<div class="protocol-status">
						{#if isExecutingProtocol || $isLoading}
							<div class="mini-spinner"></div>
						{/if}
						<span>{$protocolStatus}</span>
					</div>
				{/if}

				<PokerTable
					pot={Number($pot) / LAMPORTS_PER_SOL}
					playerChips={Number($playerChips) / LAMPORTS_PER_SOL}
				/>

				{#if $currentPhase === GamePhase.Shuffling && $currentShufflingState === ShufflingState.Committing}
					<div class="waiting-overlay">
						<div class="waiting-message">
							<div class="spinner"></div>
							<p>Waiting for opponent to join...</p>
							<p class="hint">Share the game link to invite a player</p>
						</div>
					</div>
				{:else if $requiredAction && !autoProtocolEnabled}
					<div class="action-required">
						<div class="action-message">
							<p><strong>Action Required:</strong> {$requiredAction.description}</p>
							<button
								class="win95-button action-btn"
								onclick={executeManualAction}
								disabled={isExecutingProtocol || $isLoading}
							>
								{isExecutingProtocol ? 'Executing...' : 'Execute'}
							</button>
						</div>
					</div>
				{:else if isExecutingProtocol}
					<div class="protocol-overlay">
						<div class="protocol-message">
							<div class="spinner"></div>
							<p>Executing protocol action...</p>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="not-in-game">
				<p>You are not in this game.</p>
				<button class="win95-button" onclick={() => goto(`/join/${gameIdBase58}`)}>
					Join Game
				</button>
			</div>
		{/if}
	</Window>

	<Window
		title="Wallet"
		x={780}
		y={30}
		width={280}
		height={300}
	>
		<Wallet />
	</Window>

	<Taskbar
		windows={[
			{ id: 'game', title: 'Solana Poker', minimized: false },
			{ id: 'wallet', title: 'Wallet', minimized: false }
		]}
	/>
</div>

<style>
	.desktop {
		width: 100vw;
		height: 100vh;
		background: #008080;
		position: relative;
		overflow: hidden;
	}

	.game-container {
		height: 100%;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.game-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 8px;
		background: #c0c0c0;
		border-bottom: 1px solid #808080;
	}

	.game-info {
		display: flex;
		gap: 16px;
		font-size: 11px;
	}

	.phase {
		font-weight: bold;
		color: #000080;
	}

	.players {
		color: #808080;
	}

	.debug {
		font-family: monospace;
		font-size: 9px;
		color: #808080;
		background: #e0e0e0;
		padding: 1px 4px;
	}

	.error-banner {
		background: #ffcccc;
		color: #800000;
		padding: 4px 8px;
		font-size: 11px;
		border-bottom: 1px solid #800000;
	}

	.win95-button {
		background: #c0c0c0;
		border: none;
		padding: 2px 8px;
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
	}

	.leave-btn {
		color: #800000;
	}

	.waiting-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.waiting-message {
		background: #c0c0c0;
		padding: 24px;
		text-align: center;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff,
			inset -2px -2px 0 #808080,
			inset 2px 2px 0 #dfdfdf;
	}

	.waiting-message p {
		margin: 8px 0;
		font-size: 12px;
	}

	.hint {
		color: #808080;
		font-size: 11px !important;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 3px solid #c0c0c0;
		border-top-color: #000080;
		border-radius: 50%;
		margin: 0 auto 12px;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.not-in-game {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 16px;
	}

	.not-in-game p {
		font-size: 12px;
		color: #808080;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.auto-toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		color: #808080;
	}

	.auto-toggle input {
		margin: 0;
	}

	.protocol-status {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px;
		background: #ffffcc;
		border-bottom: 1px solid #cccc00;
		font-size: 11px;
	}

	.mini-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid #c0c0c0;
		border-top-color: #000080;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	.action-required {
		position: absolute;
		bottom: 60px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
	}

	.action-message {
		background: #c0c0c0;
		padding: 12px 16px;
		display: flex;
		align-items: center;
		gap: 12px;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff,
			inset -2px -2px 0 #808080,
			inset 2px 2px 0 #dfdfdf;
	}

	.action-message p {
		margin: 0;
		font-size: 11px;
	}

	.action-btn {
		background: #000080;
		color: white;
	}

	.protocol-overlay {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.3);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 5;
	}

	.protocol-message {
		background: #c0c0c0;
		padding: 24px;
		text-align: center;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff,
			inset -2px -2px 0 #808080,
			inset 2px 2px 0 #dfdfdf;
	}

	.protocol-message p {
		margin: 8px 0 0 0;
		font-size: 11px;
	}
</style>
