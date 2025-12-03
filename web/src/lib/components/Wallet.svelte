<script lang="ts">
	import { onMount } from 'svelte';
	import { wallet, publicKey, balance, connected, loading } from '$lib/wallet/store';

	let showSecretKey = $state(false);
	let importKey = $state('');
	let showImport = $state(false);

	onMount(() => {
		// Try to load existing wallet
		const loaded = wallet.load();
		if (loaded) {
			wallet.refreshBalance();
		}
	});

	function handleGenerate() {
		wallet.generate();
		wallet.refreshBalance();
	}

	function handleImport() {
		if (importKey.trim()) {
			const result = wallet.import(importKey.trim());
			if (result) {
				wallet.refreshBalance();
				showImport = false;
				importKey = '';
			}
		}
	}

	function handleDisconnect() {
		wallet.disconnect();
	}

	async function handleAirdrop() {
		await wallet.requestAirdrop(1);
	}

	function copyAddress() {
		if ($publicKey) {
			navigator.clipboard.writeText($publicKey);
		}
	}

	function formatAddress(addr: string | null): string {
		if (!addr) return '';
		return addr.slice(0, 4) + '...' + addr.slice(-4);
	}
</script>

<div class="wallet-container">
	{#if !$connected}
		<div class="wallet-setup">
			<div class="groupbox">
				<div class="groupbox-title">Wallet</div>
				<p>Create or import a wallet to play:</p>
				<div class="button-row">
					<button class="win95-button" onclick={handleGenerate}>
						New Wallet
					</button>
					<button class="win95-button" onclick={() => showImport = !showImport}>
						Import Key
					</button>
				</div>
				{#if showImport}
					<div class="import-section">
						<input
							type="password"
							class="win95-input"
							placeholder="Enter secret key (base58)"
							bind:value={importKey}
						/>
						<button class="win95-button" onclick={handleImport}>Import</button>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="wallet-info">
			<div class="groupbox">
				<div class="groupbox-title">Wallet</div>
				<div class="info-row">
					<span class="label">Address:</span>
					<span class="value address" onclick={copyAddress} title="Click to copy">
						{formatAddress($publicKey)}
					</span>
				</div>
				<div class="info-row">
					<span class="label">Balance:</span>
					<span class="value">
						{#if $loading}
							Loading...
						{:else}
							{$balance.toFixed(4)} SOL
						{/if}
					</span>
				</div>
				<div class="button-row">
					<button class="win95-button" onclick={handleAirdrop} disabled={$loading}>
						Airdrop 1 SOL
					</button>
					<button class="win95-button" onclick={() => wallet.refreshBalance()} disabled={$loading}>
						Refresh
					</button>
				</div>
				<div class="button-row">
					<button class="win95-button" onclick={() => showSecretKey = !showSecretKey}>
						{showSecretKey ? 'Hide' : 'Show'} Key
					</button>
					<button class="win95-button" onclick={handleDisconnect}>
						Disconnect
					</button>
				</div>
				{#if showSecretKey}
					<div class="secret-key">
						<label>Secret Key (keep safe!):</label>
						<textarea readonly class="win95-input key-display">
							{wallet.exportSecretKey()}
						</textarea>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.wallet-container {
		padding: 8px;
	}

	.groupbox {
		border: 1px solid #808080;
		border-top-color: #ffffff;
		border-left-color: #ffffff;
		padding: 16px 8px 8px 8px;
		position: relative;
		margin: 4px 0;
	}

	.groupbox-title {
		position: absolute;
		top: -8px;
		left: 8px;
		background: #c0c0c0;
		padding: 0 4px;
		font-weight: bold;
	}

	p {
		margin: 4px 0 8px 0;
	}

	.button-row {
		display: flex;
		gap: 8px;
		margin: 8px 0;
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
		width: 100%;
	}

	.import-section {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}

	.import-section input {
		flex: 1;
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		margin: 4px 0;
		padding: 2px 0;
	}

	.label {
		font-weight: bold;
	}

	.address {
		cursor: pointer;
		font-family: monospace;
	}

	.address:hover {
		text-decoration: underline;
	}

	.secret-key {
		margin-top: 8px;
	}

	.secret-key label {
		display: block;
		margin-bottom: 4px;
		color: #800000;
		font-weight: bold;
	}

	.key-display {
		width: 100%;
		height: 60px;
		resize: none;
		font-family: monospace;
		font-size: 10px;
		word-break: break-all;
	}
</style>
