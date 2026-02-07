/**
 * svg-compare.js
 *
 * Structural comparison between a PlantUML SVG (reference) and
 * a draw.io XML file (candidate). Extracts normalized diagrams
 * from both, matches elements, and produces a diff report.
 *
 * CLI usage:
 *   node harness/svg-compare.js <reference.svg> <candidate.drawio>
 *
 * Programmatic usage:
 *   import { compareSvgToDrawio } from './svg-compare.js';
 *   const report = compareSvgToDrawio(svgText, drawioXmlText);
 */

import { readFileSync } from 'fs';
import { extractFromPlantUmlSvg } from './extract-plantuml-svg.js';
import { extractFromDrawioXml } from './extract-drawio-xml.js';
import { matchDiagrams, diffDiagrams, buildReport } from './normalize.js';

/**
 * Compare a PlantUML SVG (reference) against a draw.io XML (candidate).
 * Returns a report object: { blocking, important, cosmetic, summary, score }
 */
export function compareSvgToDrawio(svgText, drawioXmlText) {
	const refDiagram = extractFromPlantUmlSvg(svgText);
	const candDiagram = extractFromDrawioXml(drawioXmlText);
	const matches = matchDiagrams(refDiagram, candDiagram);
	const diff = diffDiagrams(matches);
	return buildReport(diff, refDiagram, candDiagram);
}

/**
 * Compare files by path.
 */
export function compareSvgToDrawioFiles(svgPath, drawioPath) {
	const svgText = readFileSync(svgPath, 'utf-8');
	const drawioXmlText = readFileSync(drawioPath, 'utf-8');
	return compareSvgToDrawio(svgText, drawioXmlText);
}

// ── CLI mode ──────────────────────────────────────────────────────────────

const isMain = process.argv[1] && (
	process.argv[1].endsWith('svg-compare.js') ||
	process.argv[1].endsWith('svg-compare')
);

if (isMain) {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.error('Usage: node harness/svg-compare.js <reference.svg> <candidate.drawio>');
		console.error('');
		console.error('Compares a PlantUML SVG against a draw.io XML structurally.');
		console.error('Output: JSON report to stdout.');
		process.exit(1);
	}

	const svgPath = args[0];
	const drawioPath = args[1];
	const verbose = args.includes('--verbose');

	try {
		const report = compareSvgToDrawioFiles(svgPath, drawioPath);

		if (verbose) {
			// Also show extracted diagrams for debugging
			const svgText = readFileSync(svgPath, 'utf-8');
			const drawioXmlText = readFileSync(drawioPath, 'utf-8');
			const ref = extractFromPlantUmlSvg(svgText);
			const cand = extractFromDrawioXml(drawioXmlText);

			console.error('── Reference (PlantUML SVG) ──');
			console.error(`  Participants (${ref.participants.length}): ${ref.participants.map(p => p.name).join(', ')}`);
			console.error(`  Messages (${ref.messages.length}): ${ref.messages.map(m => `${m.from}→${m.to}: ${m.label}`).join(', ')}`);
			console.error(`  Activations: ${ref.activations.length}`);
			console.error(`  Fragments: ${ref.fragments.length}`);
			console.error(`  Notes: ${ref.notes.length}`);
			console.error(`  Dividers: ${ref.dividers.length}`);
			console.error('');
			console.error('── Candidate (draw.io XML) ──');
			console.error(`  Participants (${cand.participants.length}): ${cand.participants.map(p => p.name).join(', ')}`);
			console.error(`  Messages (${cand.messages.length}): ${cand.messages.map(m => `${m.from}→${m.to}: ${m.label}`).join(', ')}`);
			console.error(`  Activations: ${cand.activations.length}`);
			console.error(`  Fragments: ${cand.fragments.length}`);
			console.error(`  Notes: ${cand.notes.length}`);
			console.error(`  Dividers: ${cand.dividers.length}`);
			console.error('');
		}

		console.log(JSON.stringify(report, null, 2));

		// Exit code based on score
		if (report.score === 'fail') {
			process.exit(2);
		} else if (report.score === 'needs_work') {
			process.exit(3);
		}
		process.exit(0);
	} catch (err) {
		console.error('Error:', err.message);
		process.exit(1);
	}
}
