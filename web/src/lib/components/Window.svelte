<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		title?: string;
		width?: number;
		height?: number;
		x?: number;
		y?: number;
		minimized?: boolean;
		onClose?: () => void;
		onMinimize?: () => void;
		children?: any;
	}

	let {
		title = 'Window',
		width = $bindable(400),
		height = $bindable(300),
		x = $bindable(100),
		y = $bindable(100),
		minimized = $bindable(false),
		onClose,
		onMinimize,
		children
	}: Props = $props();

	let isDragging = $state(false);
	let isResizing = $state(false);
	let dragOffset = $state({ x: 0, y: 0 });
	let zIndex = $state(100);

	function handleDragStart(event: MouseEvent) {
		isDragging = true;
		const rect = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
		dragOffset = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top
		};
		zIndex = Date.now() % 10000;
		event.preventDefault();
	}

	function handleResizeStart(event: MouseEvent) {
		isResizing = true;
		event.preventDefault();
		event.stopPropagation();
	}

	function handleMouseMove(event: MouseEvent) {
		if (isDragging) {
			x = Math.max(0, event.clientX - dragOffset.x);
			y = Math.max(0, event.clientY - dragOffset.y);
		} else if (isResizing) {
			width = Math.max(200, event.clientX - x);
			height = Math.max(150, event.clientY - y);
		}
	}

	function handleMouseUp() {
		isDragging = false;
		isResizing = false;
	}

	function handleClose() {
		if (onClose) onClose();
	}

	function handleMinimize() {
		minimized = true;
		if (onMinimize) onMinimize();
	}
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

{#if !minimized}
	<div
		class="window"
		style="left: {x}px; top: {y}px; width: {width}px; height: {height}px; z-index: {zIndex};"
	>
		<div class="title-bar" onmousedown={handleDragStart} role="button" tabindex="0">
			<div class="title-icon">
				<svg width="16" height="16" viewBox="0 0 16 16">
					<rect x="2" y="2" width="12" height="12" fill="#000080" />
					<rect x="4" y="4" width="8" height="8" fill="#fff" />
				</svg>
			</div>
			<span class="title">{title}</span>
			<div class="title-buttons">
				<button class="title-button" onclick={handleMinimize} title="Minimize">_</button>
				<button class="title-button" title="Maximize">□</button>
				<button class="title-button close" onclick={handleClose} title="Close">×</button>
			</div>
		</div>
		<div class="menu-bar">
			<span class="menu-item">Game</span>
			<span class="menu-item">Help</span>
		</div>
		<div class="content">
			{#if children}
				{@render children()}
			{/if}
		</div>
		<div class="resize-handle" onmousedown={handleResizeStart} role="button" tabindex="0"></div>
	</div>
{/if}

<style>
	.window {
		position: absolute;
		background: #c0c0c0;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff,
			inset -2px -2px 0 #808080,
			inset 2px 2px 0 #dfdfdf;
		display: flex;
		flex-direction: column;
		font-family: 'MS Sans Serif', sans-serif;
		font-size: 11px;
	}

	.title-bar {
		background: linear-gradient(90deg, #000080 0%, #1084d0 100%);
		color: white;
		padding: 2px 3px;
		cursor: grab;
		display: flex;
		align-items: center;
		gap: 4px;
		height: 18px;
		user-select: none;
	}

	.title-bar:active {
		cursor: grabbing;
	}

	.title-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.title {
		flex: 1;
		font-weight: bold;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.title-buttons {
		display: flex;
		gap: 2px;
	}

	.title-button {
		background: #c0c0c0;
		border: none;
		width: 16px;
		height: 14px;
		padding: 0;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-weight: bold;
		font-family: 'MS Sans Serif', sans-serif;
		box-shadow:
			inset -1px -1px 0 #0a0a0a,
			inset 1px 1px 0 #ffffff,
			inset -2px -2px 0 #808080,
			inset 2px 2px 0 #dfdfdf;
	}

	.title-button:active {
		box-shadow:
			inset 1px 1px 0 #0a0a0a,
			inset -1px -1px 0 #ffffff;
		padding-top: 1px;
		padding-left: 1px;
	}

	.title-button.close {
		margin-left: 2px;
	}

	.menu-bar {
		background: #c0c0c0;
		padding: 2px 0;
		display: flex;
		border-bottom: 1px solid #808080;
	}

	.menu-item {
		padding: 2px 8px;
		cursor: pointer;
	}

	.menu-item:hover {
		background: #000080;
		color: white;
	}

	.content {
		flex: 1;
		overflow: auto;
		background: #c0c0c0;
		margin: 2px;
	}

	.resize-handle {
		position: absolute;
		bottom: 0;
		right: 0;
		width: 16px;
		height: 16px;
		cursor: nwse-resize;
		background: linear-gradient(
			135deg,
			transparent 0%,
			transparent 50%,
			#808080 50%,
			#808080 55%,
			transparent 55%,
			transparent 65%,
			#808080 65%,
			#808080 70%,
			transparent 70%,
			transparent 80%,
			#808080 80%,
			#808080 85%,
			transparent 85%
		);
	}
</style>
