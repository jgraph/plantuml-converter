/**
 * PlantUmlImporter.js
 *
 * Main entry point for the PlantUML-to-draw.io converter.
 *
 * Provides:
 *   - Diagram type detection
 *   - A registry of diagram type handlers (parser + emitter pairs)
 *   - The top-level convert() function
 *   - UserObject/group wrapping with embedded PlantUML source
 *   - Re-generate support
 *
 * Currently supports:
 *   - Class diagrams
 *   - Usecase diagrams
 *   - Sequence diagrams
 *
 * Designed to be extended with additional diagram types (class, activity,
 * component, etc.) by registering new handler entries.
 */

import { parseSequenceDiagram } from './diagrams/sequence/SequenceParser.js';
import { emitSequenceDiagram } from './diagrams/sequence/SequenceEmitter.js';
import { parseClassDiagram } from './diagrams/class/ClassParser.js';
import { emitClassDiagram } from './diagrams/class/ClassEmitter.js';
import { parseUsecaseDiagram } from './diagrams/usecase/UsecaseParser.js';
import { emitUsecaseDiagram } from './diagrams/usecase/UsecaseEmitter.js';
import { buildUserObject, buildDocument, createIdGenerator } from './MxBuilder.js';

// ── Diagram type registry ──────────────────────────────────────────────────

/**
 * Each entry maps a diagram type key to a { detect, parse, emit } object.
 *
 *   detect(text) → boolean    Does this text look like this diagram type?
 *   parse(text)  → model      Parse text into a diagram model
 *   emit(model, parentId) → string[]  Emit model to mxGraph cell XML strings
 */
const diagramHandlers = new Map();

// Register class diagram handler (before sequence — sequence's heuristic is broad
// and would match class diagrams with arrows like -->)
diagramHandlers.set('class', {
	detect(text) {
		// Explicit @startclass
		if (/@startclass\b/i.test(text)) return true;

		const lines = text.split('\n');
		let classKeywords = 0;
		let classRelationships = 0;

		for (const line of lines) {
			const trimmed = line.trim();
			// Class/interface/enum/abstract/object/map/json declarations
			if (/^(?:abstract\s+class|class|interface|enum|annotation|entity|struct|record|object|map|json)\s+/i.test(trimmed)) {
				classKeywords++;
			}
			// Class-specific relationship patterns: <|--, *--, o--, ..|>, <|..
			if (/(?:<\|--|--\|>|\*--|--\*|o--|--o|<\|\.\.|\.\.?\|>)/.test(trimmed)) {
				classRelationships++;
			}
		}

		return classKeywords >= 2 || (classKeywords >= 1 && classRelationships >= 1);
	},
	parse: parseClassDiagram,
	emit: emitClassDiagram
});

// Register usecase diagram handler (before sequence — sequence's heuristic is broad
// and would match usecase diagrams with arrows like -->)
diagramHandlers.set('usecase', {
	detect(text) {
		// Explicit @startusecase
		if (/@startusecase\b/i.test(text)) return true;

		const lines = text.split('\n');
		let usecaseKeywords = 0;
		let actorShorthand = 0;
		let usecaseShorthand = 0;

		for (const line of lines) {
			const trimmed = line.trim();
			// usecase-specific keywords (but not "actor" alone — shared with sequence)
			if (/^usecase\s+/i.test(trimmed)) usecaseKeywords++;
			// Actor shorthand: :Name:
			if (/^:[^:]+:/.test(trimmed)) actorShorthand++;
			// Usecase shorthand: (Name) — but not just "()" or known non-usecase patterns
			if (/^\([^)]+\)/.test(trimmed)) usecaseShorthand++;
			// "actor" keyword with usecase-style elements nearby
			if (/^actor\s+/i.test(trimmed)) usecaseKeywords++;
		}

		// Need at least one usecase keyword or both shorthand forms present
		return usecaseKeywords >= 2 ||
			(usecaseKeywords >= 1 && (actorShorthand >= 1 || usecaseShorthand >= 1)) ||
			(actorShorthand >= 1 && usecaseShorthand >= 1);
	},
	parse: parseUsecaseDiagram,
	emit: emitUsecaseDiagram
});

