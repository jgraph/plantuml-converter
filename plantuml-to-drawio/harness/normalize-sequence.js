/**
 * normalize.js
 *
 * Normalized diagram representation for structural comparison.
 * Both PlantUML SVG and draw.io XML get converted to this common
 * model, then matched and diffed.
 */

// ── Normalized element types ──────────────────────────────────────────────

export class NParticipant {
	constructor(name, type, index) {
		this.name = name;            // Display name
		this.type = type || 'participant'; // participant|actor|boundary|control|entity|queue|database|collections
		this.index = index;          // Left-to-right position (0, 1, 2, ...)
	}
}

export class NMessage {
	constructor(from, to, label, style) {
		this.from = from;            // Participant display name
		this.to = to;                // Participant display name
		this.label = label || '';    // Message text
		this.style = style || {};    // { dashed: bool, arrowType: 'filled'|'open'|'cross'|'none' }
		this.orderIndex = 0;         // Sequential position in diagram
		this.isSelf = false;         // Self-message (from === to)
	}
}

export class NActivation {
	constructor(participant, startMsgIndex, endMsgIndex) {
		this.participant = participant; // Display name
		this.startMsgIndex = startMsgIndex;
		this.endMsgIndex = endMsgIndex;
	}
}

export class NFragment {
	constructor(type, label, sections) {
		this.type = type || '';       // alt|loop|opt|par|break|critical|group
		this.label = label || '';     // Condition text
		this.sections = sections || []; // [{ condition, messageIndices }]
	}
}

export class NNote {
	constructor(text, participants, position) {
		this.text = text || '';
		this.participants = participants || [];
		this.position = position || 'over'; // left|right|over
	}
}

export class NDivider {
	constructor(label) {
		this.label = label || '';
	}
}

export class NormalizedDiagram {
	constructor() {
		this.title = null;
		this.participants = [];   // NParticipant[]
		this.messages = [];       // NMessage[]
		this.activations = [];    // NActivation[]
		this.fragments = [];      // NFragment[]
		this.notes = [];          // NNote[]
		this.dividers = [];       // NDivider[]
	}
}

// ── Text normalization ────────────────────────────────────────────────────

