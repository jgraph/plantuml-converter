/**
 * compare.js
 *
 * Orchestrator for the comparison harness.
 * Takes .puml files, runs both PlantUML and the converter,
 * and compares results structurally (SVG) and/or visually (Vision API).
 *
 * Usage:
 *   node harness/compare.js [options] [puml-files...]
 *
 * Options:
 *   --type <type>       Diagram type for test discovery (default: sequence)
 *   --output-dir <dir>  Output directory (default: outputs/)
 *   --png               Also export PNGs for visual inspection
 *   --vision            Run vision API comparison (implies --png)
 *   --no-structural     Skip structural comparison (only with --vision)
 *   --verbose           Show detailed output
 *
 * Default mode (no flags): structural comparison only. Free, deterministic.
 *
 * If no puml files are specified, discovers all .puml files under tests/<type>/.
 *
 * Environment:
 *   PLANTUML_JAR       - Path to PlantUML jar (default: auto-detect from build/libs/)
 *   DRAWIO_CMD         - Path to draw.io executable (passed through to export-drawio.sh)
 *   ANTHROPIC_API_KEY  - Required only for --vision mode
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, renameSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join, basename, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { convert } from '../PlantUmlImporter.js';
import { compareSvgToDrawio } from './svg-compare.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PROJECT_ROOT, '..');

// ── Argument parsing ───────────────────────────────────────────────────────

function parseArgs(argv) {
	const args = {
		type: 'sequence',
		outputDir: join(PROJECT_ROOT, 'outputs'),
		structural: true,
		png: false,
		vision: false,
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
		} else if (arg === '--png') {
			args.png = true;
		} else if (arg === '--vision') {
			args.vision = true;
			args.png = true; // vision implies png
		} else if (arg === '--no-structural') {
			args.structural = false;
		} else if (arg === '--no-vision') {
			// Backward compat: --no-vision is now the default
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

function runDrawioExport(drawioPath, outputPath) {
	const exportScript = join(__dirname, 'export-drawio.sh');
	mkdirSync(dirname(outputPath), { recursive: true });

	try {
		execSync(`"${exportScript}" "${drawioPath}" "${outputPath}"`, {
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 30000,
		});
	} catch (err) {
		const stderr = err.stderr?.toString() || '';
		throw new Error(`draw.io export failed: ${stderr || err.message}`);
	}

	if (!existsSync(outputPath)) {
		throw new Error(`draw.io export produced no output: ${outputPath}`);
	}
}

/**
 * Run PlantUML to generate SVG or PNG.
 * @param {string} format - 'svg' or 'png'
 */
function runPlantUml(pumlPath, outputPath, jarPath, format) {
	mkdirSync(dirname(outputPath), { recursive: true });

	const formatFlag = format === 'svg' ? '-tsvg' : '-tpng';
	try {
		execSync(`java -jar "${jarPath}" ${formatFlag} -o "${dirname(outputPath)}" "${pumlPath}"`, {
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 30000,
		});
	} catch (err) {
		const stderr = err.stderr?.toString() || '';
		throw new Error(`PlantUML export failed: ${stderr || err.message}`);
	}

	// PlantUML outputs with the input file's basename
	const ext = format === 'svg' ? '.svg' : '.png';
	const expectedName = basename(pumlPath, '.puml') + ext;
	const actualPath = join(dirname(outputPath), expectedName);

	if (actualPath !== outputPath && existsSync(actualPath)) {
		renameSync(actualPath, outputPath);
	}

	if (!existsSync(outputPath)) {
		throw new Error(`PlantUML export produced no output at: ${outputPath}`);
	}
}

// ── Main orchestrator ──────────────────────────────────────────────────────

async function processTestCase(pumlPath, args, jarPath) {
	const testName = deriveTestName(pumlPath, args.type);
	const typeOutputDir = join(args.outputDir, args.type);
	const log = args.verbose ? console.log : () => {};

	// Count total steps for progress display
	let totalSteps = 1; // convert
	if (args.structural) totalSteps += 2; // SVG gen + structural compare
	if (args.png) totalSteps += 2; // drawio export + plantuml png
	if (args.vision) totalSteps += 1; // vision compare

	log(`\n  Processing: ${testName}`);

	const result = {
		name: testName,
		pumlPath: pumlPath,
		steps: {},
		report: null,       // structural report (primary)
		visionReport: null, // vision report (secondary)
		error: null,
	};

	let step = 0;
	const logStep = (msg) => log(`    [${++step}/${totalSteps}] ${msg}`);

	try {
		// 1. Read the .puml file
		const pumlText = readFileSync(pumlPath, 'utf-8');

		// 2. Run our converter → .drawio
		const drawioPath = join(typeOutputDir, `${testName}.drawio`);
		logStep('Converting to .drawio ...');
		runConverter(pumlText, drawioPath);
		result.steps.convert = 'ok';
		log(`    [${step}/${totalSteps}] Done: ${relative(PROJECT_ROOT, drawioPath)}`);

		// 3. Structural comparison (default): .puml → SVG, then diff against .drawio XML
		if (args.structural) {
			const svgPath = join(typeOutputDir, `${testName}-reference.svg`);
			logStep('Generating PlantUML reference SVG ...');
			runPlantUml(pumlPath, svgPath, jarPath, 'svg');
			result.steps.plantumlSvg = 'ok';
			log(`    [${step}/${totalSteps}] Done: ${relative(PROJECT_ROOT, svgPath)}`);

			logStep('Running structural comparison ...');
			const svgText = readFileSync(svgPath, 'utf-8');
			const drawioXml = readFileSync(drawioPath, 'utf-8');
			const report = compareSvgToDrawio(svgText, drawioXml, args.type);
			result.report = report;
			result.steps.structural = 'ok';

			// Write individual report
			const reportPath = join(typeOutputDir, `${testName}-report.json`);
			writeFileSync(reportPath, JSON.stringify(report, null, 2));
			log(`    [${step}/${totalSteps}] Done: score=${report.score}`);
		}

		// 4. PNG exports (for visual inspection or vision comparison)
		if (args.png) {
			const candidatePath = join(typeOutputDir, `${testName}-candidate.png`);
			logStep('Exporting draw.io to PNG ...');
			runDrawioExport(drawioPath, candidatePath);
			result.steps.drawioExport = 'ok';
			log(`    [${step}/${totalSteps}] Done: ${relative(PROJECT_ROOT, candidatePath)}`);

			const referencePngPath = join(typeOutputDir, `${testName}-reference.png`);
			logStep('Generating PlantUML reference PNG ...');
			runPlantUml(pumlPath, referencePngPath, jarPath, 'png');
			result.steps.plantumlPng = 'ok';
			log(`    [${step}/${totalSteps}] Done: ${relative(PROJECT_ROOT, referencePngPath)}`);

			// 5. Vision comparison (if enabled)
			if (args.vision) {
				logStep('Running vision comparison ...');
				// Lazy-import vision-compare since it's only needed in this mode
				const { compareImages } = await import('./vision-compare.js');
				const visionReport = await compareImages(referencePngPath, candidatePath);
				result.visionReport = visionReport;
				result.steps.visionCompare = 'ok';

				const visionReportPath = join(typeOutputDir, `${testName}-vision-report.json`);
				writeFileSync(visionReportPath, JSON.stringify(visionReport, null, 2));
				log(`    [${step}/${totalSteps}] Done: vision score=${visionReport.score}`);
			}
		}
	} catch (err) {
		result.error = err.message;
		log(`    ERROR: ${err.message}`);
	}

	return result;
}

