/**
 * extract-plantuml-svg-state.js
 *
 * Extracts a NormalizedStateDiagram from a PlantUML SVG for state diagrams.
 *
 * PlantUML SVG structure for state diagrams:
 *   <g class="entity" id="entNNNN">
 *     <rect .../> or <ellipse .../> (state shape, start/end circles, etc.)
 *     <text>State Name</text>
 *   </g>
 *   <g class="cluster" id="clNNNN">
 *     <rect .../>
 *     <text>Composite State Name</text>
 *   </g>
 *   <g class="link" data-entity-1="..." data-entity-2="...">
 *     <path .../>
 *     <text>label</text>
 *   </g>
 */

import {
	NState,
	NCompositeState,
	NTransition,
	NNote,
	NormalizedStateDiagram,
} from './normalize-state.js';

/**
 * Extract NormalizedStateDiagram from PlantUML SVG text.
 * @param {string} svgText - PlantUML SVG content
 * @returns {NormalizedStateDiagram}
 */
export function extractFromPlantUmlSvg(svgText) {
	const diagram = new NormalizedStateDiagram();

	const entityMap = new Map();         // id → name
	const realEntityIds = new Set();     // non-note entity ids

	// Extract entities
	const entityRegex = /<g\s+class="entity"[^>]*id="([^"]+)"[^>]*>/g;
	let entityMatch;

	while ((entityMatch = entityRegex.exec(svgText)) !== null) {
		const entityId = entityMatch[1];
		const qnMatch = entityMatch[0].match(/data-qualified-name="([^"]+)"/);
		const qualifiedName = qnMatch ? qnMatch[1] : '';
		const startPos = entityMatch.index;
		const endPos = findClosingTag(svgText, startPos);

		if (endPos < 0) continue;

		const entitySvg = svgText.substring(startPos, endPos);

		// Extract text elements
		const textMatches = [];
		const textRegex = /<text[^>]*>([^<]+)<\/text>/g;
		let tm;
		while ((tm = textRegex.exec(entitySvg)) !== null) {
			const txt = tm[1].trim();
			if (txt) textMatches.push(txt);
		}

		// Detect notes by fill color
		const hasNoteFill = /fill="#FEFFDD"/.test(entitySvg) ||
			/fill="#F[EF]F[FE]/.test(entitySvg) ||
			/fill="#FFFF[EDE]/.test(entitySvg);
		const isNoteByName = /^(GMN|N)\d+$/.test(qualifiedName);

		if (hasNoteFill || isNoteByName) {
			const noteText = textMatches.join('\n');
			if (noteText) {
				diagram.notes.push(new NNote(noteText));
			}
			continue;
		}

		// Determine state type from SVG shapes
		let type = 'state';
		let name = '';

		const hasEllipse = entitySvg.includes('<ellipse');
		const hasCircle = entitySvg.includes('<circle');
		const hasRect = entitySvg.includes('<rect');
		const hasPolygon = entitySvg.includes('<polygon');

		// Start pseudostate: small filled black circle
		const fillBlackMatch = entitySvg.match(/fill="#0+"/);
		const isSmallCircle = hasEllipse || hasCircle;

		if (isSmallCircle && fillBlackMatch) {
			// Check if there's also an unfilled outer circle (final state)
			const ellipseCount = (entitySvg.match(/<ellipse/g) || []).length +
				(entitySvg.match(/<circle/g) || []).length;
			if (ellipseCount >= 2) {
				type = 'final';
				name = '[*]';
			} else {
				type = 'initial';
				name = '[*]';
			}
		} else if (hasPolygon && !hasRect) {
			// Diamond shape = choice
			type = 'choice';
			name = textMatches.length > 0 ? textMatches[0] : '';
		} else if (textMatches.length > 0) {
			// Check for H or H* text (history states)
			const firstText = textMatches[0];
			if (firstText === 'H' && isSmallCircle) {
				type = 'history';
				name = 'H';
			} else if (firstText === 'H*' && isSmallCircle) {
				type = 'deep_history';
				name = 'H*';
			} else {
				name = textMatches.filter(t =>
					!t.includes('\u00AB') && !t.includes('\u00BB') &&
					!/^<<.*>>$/.test(t)
				).pop() || firstText;
			}
		}

		// Fork/join bars: narrow filled rectangle
		if (hasRect && fillBlackMatch && !hasEllipse && !hasCircle) {
			const rectMatch = entitySvg.match(/height="(\d+(?:\.\d+)?)"/);
			if (rectMatch && parseFloat(rectMatch[1]) < 15) {
				type = 'fork_join';
				name = textMatches.length > 0 ? textMatches[0] : '';
			}
		}

		if (name) {
			// Strip surrounding quotes
			if (name.startsWith('"') && name.endsWith('"')) {
				name = name.slice(1, -1);
			}

			realEntityIds.add(entityId);
			entityMap.set(entityId, name);

			const st = new NState(name, type);
			diagram.states.push(st);
		}
	}

	// Extract clusters (composite states)
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

		const comp = new NCompositeState(name);
		diagram.composites.push(comp);
	}

	// Extract transitions
	const linkRegex = /<g\s+class="link"\s+data-entity-1="([^"]+)"\s+data-entity-2="([^"]+)"[^>]*>/g;
	let linkMatch;

	while ((linkMatch = linkRegex.exec(svgText)) !== null) {
		const entity1Id = linkMatch[1];
		const entity2Id = linkMatch[2];

		if (!realEntityIds.has(entity1Id) || !realEntityIds.has(entity2Id)) continue;

		const fromName = entityMap.get(entity1Id) || entity1Id;
		const toName = entityMap.get(entity2Id) || entity2Id;

		// Extract label from link's <text> elements
		const linkStart = linkMatch.index;
		const linkEnd = findClosingTag(svgText, linkStart);
		const linkSvg = linkEnd > 0 ? svgText.substring(linkStart, linkEnd) : '';

		let label = null;
		const labelMatch = linkSvg.match(/<text[^>]*>([^<]+)<\/text>/);
		if (labelMatch) {
			label = labelMatch[1].trim();
		}

		const t = new NTransition(fromName, toName);
		t.label = label;
		diagram.transitions.push(t);
	}

	return diagram;
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