function normalizeText(s) {
	if (!s) return '';
	return s
		.replace(/<br\s*\/?>/gi, ' ')    // <br> → space
		.replace(/\\n/g, ' ')             // literal \n → space
		.replace(/\n/g, ' ')              // actual newlines → space
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

function textsMatch(a, b) {
	return normalizeText(a) === normalizeText(b);
}

// ── Matching ──────────────────────────────────────────────────────────────

/**
 * Match elements between reference and candidate diagrams.
 * Returns { participants, messages, fragments, notes, dividers, activations }
 * where each is { matched: [{ref, cand}], refOnly: [], candOnly: [] }.
 */
export function matchDiagrams(ref, cand) {
	const result = {};

	// Match participants by normalized name
	result.participants = matchByName(ref.participants, cand.participants, p => p.name);

	// Match messages by label + from + to (in order)
	result.messages = matchMessages(ref.messages, cand.messages);

	// Match fragments by type (primary), not label (label differences are secondary)
	result.fragments = matchByKey(
		ref.fragments, cand.fragments,
		f => normalizeText(f.type)
	);

	// Match notes by text content
	result.notes = matchByKey(
		ref.notes, cand.notes,
		n => normalizeText(n.text)
	);

	// Match dividers by label
	result.dividers = matchByKey(
		ref.dividers, cand.dividers,
		d => normalizeText(d.label)
	);

	// Match activations by participant
	result.activations = matchActivations(ref.activations, cand.activations);

	return result;
}

function matchByName(refList, candList, nameGetter) {
	const matched = [];
	const candUsed = new Set();

	for (const ref of refList) {
		const refName = normalizeText(nameGetter(ref));
		let found = false;
		for (let i = 0; i < candList.length; i++) {
			if (candUsed.has(i)) continue;
			if (normalizeText(nameGetter(candList[i])) === refName) {
				matched.push({ ref, cand: candList[i] });
				candUsed.add(i);
				found = true;
				break;
			}
		}
		if (!found) {
			matched.push({ ref, cand: null });
		}
	}

	const candOnly = candList.filter((_, i) => !candUsed.has(i));
	return { matched, candOnly };
}

function matchByKey(refList, candList, keyFn) {
	const matched = [];
	const candUsed = new Set();

	for (const ref of refList) {
		const key = keyFn(ref);
		let found = false;
		for (let i = 0; i < candList.length; i++) {
			if (candUsed.has(i)) continue;
			if (keyFn(candList[i]) === key) {
				matched.push({ ref, cand: candList[i] });
				candUsed.add(i);
				found = true;
				break;
			}
		}
		if (!found) {
			matched.push({ ref, cand: null });
		}
	}

	const candOnly = candList.filter((_, i) => !candUsed.has(i));
	return { matched, candOnly };
}

function matchMessages(refMsgs, candMsgs) {
	const matched = [];
	const candUsed = new Set();

	// First pass: match by label + from + to
	for (const ref of refMsgs) {
		let found = false;
		for (let i = 0; i < candMsgs.length; i++) {
			if (candUsed.has(i)) continue;
			const cand = candMsgs[i];
			if (textsMatch(ref.label, cand.label) &&
				textsMatch(ref.from, cand.from) &&
				textsMatch(ref.to, cand.to)) {
				matched.push({ ref, cand });
				candUsed.add(i);
				found = true;
				break;
			}
		}
		if (!found) {
			// Second pass: match by label only (connectivity may differ)
			for (let i = 0; i < candMsgs.length; i++) {
				if (candUsed.has(i)) continue;
				if (textsMatch(ref.label, candMsgs[i].label)) {
					matched.push({ ref, cand: candMsgs[i] });
					candUsed.add(i);
					found = true;
					break;
				}
			}
		}
		if (!found) {
			matched.push({ ref, cand: null });
		}
	}

	const candOnly = candMsgs.filter((_, i) => !candUsed.has(i));
	return { matched, candOnly };
}

function matchActivations(refActs, candActs) {
	const matched = [];
	const candUsed = new Set();

	for (const ref of refActs) {
		let found = false;
		for (let i = 0; i < candActs.length; i++) {
			if (candUsed.has(i)) continue;
			if (textsMatch(ref.participant, candActs[i].participant)) {
				matched.push({ ref, cand: candActs[i] });
				candUsed.add(i);
				found = true;
				break;
			}
		}
		if (!found) {
			matched.push({ ref, cand: null });
		}
	}

	const candOnly = candActs.filter((_, i) => !candUsed.has(i));
	return { matched, candOnly };
}

// ── Diffing ───────────────────────────────────────────────────────────────

/**
 * Produce a categorized diff report from matched diagrams.
 * Returns { blocking: [], important: [], cosmetic: [] }
 */
export function diffDiagrams(matches) {
	const blocking = [];
	const important = [];
	const cosmetic = [];

	// ── Participants ──
	for (const { ref, cand } of matches.participants.matched) {
		if (cand === null) {
			blocking.push({
				description: `Missing participant: "${ref.name}"`,
				location: `participant "${ref.name}"`
			});
			continue;
		}
		if (ref.type !== cand.type && ref.type !== 'participant') {
			important.push({
				description: `Participant "${ref.name}" should be type "${ref.type}" but is "${cand.type}"`,
				location: `participant "${ref.name}"`
			});
		}
		if (ref.index !== cand.index) {
			important.push({
				description: `Participant "${ref.name}" should be at position ${ref.index} but is at ${cand.index}`,
				location: `participant "${ref.name}"`
			});
		}
	}
	for (const cand of matches.participants.candOnly) {
		blocking.push({
			description: `Extra participant in candidate: "${cand.name}"`,
			location: `participant "${cand.name}"`
		});
	}

	// ── Messages ──
	for (const { ref, cand } of matches.messages.matched) {
		if (cand === null) {
			blocking.push({
				description: `Missing message: "${ref.label}" (${ref.from} → ${ref.to})`,
				location: `message #${ref.orderIndex}: "${ref.label}"`
			});
			continue;
		}
		// Check connectivity
		if (!textsMatch(ref.from, cand.from) || !textsMatch(ref.to, cand.to)) {
			blocking.push({
				description: `Message "${ref.label}" connects ${ref.from}→${ref.to} in reference but ${cand.from}→${cand.to} in candidate`,
				location: `message "${ref.label}"`
			});
		}
		// Check style
		if (ref.style.dashed !== undefined && cand.style.dashed !== undefined && ref.style.dashed !== cand.style.dashed) {
			important.push({
				description: `Message "${ref.label}" should be ${ref.style.dashed ? 'dashed' : 'solid'} but is ${cand.style.dashed ? 'dashed' : 'solid'}`,
				location: `message "${ref.label}"`
			});
		}
		if (ref.style.arrowType && cand.style.arrowType && ref.style.arrowType !== cand.style.arrowType) {
			important.push({
				description: `Message "${ref.label}" arrowhead should be "${ref.style.arrowType}" but is "${cand.style.arrowType}"`,
				location: `message "${ref.label}"`
			});
		}
		// Check order
		if (ref.orderIndex !== cand.orderIndex) {
			const severity = Math.abs(ref.orderIndex - cand.orderIndex) > 2 ? blocking : important;
			severity.push({
				description: `Message "${ref.label}" at position ${ref.orderIndex} in reference but ${cand.orderIndex} in candidate`,
				location: `message "${ref.label}"`
			});
		}
	}
	for (const cand of matches.messages.candOnly) {
		blocking.push({
			description: `Extra message in candidate: "${cand.label}" (${cand.from} → ${cand.to})`,
			location: `message "${cand.label}"`
		});
	}

	// ── Fragments ──
	for (const { ref, cand } of matches.fragments.matched) {
		if (cand === null) {
			blocking.push({
				description: `Missing fragment: ${ref.type} [${ref.label}]`,
				location: `fragment "${ref.type} [${ref.label}]"`
			});
			continue;
		}
		if (!textsMatch(ref.type, cand.type)) {
			important.push({
				description: `Fragment type should be "${ref.type}" but is "${cand.type}"`,
				location: `fragment "${ref.type} [${ref.label}]"`
			});
		}
	}
	for (const cand of matches.fragments.candOnly) {
		important.push({
			description: `Extra fragment in candidate: ${cand.type} [${cand.label}]`,
			location: `fragment "${cand.type} [${cand.label}]"`
		});
	}

	// ── Notes ──
	for (const { ref, cand } of matches.notes.matched) {
		if (cand === null) {
			important.push({
				description: `Missing note: "${ref.text.substring(0, 40)}"`,
				location: `note "${ref.text.substring(0, 40)}"`
			});
			continue;
		}
		if (ref.position !== cand.position) {
			cosmetic.push({
				description: `Note "${ref.text.substring(0, 30)}" position: "${ref.position}" vs "${cand.position}"`,
				location: `note "${ref.text.substring(0, 30)}"`
			});
		}
	}
	for (const cand of matches.notes.candOnly) {
		cosmetic.push({
			description: `Extra note in candidate: "${cand.text.substring(0, 40)}"`,
			location: `note "${cand.text.substring(0, 40)}"`
		});
	}

	// ── Activations ──
	for (const { ref, cand } of matches.activations.matched) {
		if (cand === null) {
			important.push({
				description: `Missing activation bar on "${ref.participant}"`,
				location: `activation on "${ref.participant}"`
			});
		}
	}
	for (const cand of matches.activations.candOnly) {
		important.push({
			description: `Extra activation bar on "${cand.participant}"`,
			location: `activation on "${cand.participant}"`
		});
	}

	// ── Dividers ──
	for (const { ref, cand } of matches.dividers.matched) {
		if (cand === null) {
			cosmetic.push({
				description: `Missing divider: "${ref.label}"`,
				location: `divider "${ref.label}"`
			});
		}
	}
	for (const cand of matches.dividers.candOnly) {
		cosmetic.push({
			description: `Extra divider in candidate: "${cand.label}"`,
			location: `divider "${cand.label}"`
		});
	}

	return { blocking, important, cosmetic };
}

// ── Report ────────────────────────────────────────────────────────────────

/**
 * Build a complete comparison report from a diff.
 */
export function buildReport(diff, refDiagram, candDiagram) {
	const { blocking, important, cosmetic } = diff;

	let score = 'pass';
	if (blocking.length > 0) {
		score = 'fail';
	} else if (important.length > 0) {
		score = 'needs_work';
	}

	const parts = [];
	const refMsgCount = refDiagram.messages.length;
	const candMsgCount = candDiagram.messages.length;
	const refPartCount = refDiagram.participants.length;
	const candPartCount = candDiagram.participants.length;

	parts.push(`${candPartCount}/${refPartCount} participants`);
	parts.push(`${candMsgCount}/${refMsgCount} messages`);

	if (blocking.length > 0) {
		parts.push(`${blocking.length} blocking`);
	}
	if (important.length > 0) {
		parts.push(`${important.length} important`);
	}
	if (cosmetic.length > 0) {
		parts.push(`${cosmetic.length} cosmetic`);
	}

	return {
		blocking,
		important,
		cosmetic,
		summary: parts.join(', ') + '.',
		score
	};
}
