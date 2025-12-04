/**
 * Test validator lifecycle management for web tests
 */

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'http://localhost:8899';
const VALIDATOR_STARTUP_WAIT_MS = 10000;
const VALIDATOR_CLEANUP_WAIT_MS = 2000;

let connection: Connection | null = null;
let validatorProcess: ChildProcess | null = null;

/**
 * Get the path to the compiled program .so file
 */
export function getProgramPath(): string {
	// From web/src/lib/game/test-helpers, go up to solana-poker root
	const programPath = path.join(__dirname, '../../../../../target/deploy/solana_poker.so');
	if (!fs.existsSync(programPath)) {
		throw new Error(`Program not found at ${programPath}. Run 'cargo build-sbf' first.`);
	}
	return programPath;
}

/**
 * Get the program ID from the keypair file
 */
export function getProgramId(): PublicKey {
	const keypairPath = path.join(
		__dirname,
		'../../../../../target/deploy/solana_poker-keypair.json'
	);
	if (fs.existsSync(keypairPath)) {
		const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
		const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
		return keypair.publicKey;
	}
	throw new Error(`Program keypair not found at ${keypairPath}. Run 'cargo build-sbf' first.`);
}

/**
 * Kill any existing test validator instances
 */
export async function killExistingValidator(): Promise<void> {
	try {
		execSync('pkill -f solana-test-validator', { stdio: 'ignore' });
	} catch (e) {
		// Ignore if no process found
	}
	await new Promise((resolve) => setTimeout(resolve, VALIDATOR_CLEANUP_WAIT_MS));
}

/**
 * Start the test validator with the program pre-loaded
 */
export async function startValidator(): Promise<void> {
	await killExistingValidator();

	const programPath = getProgramPath();
	const programId = getProgramId();

	console.log(`Starting test validator with program ${programId.toBase58()}`);
	console.log(`Program path: ${programPath}`);

	validatorProcess = spawn(
		'solana-test-validator',
		['--reset', '--quiet', '--bpf-program', programId.toBase58(), programPath],
		{
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);

	validatorProcess.unref();

	validatorProcess.stderr?.on('data', (data) => {
		const msg = data.toString();
		if (msg.includes('error') || msg.includes('Error')) {
			console.error('Validator stderr:', msg);
		}
	});

	console.log(`Waiting ${VALIDATOR_STARTUP_WAIT_MS / 1000}s for validator to start...`);
	await new Promise((resolve) => setTimeout(resolve, VALIDATOR_STARTUP_WAIT_MS));

	connection = new Connection(RPC_URL, 'confirmed');

	const programAccount = await connection.getAccountInfo(programId);
	if (!programAccount) {
		throw new Error(
			`Program account not found after validator startup. ID: ${programId.toBase58()}`
		);
	}

	console.log('Test validator started successfully');
}

/**
 * Stop the test validator
 */
export async function stopValidator(): Promise<void> {
	if (validatorProcess) {
		validatorProcess.kill();
		validatorProcess = null;
	}

	try {
		execSync('pkill -f solana-test-validator', { stdio: 'ignore' });
	} catch (e) {
		// Ignore errors
	}

	connection = null;
	console.log('Test validator stopped');
}

/**
 * Get the connection to the test validator
 */
export function getConnection(): Connection {
	if (!connection) {
		throw new Error('Validator not started. Call startValidator() first.');
	}
	return connection;
}

/**
 * Create a new keypair and fund it with SOL via airdrop
 */
export async function createFundedPayer(
	lamports: number = 10 * LAMPORTS_PER_SOL
): Promise<Keypair> {
	const conn = getConnection();
	const payer = Keypair.generate();

	const airdropSignature = await conn.requestAirdrop(payer.publicKey, lamports);
	await conn.confirmTransaction(airdropSignature, 'confirmed');

	return payer;
}

/**
 * Create multiple funded payers
 */
export async function createFundedPlayers(
	count: number,
	lamportsEach: number = 10 * LAMPORTS_PER_SOL
): Promise<Keypair[]> {
	const players: Keypair[] = [];
	for (let i = 0; i < count; i++) {
		const player = await createFundedPayer(lamportsEach);
		players.push(player);
	}
	return players;
}

/**
 * Wait for a specific number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
