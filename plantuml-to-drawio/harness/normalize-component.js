/**
 * normalize-component.js
 *
 * Normalized element types and matching/diffing logic for component/deployment diagrams.
 * Used by the structural comparison harness to compare PlantUML SVG
 * output against draw.io XML output.
 */

// ── Normalized element types ─────────────────────────────────────────────

export class NComponent {
	constructor(name, type) {
		this.name = name;           // Display name
		this.type = type || 'component'; // element type string
		this.stereotypes = [];
	}
}

export class NContainer {
	constructor(name, type) {
		this.name = name;
		this.type = type || 'package';
		this.children = [];
	}
}

export class NRelationship {
	constructor(from, to, relType) {
		this.from = from;
		this.to = to;
		this.relType = relType;     // 'association', 'extension', 'dependency', etc.
		this.label = null;
	}
}

export class NNote {
	constructor(text) {
		this.text = text;
	}
}

export class NormalizedComponentDiagram {
	constructor() {
		this.elements = [];         // Array of NComponent (all element types)
		this.containers = [];       // Array of NContainer
		this.relationships = [];    // Array of NRelationship
		this.notes = [];            // Array of NNote
	}
}

// ── Matching logic ────────────────────────────────────────────────────────

function normalizeText(text) {
	if (!text) return '';
	return text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/\\n/g, '\n')
		.replace(/<br\s*\/?>/g, '\n')
		.trim()
		.toLowerCase();
}

function namesMatch(a, b) {
	const na = normalizeText(a);
	const nb = normalizeText(b);
	if (na === nb) return true;
	const stripped_a = na.replace(/\s+/g, '');
	const stripped_b = nb.replace(/\s+/g, '');
	return stripped_a === stripped_b;
}

export function matchDiagrams(refDiagram, candDiagram) {
	const matches = {
		elements: [],
		containers: [],
		relationships: [],
		unmatchedRefElements: [],
		unmatchedCandElements: [],
		unmatchedRefContainers: [],
		unmatchedCandContainers: [],
		unmatchedRefRels: [],
		unmatchedCandRels: [],
	};

	// Match elements by name
	const candPool = [...candDiagram.elements];
	for (const refEl of refDiagram.elements) {
		const idx = candPool.findIndex(e => namesMatch(e.name, refEl.name));
		if (idx >= 0) {
			matches.elements.push({ ref: refEl, cand: candPool[idx] });
			candPool.splice(idx, 1);
		} else {
			matches.unmatchedRefElements.push(refEl);
		}
	}
	matches.unmatchedCandElements = candPool;

	// Match containers by name
	const candContainerPool = [...candDiagram.containers];
	for (const refCont of refDiagram.containers) {
		const idx = candContainerPool.findIndex(c => namesMatch(c.name, refCont.name));
		if (idx >= 0) {
			matches.containers.push({ ref: refCont, cand: candContainerPool[idx] });
			candContainerPool.splice(idx, 1);
		} else {
			matches.unmatchedRefContainers.push(refCont);
		}
	}
	matches.unmatchedCandContainers = candContainerPool;

	// Match relationships by from/to/type
	const candRelPool = [...candDiagram.relationships];
	for (const refRel of refDiagram.relationships) {
		const idx = candRelPool.findIndex(r =>
			r.relType === refRel.relType && (
				(namesMatch(r.from, refRel.from) && namesMatch(r.to, refRel.to)) ||
				(namesMatch(r.from, refRel.to) && namesMatch(r.to, refRel.from))
			)
		);
		if (idx >= 0) {
			matches.relationships.push({ ref: refRel, cand: candRelPool[idx] });
			candRelPool.splice(idx, 1);
		} else {
			matches.unmatchedRefRels.push(refRel);
		}
	}
	matches.unmatchedCandRels = candRelPool;

	return matches;
}

export function diffDiagrams(matches) {
	const issues = [];

	for (const el of matches.unmatchedRefElements) {
		issues.push({
			severity: 'blocking',
			type: 'missing_element',
			message: `Missing element: ${el.name} (${el.type})`,
		});
	}

	for (const el of matches.unmatchedCandElements) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_element',
			message: `Extra element in candidate: ${el.name} (${el.type})`,
		});
	}

	for (const cont of matches.unmatchedRefContainers) {
		issues.push({
			severity: 'important',
			type: 'missing_container',
			message: `Missing container: ${cont.name} (${cont.type})`,
		});
	}

	for (const cont of matches.unmatchedCandContainers) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_container',
			message: `Extra container in candidate: ${cont.name}`,
		});
	}

	for (const rel of matches.unmatchedRefRels) {
		issues.push({
			severity: 'blocking',
			type: 'missing_relationship',
			message: `Missing relationship: ${rel.from} → ${rel.to} (${rel.relType})`,
		});
	}

	for (const rel of matches.unmatchedCandRels) {
		issues.push({
			severity: 'important',
			type: 'extra_relationship',
			message: `Extra relationship in candidate: ${rel.from} → ${rel.to} (${rel.relType})`,
		});
	}

	// Check type mismatches in matched elements
	// Note: The SVG extractor has limited type inference — PlantUML SVGs don't encode
	// semantic types. The extractor defaults to 'component' for rect-based elements and
	// makes best-effort guesses ('interface', 'usecase', 'actor') for ellipse-based ones.
	// Only flag mismatches when both sides have confidently-determined types.
	const svgDefaultTypes = new Set(['component', 'interface', 'usecase', 'actor']);
	for (const pair of matches.elements) {
		if (pair.ref.type !== pair.cand.type && !svgDefaultTypes.has(pair.ref.type)) {
			issues.push({
				severity: 'important',
				type: 'type_mismatch',
				message: `Type mismatch for ${pair.ref.name}: ref=${pair.ref.type}, cand=${pair.cand.type}`,
			});
		}
	}

	return issues;
}

export function buildReport(issues, refDiagram, candDiagram) {
	const blocking = issues.filter(i => i.severity === 'blocking');
	const important = issues.filter(i => i.severity === 'important');
	const cosmetic = issues.filter(i => i.severity === 'cosmetic');

	let score;
	if (blocking.length > 0) {
		score = 'fail';
	} else if (important.length > 0) {
		score = 'needs_work';
	} else {
		score = 'pass';
	}

	const summary = [
		`Elements: ref=${refDiagram.elements.length}, cand=${candDiagram.elements.length}`,
		`Containers: ref=${refDiagram.containers.length}, cand=${candDiagram.containers.length}`,
		`Relationships: ref=${refDiagram.relationships.length}, cand=${candDiagram.relationships.length}`,
	].join('; ');

	return {
		score,
		blocking,
		important,
		cosmetic,
		summary,
	};
}
