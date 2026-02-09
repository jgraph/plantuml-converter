/**
 * svg-compare.js
 *
 * Structural comparison between a PlantUML SVG (reference) and
 * a draw.io XML file (candidate). Extracts normalized diagrams
 * from both, matches elements, and produces a diff report.
 *
 * Supports multiple diagram types via type-specific extractors.
 *
 * CLI usage:
 *   node harness/svg-compare.js <reference.svg> <candidate.drawio> [--type sequence|class|usecase]
 *
 * Programmatic usage:
 *   import { compareSvgToDrawio } from './svg-compare.js';
 *   const report = compareSvgToDrawio(svgText, drawioXmlText, 'class');
 */

import { readFileSync } from 'fs';

// ── Sequence diagram extractors (default) ────────────────────────────────
import { extractFromPlantUmlSvg as extractSeqFromSvg } from './extract-plantuml-svg-sequence.js';
import { extractFromDrawioXml as extractSeqFromDrawio } from './extract-drawio-xml-sequence.js';
import { matchDiagrams as matchSeq, diffDiagrams as diffSeq, buildReport as buildSeqReport } from './normalize-sequence.js';

// ── Class diagram extractors ─────────────────────────────────────────────
import { extractFromPlantUmlSvg as extractClassFromSvg } from './extract-plantuml-svg-class.js';
import { extractFromDrawioXml as extractClassFromDrawio } from './extract-drawio-xml-class.js';
import { matchDiagrams as matchClass, diffDiagrams as diffClass, buildReport as buildClassReport } from './normalize-class.js';

// ── Usecase diagram extractors ──────────────────────────────────────────
import { extractFromPlantUmlSvg as extractUsecaseFromSvg } from './extract-plantuml-svg-usecase.js';
import { extractFromDrawioXml as extractUsecaseFromDrawio } from './extract-drawio-xml-usecase.js';
import { matchDiagrams as matchUsecase, diffDiagrams as diffUsecase, buildReport as buildUsecaseReport } from './normalize-usecase.js';

// ── Component diagram extractors ────────────────────────────────────────
import { extractFromPlantUmlSvg as extractComponentFromSvg } from './extract-plantuml-svg-component.js';
import { extractFromDrawioXml as extractComponentFromDrawio } from './extract-drawio-xml-component.js';
import { matchDiagrams as matchComponent, diffDiagrams as diffComponent, buildReport as buildComponentReport } from './normalize-component.js';

// ── State diagram extractors ───────────────────────────────────────────
import { extractFromPlantUmlSvg as extractStateFromSvg } from './extract-plantuml-svg-state.js';
import { extractFromDrawioXml as extractStateFromDrawio } from './extract-drawio-xml-state.js';
import { matchDiagrams as matchState, diffDiagrams as diffState, buildReport as buildStateReport } from './normalize-state.js';

// ── Extractor registry ────────────────────────────────────────────────────

const extractors = {
	sequence: {
		extractFromSvg: extractSeqFromSvg,
		extractFromDrawio: extractSeqFromDrawio,
		match: matchSeq,
		diff: diffSeq,
		buildReport: buildSeqReport,
	},
	class: {
		extractFromSvg: extractClassFromSvg,
		extractFromDrawio: extractClassFromDrawio,
		match: matchClass,
		diff: diffClass,
		buildReport: buildClassReport,
	},
	usecase: {
		extractFromSvg: extractUsecaseFromSvg,
		extractFromDrawio: extractUsecaseFromDrawio,
		match: matchUsecase,
		diff: diffUsecase,
		buildReport: buildUsecaseReport,
	},
	component: {
		extractFromSvg: extractComponentFromSvg,
		extractFromDrawio: extractComponentFromDrawio,
		match: matchComponent,
		diff: diffComponent,
		buildReport: buildComponentReport,
	},
	state: {
		extractFromSvg: extractStateFromSvg,
		extractFromDrawio: extractStateFromDrawio,
		match: matchState,
		diff: diffState,
		buildReport: buildStateReport,
	},
};

/**
 * Compare a PlantUML SVG (reference) against a draw.io XML (candidate).
 * Returns a report object: { blocking, important, cosmetic, summary, score }
 *
 * @param {string} svgText - PlantUML SVG content
 * @param {string} drawioXmlText - draw.io XML content
 * @param {string} [diagramType='sequence'] - Diagram type for extractor selection
 */
export function compareSvgToDrawio(svgText, drawioXmlText, diagramType) {
	const type = diagramType || 'sequence';
	const ext = extractors[type];

	if (!ext) {
		throw new Error(`No structural extractors for diagram type: ${type}. Supported: ${Object.keys(extractors).join(', ')}`);
	}

	const refDiagram = ext.extractFromSvg(svgText);
	const candDiagram = ext.extractFromDrawio(drawioXmlText);
	const matches = ext.match(refDiagram, candDiagram);
	const diff = ext.diff(matches);
	return ext.buildReport(diff, refDiagram, candDiagram);
}

