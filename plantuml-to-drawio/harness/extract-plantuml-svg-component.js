/**
 * extract-plantuml-svg-component.js
 *
 * Extracts a NormalizedComponentDiagram from a PlantUML SVG for component/deployment diagrams.
 *
 * PlantUML SVG structure for component diagrams:
 *   <g class="entity" id="entNNNN">
 *     <rect .../> or <path .../> (component shape, node 3D box, etc.)
 *     <text>Element Name</text>
 *   </g>
 *   <g class="cluster" id="clNNNN">
 *     <rect .../>
 *     <text>Container Name</text>
 *   </g>
 *   <g class="link" data-entity-1="..." data-entity-2="..." data-link-type="...">
 *     <path .../>
 *   </g>
 */

import {
	NComponent,
	NContainer,
	NRelationship,
	NNote,
	NormalizedComponentDiagram,
} from './normalize-component.js';

/**
 * Extract NormalizedComponentDiagram from PlantUML SVG text.
 * @param {string} svgText - PlantUML SVG content
 * @returns {NormalizedComponentDiagram}
 */
export function extractFromPlantUmlSvg(svgText) {
	const diagram = new NormalizedComponentDiagram();

	const entityMap = new Map();         // id → name
	const realEntityIds = new Set();

	// Extract entities
	const entityRegex = /<g\s+class="entity"[^>]*id="([^"]+)"[^>]*>/g;
	let entityMatch;

	while ((entityMatch = entityRegex.exec(svgText)) !== null) {
		const entityId = entityMatch[1];
		// Extract data-qualified-name for note detection
		const qnMatch = entityMatch[0].match(/data-qualified-name="([^"]+)"/);
		const qualifiedName = qnMatch ? qnMatch[1] : '';
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

		// Filter out stereotype text
		const nonStereotypeTexts = textMatches.filter(t =>
			!t.includes('\u00AB') && !t.includes('\u00BB') &&
			!t.includes('&#171;') && !t.includes('&#187;') &&
			!/^<<.*>>$/.test(t)
		);

		let name = nonStereotypeTexts.length > 0
			? nonStereotypeTexts[nonStereotypeTexts.length - 1]
			: textMatches[textMatches.length - 1];

		// Strip surrounding quotes if present
		if (name.startsWith('"') && name.endsWith('"')) {
			name = name.slice(1, -1);
		}

		// Detect notes by fill color (yellow-ish) — PlantUML uses <path> (not <polygon>) for notes
		const hasNoteFill = /fill="#FEFFDD"/.test(entitySvg) ||
			/fill="#F[EF]F[FE]/.test(entitySvg) ||
			/fill="#FFFF[EDE]/.test(entitySvg);
		const hasNoteShape = (entitySvg.includes('<path') || entitySvg.includes('<polygon')) && hasNoteFill;
		// Also detect notes via qualified name pattern (PlantUML uses GMN or N prefixes for notes)
		const isNoteByName = /^(GMN|N)\d+$/.test(qualifiedName);

		if (hasNoteShape || (isNoteByName && hasNoteFill)) {
			const noteText = nonStereotypeTexts.join('\n');
			if (noteText) {
				diagram.notes.push(new NNote(noteText));
			}
			continue;
		}

		realEntityIds.add(entityId);
		entityMap.set(entityId, name);

		// Infer type from SVG shape characteristics
		let type = 'component';
		const hasEllipse = entitySvg.includes('<ellipse');
		const hasCircle = entitySvg.includes('<circle');

		if (hasEllipse || hasCircle) {
			// Small circles → interface, large ellipses → usecase
			// Check ellipse size to distinguish
			const ellipseMatch = entitySvg.match(/rx="(\d+)"/);
			if (ellipseMatch && parseInt(ellipseMatch[1]) < 15) {
				type = 'interface';
			} else if (hasEllipse) {
				type = 'usecase';
			} else {
				type = 'interface';
			}
		}

		// Check for actor (stick figure)
		const hasStickFigure = entitySvg.includes('<ellipse') && entitySvg.includes('<path') &&
			(entitySvg.match(/<path/g) || []).length >= 3;
		if (hasStickFigure) {
			type = 'actor';
		}

		const el = new NComponent(name, type);
		diagram.elements.push(el);
	}

	// Extract clusters (containers)
	const clusterRegex = /<g\s+class="cluster"[^>]*id="([^"]+)"[^>]*>/g;
	let clusterMatch;

	while ((clusterMatch = clusterRegex.exec(svgText)) !== null) {
		const startPos = clusterMatch.index;
		const endPos = findClosingTag(svgText, startPos);

		if (endPos < 0) continue;

		const clusterSvg = svgText.substring(startPos, endPos);

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

		if (!realEntityIds.has(entity1Id) || !realEntityIds.has(entity2Id)) continue;

		const fromName = entityMap.get(entity1Id) || entity1Id;
		const toName = entityMap.get(entity2Id) || entity2Id;

		const linkStart = linkMatch.index;
		const linkEnd = findClosingTag(svgText, linkStart);
		const linkSvg = linkEnd > 0 ? svgText.substring(linkStart, linkEnd) : '';
		const isDashed = linkSvg.includes('stroke-dasharray');

		const relType = normalizeSvgLinkType(svgLinkType, isDashed);

		const rel = new NRelationship(fromName, toName, relType);
		diagram.relationships.push(rel);
	}

	return diagram;
}

function normalizeSvgLinkType(svgType, isDashed) {
	if (svgType === 'extension') {
		return isDashed ? 'implementation' : 'extension';
	}
	if (svgType === 'dependency') {
		return isDashed ? 'dependency' : 'association';
	}
	return svgType;
}

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
