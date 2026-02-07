/**
 * compare.js
 *
 * Orchestrator for the visual comparison harness.
 * Takes .puml files, runs both PlantUML and the converter,
 * exports both to PNG, and calls the vision comparison.
 *
 * Usage:
 *   node harness/compare.js [options] [puml-files...]
 *
 * Options:
 *   --type <type>       Diagram type for test discovery (default: sequence)
 *   --output-dir <dir>  Output directory (default: outputs/)
 *   --no-vision         Skip vision comparison (just generate PNGs)
 *   --verbose           Show detailed output
 *
 * If no puml files are specified, discovers all .puml files under tests/<type>/.
 *
 * Environment:
 *   PLANTUML_JAR   - Path to PlantUML jar (default: auto-detect from build/libs/)
 *   DRAWIO_CMD     - Path to draw.io executable (passed through to export-drawio.sh)
 *   ANTHROPIC_API_KEY - Required for vision comparison
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, renameSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join, basename, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { convert } from '../PlantUmlImporter.js';
import { compareImages } from './vision-compare.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PROJECT_ROOT, '..');

// ── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
	const args = {
		type: 'sequence',
		outputDir: join(PROJECT_ROOT, 'outputs'),
		vision: true,
		verbose: false,
		files: [],
	};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		if (arg === '--type' && i + 1 < argv.length) {
			args.type = argv[++i];
		} else if (arg === '--output-dir' && i + 1 < argv.length) {
			args.outputDir = resolve(argv[++i]);
		} else if (arg === '--no-vision') {
			args.vision = false;
		} else if (arg === '--verbose') {
			args.verbose = true;
		} else if (arg.startsWith('--')) {
			console.error(`Unknown option: ${arg}`);
			process.exit(1);
		} else {
			args.files.push(resolve(arg));
		}
		i++;
	}

	return args;
}

// ── PlantUML jar discovery ─────────────────────────────────────────────────

function findPlantUmlJar() {
	if (process.env.PLANTUML_JAR) {
		const jarPath = process.env.PLANTUML_JAR;
		if (existsSync(jarPath)) return jarPath;
		throw new Error(`PLANTUML_JAR not found: ${jarPath}`);
	}

	const libsDir = join(REPO_ROOT, 'build', 'libs');
	if (existsSync(libsDir)) {
		const jars = readdirSync(libsDir).filter((f) => f.startsWith('plantuml-') && f.endsWith('.jar'));
		if (jars.length > 0) {
			// Pick the latest by name (they include version numbers)
			jars.sort();
			return join(libsDir, jars[jars.length - 1]);
		}
	}

	throw new Error(
		'PlantUML jar not found. Either:\n' +
		'  - Run ./gradlew jar to build it\n' +
		'  - Set PLANTUML_JAR environment variable'
	);
}

// ── Test file discovery ────────────────────────────────────────────────────

function discoverPumlFiles(type) {
	const testsDir = join(PROJECT_ROOT, 'tests', type);
	if (!existsSync(testsDir)) {
		throw new Error(`Tests directory not found: ${testsDir}`);
	}

	const files = [];

	function walk(dir) {
		for (const entry of readdirSync(dir)) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				walk(fullPath);
			} else if (entry.endsWith('.puml')) {
				files.push(fullPath);
			}
		}
	}

	walk(testsDir);
	files.sort();
	return files;
}

// ── Test case name derivation ──────────────────────────────────────────────

function deriveTestName(pumlPath, type) {
	const testsDir = join(PROJECT_ROOT, 'tests', type);
	const rel = relative(testsDir, pumlPath);
	// e.g. "cases/sample-simple.puml" → "cases--sample-simple"
	return rel.replace(/\.puml$/, '').replace(/[/\\]/g, '--');
}

// ── Pipeline steps ─────────────────────────────────────────────────────────

function runConverter(pumlText, drawioOutputPath) {
	const result = convert(pumlText);
	mkdirSync(dirname(drawioOutputPath), { recursive: true });
	writeFileSync(drawioOutputPath, result.xml);
	return result;
}

function runDrawioExport(drawioPath, pngOutputPath) {
	const exportScript = join(__dirname, 'export-drawio.sh');
	mkdirSync(dirname(pngOutputPath), { recursive: true });

	try {
		execSync(`"${exportScript}" "${drawioPath}" "${pngOutputPath}"`, {
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 30000,
		});
	} catch (err) {
		const stderr = err.stderr?.toString() || '';
		throw new Error(`draw.io export failed: ${stderr || err.message}`);
	}

	if (!existsSync(pngOutputPath)) {
		throw new Error(`draw.io export produced no output: ${pngOutputPath}`);
	}
}

// ── Main orchestrator ──────────────────────────────────────────────────────

async function processTestCase(pumlPath, args, jarPath) {
	const testName = deriveTestName(pumlPath, args.type);
	const typeOutputDir = join(args.outputDir, args.type);
	const log = args.verbose ? console.log : () => {};

	log(`\n  Processing: ${testName}`);

	const result = {
		name: testName,
		pumlPath: pumlPath,
		steps: {},
		report: null,
		error: null,
	};

	try {
		// 1. Read the .puml file
		const pumlText = readFileSync(pumlPath, 'utf-8');

		// 2. Run our converter → .drawio
		const drawioPath = join(typeOutputDir, `${testName}.drawio`);
		log(`    [1/4] Converting to .drawio ...`);
		runConverter(pumlText, drawioPath);
		result.steps.convert = 'ok';
		log(`    [1/4] Done: ${relative(PROJECT_ROOT, drawioPath)}`);

		// 3. Export .drawio → PNG (candidate)
		const candidatePath = join(typeOutputDir, `${testName}-candidate.png`);
		log(`    [2/4] Exporting draw.io to PNG ...`);
		runDrawioExport(drawioPath, candidatePath);
		result.steps.drawioExport = 'ok';
		log(`    [2/4] Done: ${relative(PROJECT_ROOT, candidatePath)}`);

		// 4. Run PlantUML → PNG (reference)
		const referencePath = join(typeOutputDir, `${testName}-reference.png`);
		log(`    [3/4] Generating PlantUML reference PNG ...`);
		await runPlantUmlAsync(pumlPath, referencePath, jarPath);
		result.steps.plantumlExport = 'ok';
		log(`    [3/4] Done: ${relative(PROJECT_ROOT, referencePath)}`);

		// 5. Vision comparison (if enabled)
		if (args.vision) {
			log(`    [4/4] Running vision comparison ...`);
			const report = await compareImages(referencePath, candidatePath);
			result.report = report;
			result.steps.visionCompare = 'ok';

			// Write individual report
			const reportPath = join(typeOutputDir, `${testName}-report.json`);
			writeFileSync(reportPath, JSON.stringify(report, null, 2));
			log(`    [4/4] Done: score=${report.score}`);
		} else {
			log(`    [4/4] Skipped (--no-vision)`);
			result.steps.visionCompare = 'skipped';
		}
	} catch (err) {
		result.error = err.message;
		log(`    ERROR: ${err.message}`);
	}

	return result;
}

/**
 * Async wrapper for PlantUML execution to handle the rename logic.
 */
