<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Window from './Window.svelte';
	import Taskbar from './Taskbar.svelte';
	import PokerTable from './PokerTable.svelte';
	import Wallet from './Wallet.svelte';
	import TableLobby from './TableLobby.svelte';
	import { game, isInGame, gameId } from '$lib/game/store';

	// Reset any leftover game state when landing on the home page
	onMount(() => {
		game.leaveGame();
	});

	interface WindowState {
		id: string;
		title: string;
		minimized: boolean;
		x: number;
		y: number;
		width: number;
		height: number;
	}

	let windows = $state<WindowState[]>([
		{
			id: 'poker',
			title: 'Solana Poker',
			minimized: false,
			x: 50,
			y: 30,
			width: 400,
			height: 450
		},
		{
			id: 'wallet',
			title: 'Wallet',
			minimized: false,
			x: 480,
			y: 30,
			width: 280,
			height: 300
		}
	]);

	function handleGameStarted() {
		if ($gameId) {
			goto(`/game/${$gameId}`);
		}
	}

	function handleWindowClick(id: string) {
		windows = windows.map((w) => ({
			...w,
			minimized: w.id === id ? !w.minimized : w.minimized
		}));
	}

	function handleClose(id: string) {
		windows = windows.map((w) => ({
			...w,
			minimized: w.id === id ? true : w.minimized
		}));
	}

	function handleMinimize(id: string) {
		windows = windows.map((w) => ({
			...w,
			minimized: w.id === id ? true : w.minimized
		}));
	}
</script>

<div class="desktop">
	<!-- Desktop icons -->
	<div class="desktop-icons">
		<button
			class="desktop-icon"
			ondblclick={() => handleWindowClick('poker')}
		>
			<div class="icon-image poker-icon"></div>
			<span>Solana Poker</span>
		</button>
		<button
			class="desktop-icon"
			ondblclick={() => handleWindowClick('wallet')}
		>
			<div class="icon-image wallet-icon"></div>
			<span>Wallet</span>
		</button>
	</div>

	<!-- Windows -->
	{#each windows as window}
		{#if window.id === 'poker'}
			<Window
				title={window.title}
				bind:minimized={window.minimized}
				bind:x={window.x}
				bind:y={window.y}
				bind:width={window.width}
				bind:height={window.height}
				onClose={() => handleClose(window.id)}
				onMinimize={() => handleMinimize(window.id)}
			>
				<TableLobby onGameStarted={handleGameStarted} />
			</Window>
		{:else if window.id === 'wallet'}
			<Window
				title={window.title}
				bind:minimized={window.minimized}
				bind:x={window.x}
				bind:y={window.y}
				bind:width={window.width}
				bind:height={window.height}
				onClose={() => handleClose(window.id)}
				onMinimize={() => handleMinimize(window.id)}
			>
				<Wallet />
			</Window>
		{/if}
	{/each}

	<Taskbar {windows} onWindowClick={handleWindowClick} />
</div>

<style>
	.desktop {
		width: 100vw;
		height: 100vh;
		background: #008080;
		position: relative;
		overflow: hidden;
	}

	.desktop-icons {
		position: absolute;
		top: 16px;
		left: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.desktop-icon {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		padding: 4px;
		cursor: pointer;
		color: white;
		font-family: 'MS Sans Serif', sans-serif;
		font-size: 11px;
		text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.8);
	}

	.desktop-icon:hover {
		background: rgba(0, 0, 128, 0.3);
	}

	.desktop-icon:focus {
		outline: 1px dotted white;
		background: rgba(0, 0, 128, 0.5);
	}

	.icon-image {
		width: 32px;
		height: 32px;
		background: #c0c0c0;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff;
	}

	.poker-icon {
		background: linear-gradient(135deg, #0d5c0d 0%, #0a3d0a 100%);
		position: relative;
	}

	.poker-icon::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 20px;
		height: 28px;
		background: white;
		border-radius: 2px;
		box-shadow:
			2px 0 0 #c0c0c0,
			4px 0 0 white;
	}

	.wallet-icon {
		background: linear-gradient(135deg, #8b4513 0%, #654321 100%);
	}
</style>