// Register sequence diagram handler
diagramHandlers.set('sequence', {
	detect(text) {
		// Explicit @startsequence
		if (/@startsequence\b/i.test(text)) return true;

		// Heuristic: look for arrow patterns common to sequence diagrams
		// (participant declarations, -> arrows, activate/deactivate)
		const lines = text.split('\n');
		let arrowCount = 0;
		let seqKeywords = 0;

		for (const line of lines) {
			const trimmed = line.trim();
			// Arrow pattern: something -> something
			if (/[\w.@"]+\s*-+[>|<\]}\[{]/.test(trimmed)) arrowCount++;
			// Sequence-specific keywords
			if (/^(participant|actor|activate|deactivate|destroy|alt|loop|opt|return)\b/i.test(trimmed)) seqKeywords++;
		}

		return arrowCount >= 1 || seqKeywords >= 1;
	},
	parse: parseSequenceDiagram,
	emit: emitSequenceDiagram
});

// ── Type detection ─────────────────────────────────────────────────────────

/**
 * Detect the diagram type from PlantUML text.
 * Returns the handler key or null if unrecognised.
 *
 * @param {string} text - Raw PlantUML text
 * @returns {string|null}
 */
export function detectDiagramType(text) {
	for (const [key, handler] of diagramHandlers) {
		if (handler.detect(text)) return key;
	}
	return null;
}

// ── Main API ───────────────────────────────────────────────────────────────

/**
 * Convert PlantUML text to draw.io XML.
 *
 * Returns the complete mxfile XML document containing a single diagram
 * with all shapes wrapped in a locked UserObject group that embeds
 * the original PlantUML source.
 *
 * @param {string} plantUmlText - Raw PlantUML text
 * @param {Object} [options] - Conversion options
 * @param {boolean} [options.wrapInDocument=true] - Wrap in full mxfile document
 * @param {boolean} [options.wrapInGroup=true] - Wrap in UserObject group
 * @param {string} [options.groupId] - Custom group cell ID (auto-generated if omitted)
 * @returns {{ xml: string, diagramType: string }}
 * @throws {Error} If diagram type cannot be detected
 */
export function convert(plantUmlText, options = {}) {
	const {
		wrapInDocument = true,
		wrapInGroup = true,
		groupId = null
	} = options;

	// 1. Detect diagram type
	const diagramType = detectDiagramType(plantUmlText);
	if (!diagramType) {
		throw new Error('Unable to detect PlantUML diagram type. Supported types: ' +
			[...diagramHandlers.keys()].join(', '));
	}

	const handler = diagramHandlers.get(diagramType);

	// 2. Parse
	const model = handler.parse(plantUmlText);

	// 3. Determine parent ID for cells
	const gId = groupId || 'puml-grp-1';
	const parentId = wrapInGroup ? gId : '1';

	// 4. Emit cells
	const cellXmls = handler.emit(model, parentId);
	const cellsStr = cellXmls.join('\n');

	// 5. Wrap in group if requested
	let outputXml;
	if (wrapInGroup) {
		// Calculate bounding box from emitter (approximate)
		// A more precise implementation would parse geometry from cells
		const width = 800;  // TODO: get from emitter
		const height = 600; // TODO: get from emitter

		outputXml = buildUserObject({
			id: gId,
			plantUml: plantUmlText,
			children: cellsStr,
			width: width,
			height: height
		});
	} else {
		outputXml = cellsStr;
	}

	// 6. Wrap in document if requested
	if (wrapInDocument) {
		outputXml = buildDocument(outputXml);
	}

	return {
		xml: outputXml,
		diagramType: diagramType
	};
}

/**
 * Re-generate: extract embedded PlantUML from a UserObject, optionally
 * apply edits, and re-convert.
 *
 * @param {string} existingXml - The existing mxGraph XML containing a PlantUML UserObject
 * @param {string} [newPlantUml] - Updated PlantUML text (if null, uses the embedded source)
 * @param {Object} [options] - Same options as convert()
 * @returns {{ xml: string, diagramType: string }}
 */
export function regenerate(existingXml, newPlantUml, options = {}) {
	let plantUmlText = newPlantUml;

	if (!plantUmlText) {
		// Extract from existing XML
		plantUmlText = extractPlantUml(existingXml);
		if (!plantUmlText) {
			throw new Error('No PlantUML source found in the provided XML');
		}
	}

	// Preserve the existing group ID if present
	if (!options.groupId) {
		const idMatch = existingXml.match(/<UserObject[^>]+id="([^"]+)"/);
		if (idMatch) {
			options.groupId = idMatch[1];
		}
	}

	return convert(plantUmlText, options);
}

/**
 * Extract the embedded PlantUML source from a draw.io XML string
 * containing a PlantUML UserObject.
 *
 * @param {string} xml - mxGraph XML
 * @returns {string|null} The PlantUML text, or null if not found
 */
export function extractPlantUml(xml) {
	const match = xml.match(/plantUml="([^"]+)"/);
	if (!match) return null;

	// Unescape XML entities
	return match[1]
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#xa;/g, '\n')
		.replace(/&#xd;/g, '\r');
}

/**
 * Register a new diagram type handler.
 *
 * @param {string} key - Diagram type key (e.g., 'class', 'activity')
 * @param {Object} handler - { detect, parse, emit } functions
 */
export function registerDiagramHandler(key, handler) {
	if (!handler.detect || !handler.parse || !handler.emit) {
		throw new Error('Handler must provide detect, parse, and emit functions');
	}
	diagramHandlers.set(key, handler);
}

/**
 * Get list of supported diagram types.
 * @returns {string[]}
 */
export function getSupportedTypes() {
	return [...diagramHandlers.keys()];
}
