<script lang="ts">
	interface WindowInfo {
		id: string;
		title: string;
		minimized: boolean;
	}

	interface Props {
		windows?: WindowInfo[];
		onWindowClick?: (id: string) => void;
	}

	let { windows = [], onWindowClick }: Props = $props();

	function getCurrentTime(): string {
		const now = new Date();
		return now.toLocaleTimeString('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	let time = $state(getCurrentTime());

	$effect(() => {
		const interval = setInterval(() => {
			time = getCurrentTime();
		}, 1000);

		return () => clearInterval(interval);
	});
</script>

<div class="taskbar">
	<button class="start-button">
		<img src="/windows-logo.svg" alt="Windows" class="start-logo" />
		<span>Start</span>
	</button>

	<div class="taskbar-divider"></div>

	<div class="window-buttons">
		{#each windows as window}
			<button
				class="window-button"
				class:active={!window.minimized}
				onclick={() => onWindowClick?.(window.id)}
			>
				{window.title}
			</button>
		{/each}
	</div>

	<div class="system-tray">
		<div class="tray-divider"></div>
		<span class="clock">{time}</span>
	</div>
</div>

<style>
	.taskbar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: 28px;
		background: #c0c0c0;
		display: flex;
		align-items: center;
		padding: 2px;
		box-shadow:
			inset 0 1px 0 #ffffff,
			inset 0 -1px 0 #808080;
		z-index: 9999;
	}

	.start-button {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		background: #c0c0c0;
		border: none;
		font-family: 'MS Sans Serif', sans-serif;
		font-size: 11px;
		font-weight: bold;
		cursor: pointer;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff,
			inset -2px -2px 0 #808080,
			inset 2px 2px 0 #dfdfdf;
	}

	.start-button:active {
		box-shadow:
			inset 1px 1px 0 #0a0a0a,
			inset -1px -1px 0 #ffffff;
		padding: 3px 5px 1px 7px;
	}

	.start-logo {
		width: 16px;
		height: 16px;
	}

	.taskbar-divider {
		width: 2px;
		height: 20px;
		margin: 0 4px;
		background: #808080;
		box-shadow: 1px 0 0 #ffffff;
	}

	.window-buttons {
		flex: 1;
		display: flex;
		gap: 2px;
		overflow-x: auto;
	}

	.window-button {
		min-width: 120px;
		max-width: 160px;
		padding: 2px 8px;
		background: #c0c0c0;
		border: none;
		font-family: 'MS Sans Serif', sans-serif;
		font-size: 11px;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff,
			inset -2px -2px 0 #808080,
			inset 2px 2px 0 #dfdfdf;
	}

	.window-button.active {
		box-shadow:
			inset 1px 1px 0 #0a0a0a,
			inset -1px -1px 0 #ffffff;
		background: repeating-linear-gradient(
			0deg,
			#c0c0c0,
			#c0c0c0 1px,
			#ffffff 1px,
			#ffffff 2px
		);
	}

	.system-tray {
		display: flex;
		align-items: center;
		padding: 0 4px;
	}

	.tray-divider {
		width: 2px;
		height: 20px;
		margin-right: 8px;
		background: #808080;
		box-shadow: 1px 0 0 #ffffff;
	}

	.clock {
		padding: 2px 8px;
		background: #c0c0c0;
		box-shadow:
			inset 1px 1px 0 #808080,
			inset -1px -1px 0 #ffffff;
		font-family: 'MS Sans Serif', sans-serif;
		font-size: 11px;
	}
</style>
