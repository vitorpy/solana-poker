<script lang="ts">
	import CreateTable from './CreateTable.svelte';
	import JoinTable from './JoinTable.svelte';
	import { isInGame } from '$lib/game/store';
	import { connected } from '$lib/wallet/store';

	interface Props {
		prefillGameId?: string;
		onGameStarted?: () => void;
	}

	let { prefillGameId = '', onGameStarted }: Props = $props();

	type View = 'menu' | 'create' | 'join';
	let currentView = $state<View>(prefillGameId ? 'join' : 'menu');

	function handleCreated(gameId: string) {
		// Stay on create view to show sharing UI
	}

	function handleJoined() {
		onGameStarted?.();
	}

	// If we're in a game, trigger callback
	$effect(() => {
		if ($isInGame) {
			onGameStarted?.();
		}
	});
</script>

<div class="lobby">
	{#if currentView === 'menu'}
		<div class="menu">
			<div class="logo">
				<div class="cards-icon">
					<div class="card card-1"></div>
					<div class="card card-2"></div>
				</div>
			</div>

			<h2>Solana Poker</h2>
			<p class="subtitle">Heads-Up Texas Hold'em</p>

			<div class="menu-buttons">
				<button
					class="win95-button menu-btn"
					onclick={() => currentView = 'create'}
					disabled={!$connected}
				>
					Create Table
				</button>
				<button
					class="win95-button menu-btn"
					onclick={() => currentView = 'join'}
					disabled={!$connected}
				>
					Join Table
				</button>
			</div>

			{#if !$connected}
				<p class="connect-hint">Connect your wallet to play</p>
			{/if}

			<div class="info-section">
				<div class="groupbox">
					<div class="groupbox-title">How to Play</div>
					<ol>
						<li>Connect your wallet</li>
						<li>Create a table or join with a link</li>
						<li>Wait for opponent to join</li>
						<li>Play Texas Hold'em!</li>
					</ol>
				</div>
			</div>
		</div>
	{:else if currentView === 'create'}
		<CreateTable
			onCreated={handleCreated}
			onCancel={() => currentView = 'menu'}
		/>
	{:else if currentView === 'join'}
		<JoinTable
			prefillGameId={prefillGameId}
			onJoined={handleJoined}
			onCancel={() => currentView = 'menu'}
		/>
	{/if}
</div>

<style>
	.lobby {
		padding: 16px;
		min-height: 300px;
	}

	.menu {
		text-align: center;
	}

	.logo {
		margin-bottom: 8px;
	}

	.cards-icon {
		display: inline-block;
		position: relative;
		width: 60px;
		height: 50px;
	}

	.card {
		position: absolute;
		width: 35px;
		height: 48px;
		background: white;
		border: 1px solid #000;
		border-radius: 3px;
		box-shadow: 1px 1px 2px rgba(0,0,0,0.3);
	}

	.card-1 {
		left: 5px;
		transform: rotate(-10deg);
		background: linear-gradient(135deg, white 0%, white 48%, #cc0000 48%, #cc0000 52%, white 52%);
	}

	.card-2 {
		left: 20px;
		transform: rotate(10deg);
		background: linear-gradient(135deg, white 0%, white 48%, #000000 48%, #000000 52%, white 52%);
	}

	h2 {
		margin: 0;
		font-size: 16px;
		color: #000080;
	}

	.subtitle {
		margin: 4px 0 16px 0;
		font-size: 11px;
		color: #808080;
	}

	.menu-buttons {
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: center;
		margin: 16px 0;
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

	.win95-button:disabled {
		color: #808080;
		cursor: default;
	}

	.menu-btn {
		min-width: 150px;
		padding: 8px 16px;
		font-size: 12px;
	}

	.connect-hint {
		color: #808000;
		font-style: italic;
		font-size: 11px;
	}

	.info-section {
		margin-top: 16px;
		text-align: left;
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

	ol {
		margin: 0;
		padding-left: 20px;
		font-size: 11px;
	}

	li {
		margin: 4px 0;
	}
</style>
