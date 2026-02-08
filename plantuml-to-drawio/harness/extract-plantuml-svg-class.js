/**
 * extract-plantuml-svg-class.js
 *
 * Extracts a NormalizedClassDiagram from a PlantUML SVG for class diagrams.
 *
 * PlantUML SVG structure for class diagrams:
 *   <g class="entity" data-qualified-name="ClassName" id="entNNNN">
 *     <text>ClassName</text>
 *     <g data-visibility-modifier="PUBLIC_FIELD">...</g>
 *     <text>fieldName : Type</text>
 *     ...
 *   </g>
 *   <g class="link" data-entity-1="entNNNN" data-entity-2="entNNNN" data-link-type="extension">
 *     <path .../>
 *   </g>
 */

import {
	NClass,
	NMember,
	NRelationship,
	NNote,
	NormalizedClassDiagram
} from './normalize-class.js';

// Simple regex-based SVG parser (no DOM dependency)

/**
 * Extract NormalizedClassDiagram from PlantUML SVG text.
 * @param {string} svgText - PlantUML SVG content
 * @returns {NormalizedClassDiagram}
 */
export function extractFromPlantUmlSvg(svgText) {
	const diagram = new NormalizedClassDiagram();

	// Build entity ID → name map
	const entityMap = new Map();
	const realEntityIds = new Set();  // IDs of real class entities (not note markers)

	// Extract entities
	const entityRegex = /<g\s+class="entity"\s+data-qualified-name="([^"]+)"[^>]*id="([^"]+)"[^>]*>/g;
	let entityMatch;

	while ((entityMatch = entityRegex.exec(svgText)) !== null) {
		const qualifiedName = entityMatch[1];
		const entityId = entityMatch[2];

		// Find the extent of this entity group
		const startPos = entityMatch.index;
		const endPos = findClosingTag(svgText, startPos);

		if (endPos < 0) {
			entityMap.set(entityId, qualifiedName);
			continue;
		}

		const entitySvg = svgText.substring(startPos, endPos);

		// Skip anonymous note-positioning entities (GMNxx, Nxx) — they have no <rect>
		// But keep lollipop entities (have <ellipse> and visible <text>)
		if (!entitySvg.includes('<rect')) {
			if (entitySvg.includes('<ellipse') && entitySvg.includes('<text')) {
				// Lollipop or circle entity — extract as a class with special type
				const textMatch = entitySvg.match(/<text[^>]*>([^<]+)<\/text>/);
				const lolliName = textMatch ? textMatch[1].trim() : qualifiedName;
				realEntityIds.add(entityId);
				const lolliCls = new NClass(lolliName);
				lolliCls.type = 'interface'; // Lollipops are interface-like
				diagram.classes.push(lolliCls);
				entityMap.set(entityId, lolliName);
			} else {
				entityMap.set(entityId, qualifiedName);
			}
			continue;
		}

		realEntityIds.add(entityId);
		const cls = extractClassFromEntitySvg(qualifiedName, entitySvg);
		diagram.classes.push(cls);

		// Map entity ID to the extracted display name (may differ from qualified name for aliases)
		entityMap.set(entityId, cls.name);
	}

	// Extract relationships — need link group body for dashed detection
	const linkRegex = /<g\s+class="link"\s+data-entity-1="([^"]+)"\s+data-entity-2="([^"]+)"\s+data-link-type="([^"]+)"[^>]*>/g;
	let linkMatch;

	while ((linkMatch = linkRegex.exec(svgText)) !== null) {
		const entity1Id = linkMatch[1];
		const entity2Id = linkMatch[2];
		const svgLinkType = linkMatch[3];

		// Skip relationships involving anonymous note-positioning entities
		if (!realEntityIds.has(entity1Id) || !realEntityIds.has(entity2Id)) continue;

		const fromName = entityMap.get(entity1Id) || entity1Id;
		const toName = entityMap.get(entity2Id) || entity2Id;

		// Extract the link group body to check for dashed lines
		const linkStart = linkMatch.index;
		const linkEnd = findClosingTag(svgText, linkStart);
		const linkSvg = linkEnd > 0 ? svgText.substring(linkStart, linkEnd) : '';
		const isDashed = linkSvg.includes('stroke-dasharray');

		// Normalize PlantUML SVG link types to match draw.io extractor vocabulary:
		// SVG "extension" + solid = extension (class extends)
		// SVG "extension" + dashed = implementation (class implements)
		// SVG "dependency" + dashed = dependency (..>)
		// SVG "dependency" + solid = association (-->, ==>, <-->)
		// SVG "composition" = composition
		// SVG "aggregation" = aggregation
		// SVG "association" = association (--)
		const relType = normalizeSvgLinkType(svgLinkType, isDashed);

		const rel = new NRelationship(fromName, toName, relType);
		diagram.relationships.push(rel);
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

function extractClassFromEntitySvg(name, svg) {
	// Extract the display name from the header text with font-size="14" before
	// the first <line> separator. Stereotypes use smaller fonts (e.g., 13) and
	// generic params use font-size="12". The class name always uses 14.
	// For aliased classes, this differs from data-qualified-name.
	let displayName = name;
	const headerEnd = svg.indexOf('<line');
	if (headerEnd > 0) {
		const headerSvg = svg.substring(0, headerEnd);
		const nameMatch = headerSvg.match(/<text[^>]*font-size="14"[^>]*>([^<]+)<\/text>/);
		if (nameMatch) {
			displayName = nameMatch[1].trim();
		}
	}

	const cls = new NClass(displayName);

	// Determine type from the first ellipse fill color in the entity.
	// PlantUML draws a colored circle marker with a letter path:
	//   #ADD1B2 (green) = class (C)
	//   #A9DCDF (teal) = abstract class (A)
	//   #B4A7E5 (purple) = interface (I)
	//   #EB937F (orange) = enum (E)
	//   #E3664A (red-orange) = annotation (@)
	const ellipseMatch = svg.match(/<ellipse[^>]*fill="([^"]+)"/);
	if (ellipseMatch) {
		const color = ellipseMatch[1].toUpperCase();
		if (color === '#A9DCDF') {
			cls.type = 'abstract_class';
			cls.isAbstract = true;
		} else if (color === '#B4A7E5') {
			cls.type = 'interface';
		} else if (color === '#EB937F') {
			cls.type = 'enum';
		} else if (color === '#E3664A') {
			cls.type = 'annotation';
		}
		// #ADD1B2 = class (default)
	}

	// Extract members using two strategies:
	// 1. Members with data-visibility-modifier groups (have explicit visibility)
	// 2. Bare <text> elements after separator <line>s (enum constants, no-visibility members)

	// Strategy 1: visibility modifier groups
	const visRegex = /data-visibility-modifier="([^"]+)"[^>]*>[\s\S]*?<\/g>\s*<text[^>]*>([^<]+)<\/text>/g;
	let visMatch;
	const matchedTextPositions = new Set();

	while ((visMatch = visRegex.exec(svg)) !== null) {
		const modifier = visMatch[1];
		const memberText = visMatch[2].trim();

		const member = new NMember(memberText);

		if (modifier.includes('PUBLIC')) member.visibility = '+';
		else if (modifier.includes('PRIVATE')) member.visibility = '-';
		else if (modifier.includes('PROTECTED')) member.visibility = '#';
		else if (modifier.includes('PACKAGE')) member.visibility = '~';

		member.isMethod = modifier.includes('METHOD');
		member.isStatic = false;

		cls.members.push(member);

		// Track the position of the <text> element we matched
		matchedTextPositions.add(visMatch.index);
	}

	// Strategy 2: bare <text> elements in the body (after first <line> separator)
	// These are enum constants, entity/struct/record fields without visibility,
	// and annotation members.
	const firstLine = svg.indexOf('<line');
	if (firstLine > 0) {
		const bodySvg = svg.substring(firstLine);
		const bareTextRegex = /<text[^>]*>([^<]+)<\/text>/g;
		let bareMatch;

		while ((bareMatch = bareTextRegex.exec(bodySvg)) !== null) {
			const text = bareMatch[1].trim();
			if (!text) continue;

			// Skip if this text was already matched by a visibility modifier group.
			// Check by seeing if the absolute position was near a vis match.
			const absPos = firstLine + bareMatch.index;

			// Check if a visibility modifier group precedes this text within 200 chars
			const precedingChunk = svg.substring(Math.max(0, absPos - 200), absPos);
			if (precedingChunk.includes('data-visibility-modifier')) continue;

			// Skip if this text matches the class display name (header text repeated)
			if (text === displayName) continue;

			const member = new NMember(text);
			member.isMethod = text.includes('(');
			cls.members.push(member);
		}
	}

	return cls;
}

/**
 * Find the closing </g> tag matching the <g> at startPos.
 * Simple nesting counter approach.
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
