/**
 * iteration-log.js
 *
 * Appends a single iteration record to outputs/reports/iteration-log.json.
 * Called by Claude Code after each harness run to build an audit trail
 * that persists across sessions.
 *
 * Usage:
 *   node harness/iteration-log.js [--iteration N] [--description "text"]
 *
 * Options:
 *   --iteration N        Iteration number (default: auto-increment)
 *   --description "text" Brief description of what changed this iteration
 *   --summary-file path  Path to summary.json (default: outputs/reports/summary.json)
 *   --reset              Start a fresh log (archives the old one)
 *
 * Environment:
 *   Reads git HEAD sha automatically.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
	const args = {
		iteration: null,
		description: '',
		summaryFile: join(PROJECT_ROOT, 'outputs', 'reports', 'summary.json'),
		reset: false,
	};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		if (arg === '--iteration' && i + 1 < argv.length) {
			args.iteration = parseInt(argv[++i], 10);
		} else if (arg === '--description' && i + 1 < argv.length) {
			args.description = argv[++i];
		} else if (arg === '--summary-file' && i + 1 < argv.length) {
			args.summaryFile = resolve(argv[++i]);
		} else if (arg === '--reset') {
			args.reset = true;
		}
		i++;
	}

	return args;
}

// ── Git sha ────────────────────────────────────────────────────────────────

function getGitSha() {
	try {
		return execSync('git rev-parse --short HEAD', {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: PROJECT_ROOT,
		}).toString().trim();
	} catch {
		return 'unknown';
	}
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
	const args = parseArgs(process.argv.slice(2));
	const logPath = join(PROJECT_ROOT, 'outputs', 'reports', 'iteration-log.json');

	mkdirSync(dirname(logPath), { recursive: true });

	// Handle reset
	if (args.reset) {
		if (existsSync(logPath)) {
			const archivePath = logPath.replace('.json', `-${Date.now()}.json`);
			renameSync(logPath, archivePath);
			console.log(`Archived previous log to: ${archivePath}`);
		}
		writeFileSync(logPath, JSON.stringify({ iterations: [] }, null, 2));
		console.log(`Fresh log created: ${logPath}`);
		return;
	}

	// Read summary
	if (!existsSync(args.summaryFile)) {
		console.error(`Summary file not found: ${args.summaryFile}`);
		console.error('Run the comparison harness first: node harness/compare.js');
		process.exit(1);
	}

	const summary = JSON.parse(readFileSync(args.summaryFile, 'utf-8'));

	// Read existing log or create new
	let log;
	if (existsSync(logPath)) {
		log = JSON.parse(readFileSync(logPath, 'utf-8'));
	} else {
		log = { iterations: [] };
	}

	// Determine iteration number
	const iteration = args.iteration || (log.iterations.length + 1);

	// Compute totals
	let blockingTotal = 0;
	let importantTotal = 0;
	for (const r of (summary.results || [])) {
		blockingTotal += r.blocking || 0;
		importantTotal += r.important || 0;
	}

	// Build record
	const record = {
		iteration: iteration,
		timestamp: new Date().toISOString(),
		gitSha: getGitSha(),
		description: args.description,
		diagramType: summary.diagramType || 'unknown',
		counts: summary.counts || {},
		results: (summary.results || []).map((r) => ({
			name: r.name,
			score: r.score,
			blocking: r.blocking || 0,
			important: r.important || 0,
			cosmetic: r.cosmetic || 0,
		})),
		blockingTotal: blockingTotal,
		importantTotal: importantTotal,
	};

	// Append
	log.iterations.push(record);
	writeFileSync(logPath, JSON.stringify(log, null, 2));

	// Print
	console.log(`Iteration ${iteration} logged:`);
	console.log(`  Git SHA:    ${record.gitSha}`);
	console.log(`  Blocking:   ${blockingTotal}`);
	console.log(`  Important:  ${importantTotal}`);
	console.log(`  Scores:     ${record.results.map((r) => `${r.name}=${r.score}`).join(', ')}`);
	if (args.description) {
		console.log(`  Description: ${args.description}`);
	}
}

main();
