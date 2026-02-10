/**
 * normalize-timing.js
 *
 * Normalized element types and matching/diffing logic for timing diagrams.
 * Used by the structural comparison harness to compare PlantUML SVG
 * output against draw.io XML output.
 */

// ── Normalized element types ─────────────────────────────────────────────

export class NPlayer {
	constructor(name, type) {
		this.name = name;
		this.type = type || 'robust'; // 'robust', 'concise', 'clock', 'binary', 'analog', 'rectangle'
		this.stateChanges = [];       // NStateChange[]
	}
}

export class NStateChange {
	constructor(time, state) {
		this.time = time;       // numeric or string
		this.state = state;     // string
	}
}

export class NConstraint {
	constructor(time1, time2) {
		this.time1 = time1;
		this.time2 = time2;
		this.label = null;
	}
}

export class NMessage {
	constructor(fromPlayer, toPlayer) {
		this.fromPlayer = fromPlayer;
		this.toPlayer = toPlayer;
		this.label = null;
	}
}

export class NHighlight {
	constructor(startTime, endTime) {
		this.startTime = startTime;
		this.endTime = endTime;
		this.caption = null;
	}
}

export class NNote {
	constructor(text) {
		this.text = text;
	}
}

export class NormalizedTimingDiagram {
	constructor() {
		this.players = [];       // NPlayer[]
		this.constraints = [];   // NConstraint[]
		this.messages = [];      // NMessage[]
		this.highlights = [];    // NHighlight[]
		this.notes = [];         // NNote[]
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
		players: [],
		unmatchedRefPlayers: [],
		unmatchedCandPlayers: [],
		unmatchedRefConstraints: [],
		unmatchedCandConstraints: [],
		unmatchedRefMessages: [],
		unmatchedCandMessages: [],
	};

	// Match players by name
	const candPool = [...candDiagram.players];
	for (const refP of refDiagram.players) {
		const idx = candPool.findIndex(p => namesMatch(p.name, refP.name));
		if (idx >= 0) {
			matches.players.push({ ref: refP, cand: candPool[idx] });
			candPool.splice(idx, 1);
		} else {
			matches.unmatchedRefPlayers.push(refP);
		}
	}
	matches.unmatchedCandPlayers = candPool;

	// Match constraints by time values
	const candConstraintPool = [...candDiagram.constraints];
	for (const refC of refDiagram.constraints) {
		const idx = candConstraintPool.findIndex(c =>
			c.time1 === refC.time1 && c.time2 === refC.time2
		);
		if (idx >= 0) {
			candConstraintPool.splice(idx, 1);
		} else {
			matches.unmatchedRefConstraints.push(refC);
		}
	}
	matches.unmatchedCandConstraints = candConstraintPool;

	// Match messages by player names
	const candMsgPool = [...candDiagram.messages];
	for (const refM of refDiagram.messages) {
		const idx = candMsgPool.findIndex(m =>
			namesMatch(m.fromPlayer, refM.fromPlayer) &&
			namesMatch(m.toPlayer, refM.toPlayer)
		);
		if (idx >= 0) {
			candMsgPool.splice(idx, 1);
		} else {
			matches.unmatchedRefMessages.push(refM);
		}
	}
	matches.unmatchedCandMessages = candMsgPool;

	return matches;
}

export function diffDiagrams(matches) {
	const issues = [];

	for (const p of matches.unmatchedRefPlayers) {
		issues.push({
			severity: 'blocking',
			type: 'missing_player',
			message: `Missing player: ${p.name} (${p.type})`,
		});
	}

	for (const p of matches.unmatchedCandPlayers) {
		issues.push({
			severity: 'cosmetic',
			type: 'extra_player',
			message: `Extra player in candidate: ${p.name}`,
		});
	}

	// Check state change counts for matched players
	for (const pair of matches.players) {
		const refCount = pair.ref.stateChanges.length;
		const candCount = pair.cand.stateChanges.length;
		if (candCount < refCount) {
			issues.push({
				severity: 'blocking',
				type: 'missing_state_changes',
				message: `Player ${pair.ref.name}: missing state changes (ref=${refCount}, cand=${candCount})`,
			});
		} else if (candCount > refCount) {
			issues.push({
				severity: 'cosmetic',
				type: 'extra_state_changes',
				message: `Player ${pair.ref.name}: extra state changes (ref=${refCount}, cand=${candCount})`,
			});
		}
	}

	for (const c of matches.unmatchedRefConstraints) {
		issues.push({
			severity: 'important',
			type: 'missing_constraint',
			message: `Missing constraint: @${c.time1} <--> @${c.time2}${c.label ? ' : ' + c.label : ''}`,
		});
	}

	for (const m of matches.unmatchedRefMessages) {
		issues.push({
			severity: 'important',
			type: 'missing_message',
			message: `Missing message: ${m.fromPlayer} --> ${m.toPlayer}${m.label ? ' : ' + m.label : ''}`,
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
		`Players: ref=${refDiagram.players.length}, cand=${candDiagram.players.length}`,
		`Constraints: ref=${refDiagram.constraints.length}, cand=${candDiagram.constraints.length}`,
		`Messages: ref=${refDiagram.messages.length}, cand=${candDiagram.messages.length}`,
	].join('; ');

	return {
		score,
		blocking,
		important,
		cosmetic,
		summary,
	};
}
