import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
	plugins: [
		sveltekit(),
		nodePolyfills({
			include: ['buffer', 'crypto', 'stream', 'util'],
			globals: {
				Buffer: true,
				global: true,
				process: true
			}
		})
	],
	define: {
		'process.env': {}
	},
	optimizeDeps: {
		include: ['buffer', '@solana/web3.js'],
		esbuildOptions: {
			define: {
				global: 'globalThis'
			}
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		globals: true
	}
});
