<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Window from '$lib/components/Window.svelte';
	import Wallet from '$lib/components/Wallet.svelte';
	import TableLobby from '$lib/components/TableLobby.svelte';
	import Taskbar from '$lib/components/Taskbar.svelte';

	// Get game ID from URL
	const gameId = $derived($page.params.gameId);

	function handleGameStarted() {
		// Navigate to game view
		goto(`/game/${gameId}`);
	}
</script>

<div class="desktop">
	<Window
		title="Solana Poker - Join Game"
		x={100}
		y={50}
		width={400}
		height={400}
	>
		<TableLobby
			prefillGameId={gameId}
			onGameStarted={handleGameStarted}
		/>
	</Window>

	<Window
		title="Wallet"
		x={520}
		y={50}
		width={280}
		height={300}
	>
		<Wallet />
	</Window>

	<Taskbar
		windows={[
			{ id: 'join', title: 'Join Game', minimized: false },
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
</style>
