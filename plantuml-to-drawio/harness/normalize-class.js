/**
 * normalize-class.js
 *
 * Normalized element types and matching/diffing logic for class diagrams.
 * Used by the structural comparison harness to compare PlantUML SVG
 * output against draw.io XML output.
 */

// ── Normalized element types ─────────────────────────────────────────────

export class NClass {
	constructor(name, type) {
		this.name = name;           // Display name
		this.type = type || 'class'; // 'class', 'interface', 'enum', 'abstract_class', etc.
		this.members = [];          // Array of NMember
		this.stereotypes = [];
		this.isAbstract = false;
	}
}

export class NMember {
	constructor(text) {
		this.text = text;           // Raw member text
		this.visibility = null;     // '+', '-', '#', '~'
		this.isStatic = false;
		this.isAbstract = false;
		this.isMethod = false;
	}
}

export class NRelationship {
	constructor(from, to, relType) {
		this.from = from;           // Source class name
		this.to = to;               // Target class name
		this.relType = relType;     // 'extension', 'implementation', 'composition', etc.
		this.label = null;
	}
}

export class NNote {
	constructor(text) {
		this.text = text;
	}
}

export class NormalizedClassDiagram {
	constructor() {
		this.classes = [];          // Array of NClass
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
		.trim()
		.toLowerCase();
}

function classNamesMatch(a, b) {
	const na = normalizeText(a);
	const nb = normalizeText(b);
	if (na === nb) return true;
	// Match qualified names: "com.example.foo" matches "foo"
	const shortA = na.includes('.') ? na.substring(na.lastIndexOf('.') + 1) : na;
	const shortB = nb.includes('.') ? nb.substring(nb.lastIndexOf('.') + 1) : nb;
	return shortA === shortB;
}

export function matchDiagrams(refDiagram, candDiagram) {
	const matches = {
		classes: [],
		relationships: [],
		unmatchedRefClasses: [],
		unmatchedCandClasses: [],
		unmatchedRefRels: [],
		unmatchedCandRels: [],
	};

	// Match classes by name
	const candClassPool = [...candDiagram.classes];

	for (const refClass of refDiagram.classes) {
		const idx = candClassPool.findIndex(c => classNamesMatch(c.name, refClass.name));
		if (idx >= 0) {
			matches.classes.push({ ref: refClass, cand: candClassPool[idx] });
			candClassPool.splice(idx, 1);
		} else {
			matches.unmatchedRefClasses.push(refClass);
		}
	}
	matches.unmatchedCandClasses = candClassPool;

	// Match relationships by from/to/type (try both directions since
	// PlantUML SVG may reverse entity order for direction-hinted links)
	const candRelPool = [...candDiagram.relationships];

	for (const refRel of refDiagram.relationships) {
		const idx = candRelPool.findIndex(r =>
			r.relType === refRel.relType && (
				(classNamesMatch(r.from, refRel.from) && classNamesMatch(r.to, refRel.to)) ||
				(classNamesMatch(r.from, refRel.to) && classNamesMatch(r.to, refRel.from))
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

	// Missing classes
	for (const cls of matches.unmatchedRefClasses) {
		issues.push({
			severity: 'blocking',
			type: 'missing_class',
			message: `Missing class: ${cls.name} (${cls.type})`,
		});
	}

	// Extra classes
	for (const cls of matches.unmatchedCandClasses) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_class',
			message: `Extra class in candidate: ${cls.name}`,
		});
	}

	// Missing relationships
	for (const rel of matches.unmatchedRefRels) {
		issues.push({
			severity: 'blocking',
			type: 'missing_relationship',
			message: `Missing relationship: ${rel.from} → ${rel.to} (${rel.relType})`,
		});
	}

	// Extra relationships
	for (const rel of matches.unmatchedCandRels) {
		issues.push({
			severity: 'important',
			type: 'extra_relationship',
			message: `Extra relationship in candidate: ${rel.from} → ${rel.to} (${rel.relType})`,
		});
	}

	// Check member counts on matched classes
	for (const { ref, cand } of matches.classes) {
		if (ref.members.length !== cand.members.length) {
			issues.push({
				severity: 'important',
				type: 'member_count_mismatch',
				message: `${ref.name}: ref has ${ref.members.length} members, cand has ${cand.members.length}`,
			});
		}

		// Check type match — be lenient for object/map/json types
		// since PlantUML SVG may report these as 'class' type
		if (ref.type !== cand.type) {
			const objectTypes = new Set(['class', 'object', 'map', 'json']);
			const bothObjectLike = objectTypes.has(ref.type) && objectTypes.has(cand.type);
			issues.push({
				severity: bothObjectLike ? 'cosmetic' : 'important',
				type: 'type_mismatch',
				message: `${ref.name}: ref type=${ref.type}, cand type=${cand.type}`,
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
		`Classes: ref=${refDiagram.classes.length}, cand=${candDiagram.classes.length}`,
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
