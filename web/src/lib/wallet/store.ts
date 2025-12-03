import { writable, derived, get } from 'svelte/store';
import { Keypair, Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { RPC_ENDPOINT } from '$lib/game/constants';

// Types
export interface WalletState {
	keypair: Keypair | null;
	publicKey: string | null;
	balance: number;
	connected: boolean;
	loading: boolean;
}

// Create wallet store
function createWalletStore() {
	const { subscribe, set, update } = writable<WalletState>({
		keypair: null,
		publicKey: null,
		balance: 0,
		connected: false,
		loading: false
	});

	const connection = new Connection(RPC_ENDPOINT, 'confirmed');

	return {
		subscribe,
		connection,

		// Generate a new wallet
		generate: () => {
			const keypair = Keypair.generate();
			const publicKey = keypair.publicKey.toBase58();

			// Store in localStorage
			if (typeof window !== 'undefined') {
				localStorage.setItem('solana-poker-wallet', bs58.encode(keypair.secretKey));
			}

			set({
				keypair,
				publicKey,
				balance: 0,
				connected: true,
				loading: false
			});

			return publicKey;
		},

		// Import wallet from secret key
		import: (secretKeyBase58: string) => {
			try {
				const secretKey = bs58.decode(secretKeyBase58);
				const keypair = Keypair.fromSecretKey(secretKey);
				const publicKey = keypair.publicKey.toBase58();

				// Store in localStorage
				if (typeof window !== 'undefined') {
					localStorage.setItem('solana-poker-wallet', secretKeyBase58);
				}

				set({
					keypair,
					publicKey,
					balance: 0,
					connected: true,
					loading: false
				});

				return publicKey;
			} catch (e) {
				console.error('Failed to import wallet:', e);
				return null;
			}
		},

		// Load wallet from localStorage
		load: () => {
			if (typeof window === 'undefined') return false;

			const stored = localStorage.getItem('solana-poker-wallet');
			if (!stored) return false;

			try {
				const secretKey = bs58.decode(stored);
				const keypair = Keypair.fromSecretKey(secretKey);
				const publicKey = keypair.publicKey.toBase58();

				set({
					keypair,
					publicKey,
					balance: 0,
					connected: true,
					loading: false
				});

				return true;
			} catch (e) {
				console.error('Failed to load wallet:', e);
				localStorage.removeItem('solana-poker-wallet');
				return false;
			}
		},

		// Disconnect and clear wallet
		disconnect: () => {
			if (typeof window !== 'undefined') {
				localStorage.removeItem('solana-poker-wallet');
			}

			set({
				keypair: null,
				publicKey: null,
				balance: 0,
				connected: false,
				loading: false
			});
		},

		// Refresh balance
		refreshBalance: async () => {
			const state = get({ subscribe });
			if (!state.keypair) return;

			update(s => ({ ...s, loading: true }));

			try {
				const balance = await connection.getBalance(state.keypair.publicKey);
				update(s => ({ ...s, balance: balance / LAMPORTS_PER_SOL, loading: false }));
			} catch (e) {
				console.error('Failed to fetch balance:', e);
				update(s => ({ ...s, loading: false }));
			}
		},

		// Request airdrop (devnet only)
		requestAirdrop: async (amount: number = 1) => {
			const state = get({ subscribe });
			if (!state.keypair) return false;

			update(s => ({ ...s, loading: true }));

			try {
				const signature = await connection.requestAirdrop(
					state.keypair.publicKey,
					amount * LAMPORTS_PER_SOL
				);
				await connection.confirmTransaction(signature, 'confirmed');

				// Refresh balance after airdrop
				const balance = await connection.getBalance(state.keypair.publicKey);
				update(s => ({ ...s, balance: balance / LAMPORTS_PER_SOL, loading: false }));

				return true;
			} catch (e) {
				console.error('Airdrop failed:', e);
				update(s => ({ ...s, loading: false }));
				return false;
			}
		},

		// Sign a transaction
		signTransaction: async (transaction: Transaction) => {
			const state = get({ subscribe });
			if (!state.keypair) throw new Error('Wallet not connected');

			transaction.feePayer = state.keypair.publicKey;
			const { blockhash } = await connection.getLatestBlockhash();
			transaction.recentBlockhash = blockhash;

			transaction.sign(state.keypair);
			return transaction;
		},

		// Sign and send a transaction
		signAndSendTransaction: async (transaction: Transaction) => {
			const state = get({ subscribe });
			if (!state.keypair) throw new Error('Wallet not connected');

			transaction.feePayer = state.keypair.publicKey;
			const { blockhash } = await connection.getLatestBlockhash();
			transaction.recentBlockhash = blockhash;

			transaction.sign(state.keypair);

			const signature = await connection.sendRawTransaction(transaction.serialize());
			await connection.confirmTransaction(signature, 'confirmed');

			return signature;
		},

		// Export secret key (for backup)
		exportSecretKey: () => {
			const state = get({ subscribe });
			if (!state.keypair) return null;
			return bs58.encode(state.keypair.secretKey);
		}
	};
}

export const wallet = createWalletStore();

// Derived stores for convenience
export const publicKey = derived(wallet, $wallet => $wallet.publicKey);
export const balance = derived(wallet, $wallet => $wallet.balance);
export const connected = derived(wallet, $wallet => $wallet.connected);
export const loading = derived(wallet, $wallet => $wallet.loading);
