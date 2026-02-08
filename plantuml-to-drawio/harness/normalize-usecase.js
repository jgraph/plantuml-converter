/**
 * normalize-usecase.js
 *
 * Normalized element types and matching/diffing logic for usecase diagrams.
 * Used by the structural comparison harness to compare PlantUML SVG
 * output against draw.io XML output.
 */

// ── Normalized element types ─────────────────────────────────────────────

export class NActor {
	constructor(name) {
		this.name = name;           // Display name
		this.type = 'actor';        // 'actor' or 'actor_business'
		this.stereotypes = [];
	}
}

export class NUsecase {
	constructor(name) {
		this.name = name;           // Display name
		this.type = 'usecase';      // 'usecase' or 'usecase_business'
		this.stereotypes = [];
	}
}

export class NContainer {
	constructor(name, type) {
		this.name = name;
		this.type = type || 'package'; // 'package', 'rectangle', 'frame', 'cloud', etc.
		this.children = [];            // Array of child element names
	}
}

export class NRelationship {
	constructor(from, to, relType) {
		this.from = from;           // Source element name
		this.to = to;               // Target element name
		this.relType = relType;     // 'association', 'extension', 'dependency', etc.
		this.label = null;
	}
}

export class NNote {
	constructor(text) {
		this.text = text;
	}
}

export class NormalizedUsecaseDiagram {
	constructor() {
		this.actors = [];           // Array of NActor
		this.usecases = [];         // Array of NUsecase
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
	// Also match with spaces stripped (e.g., "PlaceOrder" vs "Place Order")
	const stripped_a = na.replace(/\s+/g, '');
	const stripped_b = nb.replace(/\s+/g, '');
	return stripped_a === stripped_b;
}

export function matchDiagrams(refDiagram, candDiagram) {
	const matches = {
		actors: [],
		usecases: [],
		containers: [],
		relationships: [],
		unmatchedRefActors: [],
		unmatchedCandActors: [],
		unmatchedRefUsecases: [],
		unmatchedCandUsecases: [],
		unmatchedRefContainers: [],
		unmatchedCandContainers: [],
		unmatchedRefRels: [],
		unmatchedCandRels: [],
	};

	// Match actors by name
	const candActorPool = [...candDiagram.actors];
	for (const refActor of refDiagram.actors) {
		const idx = candActorPool.findIndex(a => namesMatch(a.name, refActor.name));
		if (idx >= 0) {
			matches.actors.push({ ref: refActor, cand: candActorPool[idx] });
			candActorPool.splice(idx, 1);
		} else {
			matches.unmatchedRefActors.push(refActor);
		}
	}
	matches.unmatchedCandActors = candActorPool;

	// Match usecases by name
	const candUsecasePool = [...candDiagram.usecases];
	for (const refUC of refDiagram.usecases) {
		const idx = candUsecasePool.findIndex(u => namesMatch(u.name, refUC.name));
		if (idx >= 0) {
			matches.usecases.push({ ref: refUC, cand: candUsecasePool[idx] });
			candUsecasePool.splice(idx, 1);
		} else {
			matches.unmatchedRefUsecases.push(refUC);
		}
	}
	matches.unmatchedCandUsecases = candUsecasePool;

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

	// Match relationships by from/to/type (try both directions)
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

	// Missing actors
	for (const actor of matches.unmatchedRefActors) {
		issues.push({
			severity: 'blocking',
			type: 'missing_actor',
			message: `Missing actor: ${actor.name}`,
		});
	}

	// Extra actors
	for (const actor of matches.unmatchedCandActors) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_actor',
			message: `Extra actor in candidate: ${actor.name}`,
		});
	}

	// Missing usecases
	for (const uc of matches.unmatchedRefUsecases) {
		issues.push({
			severity: 'blocking',
			type: 'missing_usecase',
			message: `Missing usecase: ${uc.name}`,
		});
	}

	// Extra usecases
	for (const uc of matches.unmatchedCandUsecases) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_usecase',
			message: `Extra usecase in candidate: ${uc.name}`,
		});
	}

	// Missing containers
	for (const cont of matches.unmatchedRefContainers) {
		issues.push({
			severity: 'important',
			type: 'missing_container',
			message: `Missing container: ${cont.name} (${cont.type})`,
		});
	}

	// Extra containers
	for (const cont of matches.unmatchedCandContainers) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_container',
			message: `Extra container in candidate: ${cont.name}`,
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
		`Actors: ref=${refDiagram.actors.length}, cand=${candDiagram.actors.length}`,
		`Usecases: ref=${refDiagram.usecases.length}, cand=${candDiagram.usecases.length}`,
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