// ── Summary formatting ─────────────────────────────────────────────────────

function printSummary(results, args) {
	console.log('\n' + '='.repeat(70));
	console.log('COMPARISON RESULTS');
	if (args.structural && !args.vision) {
		console.log('  Mode: structural (SVG-based, deterministic)');
	} else if (args.vision && !args.structural) {
		console.log('  Mode: vision (Anthropic API)');
	} else if (args.vision && args.structural) {
		console.log('  Mode: structural + vision');
	}
	console.log('='.repeat(70));

	let passCount = 0;
	let needsWorkCount = 0;
	let failCount = 0;
	let errorCount = 0;
	let skippedCount = 0;

	for (const r of results) {
		// Use structural report as primary score
		const report = r.report || r.visionReport;
		let status;
		if (r.error) {
			status = 'ERROR';
			errorCount++;
		} else if (report === null) {
			status = 'SKIP';
			skippedCount++;
		} else if (report.score === 'pass') {
			status = 'PASS';
			passCount++;
		} else if (report.score === 'needs_work') {
			status = 'WARN';
			needsWorkCount++;
		} else if (report.score === 'fail') {
			status = 'FAIL';
			failCount++;
		} else {
			status = report.score?.toUpperCase() || 'UNKNOWN';
			errorCount++;
		}

		const statusPad = status.padEnd(5);
		console.log(`  [${statusPad}] ${r.name}`);

		if (r.error) {
			console.log(`          ${r.error}`);
		} else if (report) {
			const b = report.blocking?.length || 0;
			const i = report.important?.length || 0;
			const c = report.cosmetic?.length || 0;
			console.log(`          blocking: ${b}  important: ${i}  cosmetic: ${c}`);
			if (report.summary) {
				console.log(`          ${report.summary}`);
			}
		}

		// Show vision report alongside if both modes active
		if (r.visionReport && r.report) {
			console.log(`          [vision] score=${r.visionReport.score}`);
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

	const modes = [];
	if (args.structural) modes.push('structural');
	if (args.png) modes.push('png');
	if (args.vision) modes.push('vision');

	console.log(`PlantUML to draw.io — Comparison Harness`);
	console.log(`  Diagram type: ${args.type}`);
	console.log(`  Output dir:   ${relative(PROJECT_ROOT, args.outputDir) || args.outputDir}`);
	console.log(`  Mode:         ${modes.join(' + ') || 'none'}`);

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
	const summary = printSummary(results, args);

	// Write summary report
	const reportsDir = join(args.outputDir, 'reports');
	mkdirSync(reportsDir, { recursive: true });

	const summaryReport = {
		timestamp: new Date().toISOString(),
		diagramType: args.type,
		mode: modes.join('+'),
		counts: summary,
		results: results.map((r) => {
			const report = r.report || r.visionReport;
			return {
				name: r.name,
				score: report?.score || (r.error ? 'error' : 'skipped'),
				blocking: report?.blocking?.length || 0,
				important: report?.important?.length || 0,
				cosmetic: report?.cosmetic?.length || 0,
				summary: report?.summary || r.error || null,
			};
		}),
	};

	const summaryPath = join(reportsDir, 'summary.json');
	writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2));
	console.log(`\nSummary written to: ${relative(PROJECT_ROOT, summaryPath)}`);

	// Exit code signals result to callers (e.g. fix loop)
	// 0 = all pass, 2 = blocking issues, 3 = important issues only
	if (summary.fail > 0 || summary.error > 0) {
		process.exit(2);
	} else if (summary.needsWork > 0) {
		process.exit(3);
	}
}

main().catch((err) => {
	console.error(`Fatal: ${err.message}`);
	if (err.stack) {
		console.error(err.stack);
	}
	process.exit(1);
});