async function runPlantUmlAsync(pumlPath, pngOutputPath, jarPath) {
	mkdirSync(dirname(pngOutputPath), { recursive: true });

	try {
		execSync(`java -jar "${jarPath}" -tpng -o "${dirname(pngOutputPath)}" "${pumlPath}"`, {
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 30000,
		});
	} catch (err) {
		const stderr = err.stderr?.toString() || '';
		throw new Error(`PlantUML export failed: ${stderr || err.message}`);
	}

	// PlantUML outputs with the input file's basename
	const expectedName = basename(pumlPath, '.puml') + '.png';
	const actualPath = join(dirname(pngOutputPath), expectedName);

	if (actualPath !== pngOutputPath && existsSync(actualPath)) {
		renameSync(actualPath, pngOutputPath);
	}

	if (!existsSync(pngOutputPath)) {
		throw new Error(`PlantUML export produced no output at: ${pngOutputPath}`);
	}
}

// ── Summary formatting ─────────────────────────────────────────────────────

function printSummary(results) {
	console.log('\n' + '='.repeat(70));
	console.log('COMPARISON RESULTS');
	console.log('='.repeat(70));

	let passCount = 0;
	let needsWorkCount = 0;
	let failCount = 0;
	let errorCount = 0;
	let skippedCount = 0;

	for (const r of results) {
		let status;
		if (r.error) {
			status = 'ERROR';
			errorCount++;
		} else if (r.report === null) {
			status = 'SKIP';
			skippedCount++;
		} else if (r.report.score === 'pass') {
			status = 'PASS';
			passCount++;
		} else if (r.report.score === 'needs_work') {
			status = 'WARN';
			needsWorkCount++;
		} else if (r.report.score === 'fail') {
			status = 'FAIL';
			failCount++;
		} else {
			status = r.report.score?.toUpperCase() || 'UNKNOWN';
			errorCount++;
		}

		const statusPad = status.padEnd(5);
		console.log(`  [${statusPad}] ${r.name}`);

		if (r.error) {
			console.log(`          ${r.error}`);
		} else if (r.report) {
			const b = r.report.blocking?.length || 0;
			const i = r.report.important?.length || 0;
			const c = r.report.cosmetic?.length || 0;
			console.log(`          blocking: ${b}  important: ${i}  cosmetic: ${c}`);
			if (r.report.summary) {
				console.log(`          ${r.report.summary}`);
			}
		}
	}

	console.log('\n' + '-'.repeat(70));
	const total = results.length;
	console.log(`Total: ${total}  Pass: ${passCount}  Warn: ${needsWorkCount}  Fail: ${failCount}  Error: ${errorCount}  Skip: ${skippedCount}`);
	console.log('='.repeat(70));

	return { total, pass: passCount, needsWork: needsWorkCount, fail: failCount, error: errorCount, skipped: skippedCount };
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
	const args = parseArgs(process.argv.slice(2));

	console.log(`PlantUML to draw.io — Visual Comparison Harness`);
	console.log(`  Diagram type: ${args.type}`);
	console.log(`  Output dir:   ${relative(PROJECT_ROOT, args.outputDir) || args.outputDir}`);
	console.log(`  Vision:       ${args.vision ? 'enabled' : 'disabled'}`);

	// Find PlantUML jar
	const jarPath = findPlantUmlJar();
	console.log(`  PlantUML jar: ${relative(REPO_ROOT, jarPath)}`);

	// Discover or use provided files
	let pumlFiles;
	if (args.files.length > 0) {
		pumlFiles = args.files;
	} else {
		pumlFiles = discoverPumlFiles(args.type);
	}

	if (pumlFiles.length === 0) {
		console.error('No .puml files found.');
		process.exit(1);
	}

	console.log(`  Test cases:   ${pumlFiles.length}`);
	console.log('');

	// Process each test case sequentially
	const results = [];
	for (const pumlPath of pumlFiles) {
		const result = await processTestCase(pumlPath, args, jarPath);
		results.push(result);
	}

	// Print summary
	const summary = printSummary(results);

	// Write summary report
	const reportsDir = join(args.outputDir, 'reports');
	mkdirSync(reportsDir, { recursive: true });

	const summaryReport = {
		timestamp: new Date().toISOString(),
		diagramType: args.type,
		visionEnabled: args.vision,
		counts: summary,
		results: results.map((r) => ({
			name: r.name,
			score: r.report?.score || (r.error ? 'error' : 'skipped'),
			blocking: r.report?.blocking?.length || 0,
			important: r.report?.important?.length || 0,
			cosmetic: r.report?.cosmetic?.length || 0,
			summary: r.report?.summary || r.error || null,
		})),
	};

	const summaryPath = join(reportsDir, 'summary.json');
	writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
	console.log(`\nSummary written to: ${relative(PROJECT_ROOT, summaryPath)}`);
}

main().catch((err) => {
	console.error(`Fatal: ${err.message}`);
	if (err.stack) {
		console.error(err.stack);
	}
	process.exit(1);
});
