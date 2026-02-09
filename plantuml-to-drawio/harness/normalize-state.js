/**
 * normalize-state.js
 *
 * Normalized element types and matching/diffing logic for state diagrams.
 * Used by the structural comparison harness to compare PlantUML SVG
 * output against draw.io XML output.
 */

// ── Normalized element types ─────────────────────────────────────────────

export class NState {
	constructor(name, type) {
		this.name = name;
		this.type = type || 'state'; // 'state', 'initial', 'final', 'choice', 'fork_join', 'history', 'deep_history'
		this.stereotypes = [];
	}
}

export class NCompositeState {
	constructor(name) {
		this.name = name;
		this.children = [];
	}
}

export class NTransition {
	constructor(from, to) {
		this.from = from;
		this.to = to;
		this.label = null;
	}
}

export class NNote {
	constructor(text) {
		this.text = text;
	}
}

export class NormalizedStateDiagram {
	constructor() {
		this.states = [];           // Array of NState
		this.composites = [];       // Array of NCompositeState
		this.transitions = [];      // Array of NTransition
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

/**
 * Check if two pseudostate types are compatible for matching.
 * [*] appears as both start and end circles, and SVG extraction
 * can't always distinguish them, so we're lenient.
 */
function pseudostateTypesMatch(refType, candType) {
	const pseudostates = new Set(['initial', 'final']);
	if (pseudostates.has(refType) && pseudostates.has(candType)) return true;
	return refType === candType;
}

export function matchDiagrams(refDiagram, candDiagram) {
	const matches = {
		states: [],
		composites: [],
		transitions: [],
		unmatchedRefStates: [],
		unmatchedCandStates: [],
		unmatchedRefComposites: [],
		unmatchedCandComposites: [],
		unmatchedRefTransitions: [],
		unmatchedCandTransitions: [],
	};

	// Match states by name
	const candPool = [...candDiagram.states];
	for (const refSt of refDiagram.states) {
		const idx = candPool.findIndex(s => namesMatch(s.name, refSt.name));
		if (idx >= 0) {
			matches.states.push({ ref: refSt, cand: candPool[idx] });
			candPool.splice(idx, 1);
		} else {
			matches.unmatchedRefStates.push(refSt);
		}
	}
	matches.unmatchedCandStates = candPool;

	// Match composites by name
	const candCompPool = [...candDiagram.composites];
	for (const refComp of refDiagram.composites) {
		const idx = candCompPool.findIndex(c => namesMatch(c.name, refComp.name));
		if (idx >= 0) {
			matches.composites.push({ ref: refComp, cand: candCompPool[idx] });
			candCompPool.splice(idx, 1);
		} else {
			matches.unmatchedRefComposites.push(refComp);
		}
	}
	matches.unmatchedCandComposites = candCompPool;

	// Match transitions by from/to names
	const candTransPool = [...candDiagram.transitions];
	for (const refT of refDiagram.transitions) {
		const idx = candTransPool.findIndex(t =>
			(namesMatch(t.from, refT.from) && namesMatch(t.to, refT.to)) ||
			(namesMatch(t.from, refT.to) && namesMatch(t.to, refT.from))
		);
		if (idx >= 0) {
			matches.transitions.push({ ref: refT, cand: candTransPool[idx] });
			candTransPool.splice(idx, 1);
		} else {
			matches.unmatchedRefTransitions.push(refT);
		}
	}
	matches.unmatchedCandTransitions = candTransPool;

	return matches;
}

export function diffDiagrams(matches) {
	const issues = [];

	for (const st of matches.unmatchedRefStates) {
		issues.push({
			severity: 'blocking',
			type: 'missing_state',
			message: `Missing state: ${st.name} (${st.type})`,
		});
	}

	for (const st of matches.unmatchedCandStates) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_state',
			message: `Extra state in candidate: ${st.name} (${st.type})`,
		});
	}

	for (const comp of matches.unmatchedRefComposites) {
		issues.push({
			severity: 'important',
			type: 'missing_composite',
			message: `Missing composite state: ${comp.name}`,
		});
	}

	for (const comp of matches.unmatchedCandComposites) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_composite',
			message: `Extra composite in candidate: ${comp.name}`,
		});
	}

	for (const t of matches.unmatchedRefTransitions) {
		issues.push({
			severity: 'blocking',
			type: 'missing_transition',
			message: `Missing transition: ${t.from} → ${t.to}${t.label ? ' : ' + t.label : ''}`,
		});
	}

	for (const t of matches.unmatchedCandTransitions) {
		issues.push({
			severity: 'important',
			type: 'extra_transition',
			message: `Extra transition in candidate: ${t.from} → ${t.to}`,
		});
	}

	// Check type mismatches in matched states
	for (const pair of matches.states) {
		if (!pseudostateTypesMatch(pair.ref.type, pair.cand.type) &&
			pair.ref.type !== 'state') {
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
		`States: ref=${refDiagram.states.length}, cand=${candDiagram.states.length}`,
		`Composites: ref=${refDiagram.composites.length}, cand=${candDiagram.composites.length}`,
		`Transitions: ref=${refDiagram.transitions.length}, cand=${candDiagram.transitions.length}`,
	].join('; ');

	return {
		score,
		blocking,
		important,
		cosmetic,
		summary,
	};
}
