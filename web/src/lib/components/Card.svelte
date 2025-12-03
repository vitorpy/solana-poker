<script lang="ts">
	interface Props {
		cardIndex?: number; // 1-52, or 0 for face down
		faceDown?: boolean;
		backStyle?: number; // 1-12 for different card backs
		selected?: boolean;
		onClick?: () => void;
	}

	let {
		cardIndex = 0,
		faceDown = false,
		backStyle = 1,
		selected = false,
		onClick
	}: Props = $props();

	// Card names for reference (Windows Solitaire order)
	// Clubs: A,2,3,4,5,6,7,8,9,10,J,Q,K (1-13)
	// Diamonds: A,2,3,4,5,6,7,8,9,10,J,Q,K (14-26)
	// Hearts: A,2,3,4,5,6,7,8,9,10,J,Q,K (27-39)
	// Spades: A,2,3,4,5,6,7,8,9,10,J,Q,K (40-52)

	function getCardSrc(): string {
		if (faceDown || cardIndex === 0) {
			return `/card_backs/back_${backStyle}.png`;
		}
		// Pad to 2 digits
		const num = cardIndex.toString().padStart(2, '0');
		return `/cards/card_${num}.png`;
	}

	function getCardName(): string {
		if (faceDown || cardIndex === 0) return 'Card Back';

		const suits = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
		const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

		const suitIndex = Math.floor((cardIndex - 1) / 13);
		const valueIndex = (cardIndex - 1) % 13;

		return `${values[valueIndex]} of ${suits[suitIndex]}`;
	}
</script>

<button
	class="card"
	class:selected
	class:face-down={faceDown || cardIndex === 0}
	onclick={onClick}
	title={getCardName()}
>
	<img src={getCardSrc()} alt={getCardName()} />
</button>

<style>
	.card {
		width: 71px;
		height: 96px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		transition: transform 0.1s;
		image-rendering: pixelated;
	}

	.card img {
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
	}

	.card:hover {
		transform: translateY(-4px);
	}

	.card.selected {
		transform: translateY(-8px);
		box-shadow: 0 4px 8px rgba(0, 0, 128, 0.5);
	}

	.card.face-down {
		cursor: default;
	}

	.card.face-down:hover {
		transform: none;
	}
</style>