/**
 * Compare files by path.
 */
export function compareSvgToDrawioFiles(svgPath, drawioPath, diagramType) {
	const svgText = readFileSync(svgPath, 'utf-8');
	const drawioXmlText = readFileSync(drawioPath, 'utf-8');
	return compareSvgToDrawio(svgText, drawioXmlText, diagramType);
}

// ── CLI mode ──────────────────────────────────────────────────────────────

const isMain = process.argv[1] && (
	process.argv[1].endsWith('svg-compare.js') ||
	process.argv[1].endsWith('svg-compare')
);

if (isMain) {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.error('Usage: node harness/svg-compare.js <reference.svg> <candidate.drawio> [--type sequence|class|usecase|component|state]');
		console.error('');
		console.error('Compares a PlantUML SVG against a draw.io XML structurally.');
		console.error('Output: JSON report to stdout.');
		process.exit(1);
	}

	const svgPath = args[0];
	const drawioPath = args[1];
	const verbose = args.includes('--verbose');

	let diagramType = 'sequence';
	const typeIdx = args.indexOf('--type');
	if (typeIdx >= 0 && typeIdx + 1 < args.length) {
		diagramType = args[typeIdx + 1];
	}

	try {
		const report = compareSvgToDrawioFiles(svgPath, drawioPath, diagramType);

		if (verbose) {
			const ext = extractors[diagramType];
			const svgText = readFileSync(svgPath, 'utf-8');
			const drawioXmlText = readFileSync(drawioPath, 'utf-8');
			const ref = ext.extractFromSvg(svgText);
			const cand = ext.extractFromDrawio(drawioXmlText);

			if (diagramType === 'sequence') {
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
			} else if (diagramType === 'class') {
				console.error('── Reference (PlantUML SVG) ──');
				console.error(`  Classes (${ref.classes.length}): ${ref.classes.map(c => c.name).join(', ')}`);
				console.error(`  Relationships: ${ref.relationships.length}`);
				console.error(`  Notes: ${ref.notes.length}`);
				console.error('');
				console.error('── Candidate (draw.io XML) ──');
				console.error(`  Classes (${cand.classes.length}): ${cand.classes.map(c => c.name).join(', ')}`);
				console.error(`  Relationships: ${cand.relationships.length}`);
				console.error(`  Notes: ${cand.notes.length}`);
			} else if (diagramType === 'usecase') {
				console.error('── Reference (PlantUML SVG) ──');
				console.error(`  Actors (${ref.actors.length}): ${ref.actors.map(a => a.name).join(', ')}`);
				console.error(`  Usecases (${ref.usecases.length}): ${ref.usecases.map(u => u.name).join(', ')}`);
				console.error(`  Containers: ${ref.containers.length}`);
				console.error(`  Relationships: ${ref.relationships.length}`);
				console.error(`  Notes: ${ref.notes.length}`);
				console.error('');
				console.error('── Candidate (draw.io XML) ──');
				console.error(`  Actors (${cand.actors.length}): ${cand.actors.map(a => a.name).join(', ')}`);
				console.error(`  Usecases (${cand.usecases.length}): ${cand.usecases.map(u => u.name).join(', ')}`);
				console.error(`  Containers: ${cand.containers.length}`);
				console.error(`  Relationships: ${cand.relationships.length}`);
				console.error(`  Notes: ${cand.notes.length}`);
			} else if (diagramType === 'component') {
				console.error('── Reference (PlantUML SVG) ──');
				console.error(`  Elements (${ref.elements.length}): ${ref.elements.map(e => `${e.name}[${e.type}]`).join(', ')}`);
				console.error(`  Containers: ${ref.containers.length}`);
				console.error(`  Relationships: ${ref.relationships.length}`);
				console.error(`  Notes: ${ref.notes.length}`);
				console.error('');
				console.error('── Candidate (draw.io XML) ──');
				console.error(`  Elements (${cand.elements.length}): ${cand.elements.map(e => `${e.name}[${e.type}]`).join(', ')}`);
				console.error(`  Containers: ${cand.containers.length}`);
				console.error(`  Relationships: ${cand.relationships.length}`);
				console.error(`  Notes: ${cand.notes.length}`);
			} else if (diagramType === 'state') {
				console.error('── Reference (PlantUML SVG) ──');
				console.error(`  States (${ref.states.length}): ${ref.states.map(s => `${s.name}[${s.type}]`).join(', ')}`);
				console.error(`  Composites: ${ref.composites.length}`);
				console.error(`  Transitions: ${ref.transitions.length}`);
				console.error(`  Notes: ${ref.notes.length}`);
				console.error('');
				console.error('── Candidate (draw.io XML) ──');
				console.error(`  States (${cand.states.length}): ${cand.states.map(s => `${s.name}[${s.type}]`).join(', ')}`);
				console.error(`  Composites: ${cand.composites.length}`);
				console.error(`  Transitions: ${cand.transitions.length}`);
				console.error(`  Notes: ${cand.notes.length}`);
			}
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
