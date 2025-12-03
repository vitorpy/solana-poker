<script lang="ts">
	import '../lib/styles/win95.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Solana Poker - Windows 95</title>
	<link
		href="https://fonts.googleapis.com/css2?family=VT323&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{@render children()}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: 'MS Sans Serif', 'Segoe UI', Tahoma, sans-serif;
		font-size: 11px;
		background: #008080;
		overflow: hidden;
		height: 100vh;
		width: 100vw;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(html) {
		height: 100%;
	}
</style>
