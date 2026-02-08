/**
 * extract-plantuml-svg-usecase.js
 *
 * Extracts a NormalizedUsecaseDiagram from a PlantUML SVG for usecase diagrams.
 *
 * PlantUML SVG structure for usecase diagrams:
 *   <g class="entity" id="entNNNN">
 *     <ellipse .../>  (for usecases)
 *     <text>UseCase Name</text>
 *   </g>
 *   <g class="entity" id="entNNNN">
 *     <path ... />    (for actors — stick figure paths)
 *     <text>Actor Name</text>
 *   </g>
 *   <g class="cluster" id="clNNNN">
 *     <rect .../>     (for packages/containers)
 *     <text>Container Name</text>
 *   </g>
 *   <g class="link" data-entity-1="..." data-entity-2="..." data-link-type="...">
 *     <path .../>
 *   </g>
 */

import {
	NActor,
	NUsecase,
	NContainer,
	NRelationship,
	NNote,
	NormalizedUsecaseDiagram
} from './normalize-usecase.js';

/**
 * Extract NormalizedUsecaseDiagram from PlantUML SVG text.
 * @param {string} svgText - PlantUML SVG content
 * @returns {NormalizedUsecaseDiagram}
 */
export function extractFromPlantUmlSvg(svgText) {
	const diagram = new NormalizedUsecaseDiagram();

	// Build entity ID → name map
	const entityMap = new Map();         // id → name
	const entityTypeMap = new Map();     // id → 'actor' | 'usecase'
	const realEntityIds = new Set();

	// Extract entities
	const entityRegex = /<g\s+class="entity"[^>]*id="([^"]+)"[^>]*>/g;
	let entityMatch;

	while ((entityMatch = entityRegex.exec(svgText)) !== null) {
		const entityId = entityMatch[1];
		const startPos = entityMatch.index;
		const endPos = findClosingTag(svgText, startPos);

		if (endPos < 0) continue;

		const entitySvg = svgText.substring(startPos, endPos);

		// Extract display name from <text> elements
		const textMatches = [];
		const textRegex = /<text[^>]*>([^<]+)<\/text>/g;
		let tm;
		while ((tm = textRegex.exec(entitySvg)) !== null) {
			const txt = tm[1].trim();
			if (txt) textMatches.push(txt);
		}

		if (textMatches.length === 0) continue;

		// Filter out stereotype text (guillemets «...» rendered as &#171;...&#187;)
		const nonStereotypeTexts = textMatches.filter(t =>
			!t.includes('\u00AB') && !t.includes('\u00BB') &&
			!t.includes('&#171;') && !t.includes('&#187;') &&
			!/^<<.*>>$/.test(t)
		);

		// The display name is the last non-stereotype text
		const name = nonStereotypeTexts.length > 0
			? nonStereotypeTexts[nonStereotypeTexts.length - 1]
			: textMatches[textMatches.length - 1];

		// Determine if this is an actor, usecase, or note
		// Notes have <path> with yellow-ish fills (#FEFF, #FFFF) and no <ellipse>
		// Actors have an <ellipse> (head) AND <path> elements (stick figure body/limbs)
		// Usecases have only <ellipse> (large oval) with no <path> elements
		const hasEllipse = entitySvg.includes('<ellipse');
		const hasPaths = entitySvg.includes('<path');
		const hasNoteFill = /fill="#F[EF]F[FE]/.test(entitySvg) || /fill="#FFFF[EDE]/.test(entitySvg);

		// Skip notes — they appear as entities but have yellow fills and no ellipse
		if (!hasEllipse && hasPaths && hasNoteFill) {
			// Collect all text from the note for the NNote
			const noteText = nonStereotypeTexts.join('\n');
			if (noteText) {
				diagram.notes.push(new NNote(noteText));
			}
			continue;
		}

		realEntityIds.add(entityId);
		entityMap.set(entityId, name);

		if (hasEllipse && !hasPaths) {
			entityTypeMap.set(entityId, 'usecase');
			const uc = new NUsecase(name);
			diagram.usecases.push(uc);
		} else {
			entityTypeMap.set(entityId, 'actor');
			const actor = new NActor(name);
			diagram.actors.push(actor);
		}
	}

	// Extract clusters (containers/packages)
	const clusterRegex = /<g\s+class="cluster"[^>]*id="([^"]+)"[^>]*>/g;
	let clusterMatch;

	while ((clusterMatch = clusterRegex.exec(svgText)) !== null) {
		const clusterId = clusterMatch[1];
		const startPos = clusterMatch.index;
		const endPos = findClosingTag(svgText, startPos);

		if (endPos < 0) continue;

		const clusterSvg = svgText.substring(startPos, endPos);

		// Extract name from <text>
		const textMatch = clusterSvg.match(/<text[^>]*>([^<]+)<\/text>/);
		if (!textMatch) continue;

		const name = textMatch[1].trim();
		if (!name) continue;

		const container = new NContainer(name);
		diagram.containers.push(container);
	}

	// Extract relationships
	const linkRegex = /<g\s+class="link"\s+data-entity-1="([^"]+)"\s+data-entity-2="([^"]+)"(?:\s+data-link-type="([^"]+)")?[^>]*>/g;
	let linkMatch;

	while ((linkMatch = linkRegex.exec(svgText)) !== null) {
		const entity1Id = linkMatch[1];
		const entity2Id = linkMatch[2];
		const svgLinkType = linkMatch[3] || 'association';

		// Skip relationships involving non-real entities
		if (!realEntityIds.has(entity1Id) || !realEntityIds.has(entity2Id)) continue;

		const fromName = entityMap.get(entity1Id) || entity1Id;
		const toName = entityMap.get(entity2Id) || entity2Id;

		// Check for dashed lines
		const linkStart = linkMatch.index;
		const linkEnd = findClosingTag(svgText, linkStart);
		const linkSvg = linkEnd > 0 ? svgText.substring(linkStart, linkEnd) : '';
		const isDashed = linkSvg.includes('stroke-dasharray');

		const relType = normalizeSvgLinkType(svgLinkType, isDashed);

		const rel = new NRelationship(fromName, toName, relType);
		diagram.relationships.push(rel);
	}

	// Extract notes (standalone text groups with note-like shapes)
	const noteRegex = /<g\s+class="entity"[^>]*>[^]*?<polygon[^>]*fill="#[Ff]{3}[Ff]?[Cc]{2}[Cc]?[Dd]?"[^>]*>[\s\S]*?<text[^>]*>([^<]+)<\/text>/g;
	let noteMatch;
	while ((noteMatch = noteRegex.exec(svgText)) !== null) {
		const noteText = noteMatch[1].trim();
		if (noteText) {
			diagram.notes.push(new NNote(noteText));
		}
	}

	return diagram;
}

/**
 * Normalize PlantUML SVG data-link-type to match draw.io extractor vocabulary.
 */
function normalizeSvgLinkType(svgType, isDashed) {
	if (svgType === 'extension') {
		return isDashed ? 'implementation' : 'extension';
	}
	if (svgType === 'dependency') {
		return isDashed ? 'dependency' : 'association';
	}
	// composition, aggregation, association pass through
	return svgType;
}

/**
 * Find the closing </g> tag matching the <g> at startPos.
 */
function findClosingTag(svgText, startPos) {
	let depth = 0;
	let pos = startPos;

	while (pos < svgText.length) {
		const openIdx = svgText.indexOf('<g', pos);
		const closeIdx = svgText.indexOf('</g>', pos);

		if (closeIdx < 0) return -1;

		if (openIdx >= 0 && openIdx < closeIdx) {
			depth++;
			pos = openIdx + 2;
		} else {
			depth--;
			if (depth === 0) {
				return closeIdx + 4;
			}
			pos = closeIdx + 4;
		}
	}

	return -1;
}
