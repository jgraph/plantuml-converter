/**
 * extract-plantuml-svg.js
 *
 * Extracts a NormalizedDiagram from a PlantUML-generated SVG.
 * PlantUML SVGs have rich semantic attributes:
 *   - class="participant participant-head" data-entity-uid="partN" data-qualified-name="..."
 *   - class="message" data-entity-1="partN" data-entity-2="partM"
 *   - class="participant-lifeline" data-entity-uid="partN"
 */

import {
	NormalizedDiagram,
	NParticipant,
	NMessage,
	NActivation,
	NFragment,
	NNote,
	NDivider
} from './normalize.js';

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extract attribute value from an XML/SVG tag string.
 */
function attr(tag, name) {
	const re = new RegExp(`${name}="([^"]*)"`, 'i');
	const m = tag.match(re);
	return m ? m[1] : null;
}

/**
 * Extract all <text> content within a chunk of SVG.
 * Returns array of text strings.
 */
function extractTexts(svgChunk) {
	const texts = [];
	const re = /<text[^>]*>([^<]*)<\/text>/g;
	let m;
	while ((m = re.exec(svgChunk)) !== null) {
		const t = m[1].trim();
		if (t) texts.push(t);
	}
	return texts;
}

/**
 * Extract first <text> content within a chunk.
 */
function extractFirstText(svgChunk) {
	const texts = extractTexts(svgChunk);
	return texts.length > 0 ? texts[0] : '';
}

/**
 * Get the first numeric attribute value from an element matching a regex.
 */
function extractNumericAttr(svgChunk, elemRegex, attrName) {
	const m = svgChunk.match(elemRegex);
	if (!m) return null;
	const val = attr(m[0], attrName);
	return val !== null ? parseFloat(val) : null;
}

/**
 * Split SVG into <g ...>...</g> top-level groups.
 * PlantUML SVGs have all content in one line, so we split on <g and
 * match the class/data attributes.
 */
function splitGroups(svg) {
	const groups = [];
	// Match <g ...>...</g> but handle nested <g> by counting depth
	// Simpler approach: split on '<g ' and track nesting for each group
	const parts = svg.split(/(?=<g\s)/);
	for (const part of parts) {
		if (part.startsWith('<g ')) {
			groups.push(part);
		}
	}
	return groups;
}

// ── Main extractor ────────────────────────────────────────────────────────

/**
 * Extract a NormalizedDiagram from PlantUML SVG text.
 */
export function extractFromPlantUmlSvg(svgText) {
	const diagram = new NormalizedDiagram();

	// Build participant UID → info map
	const uidToName = new Map();   // partN → display name
	const uidToX = new Map();      // partN → x coordinate (for ordering)
	const uidToType = new Map();   // partN → participant type

	const groups = splitGroups(svgText);

	// ── Extract participants ──
	for (const g of groups) {
		if (!/class="participant\s+participant-head"/.test(g)) continue;

		const uid = attr(g, 'data-entity-uid');
		if (!uid) continue;

		// Display name from <text> child
		const name = extractFirstText(g);
		if (!name) continue;

		uidToName.set(uid, name);

		// X position from first <rect> or <text>
		const rectX = extractNumericAttr(g, /<rect[^>]+>/, 'x');
		const textX = extractNumericAttr(g, /<text[^>]+>/, 'x');
		const x = rectX !== null ? rectX : (textX !== null ? textX : 0);
		uidToX.set(uid, x);

		// Determine participant type from shapes
		const type = detectParticipantType(g);
		uidToType.set(uid, type);
	}

	// Sort participants by x coordinate for left-to-right ordering
	const sortedUids = [...uidToName.keys()].sort((a, b) => {
		return (uidToX.get(a) || 0) - (uidToX.get(b) || 0);
	});

	for (let i = 0; i < sortedUids.length; i++) {
		const uid = sortedUids[i];
		diagram.participants.push(new NParticipant(
			uidToName.get(uid),
			uidToType.get(uid) || 'participant',
			i
		));
	}

	// ── Extract messages ──
	let msgIndex = 0;
	for (const g of groups) {
		if (!/class="message"/.test(g)) continue;

		const uid1 = attr(g, 'data-entity-1');
		const uid2 = attr(g, 'data-entity-2');
		if (!uid1 || !uid2) continue;

		const fromName = uidToName.get(uid1) || uid1;
		const toName = uidToName.get(uid2) || uid2;
		const label = extractFirstText(g);

		// Determine arrow style
		const dashed = /stroke-dasharray/.test(g);
		const arrowType = detectArrowType(g);

		const msg = new NMessage(fromName, toName, label, { dashed, arrowType });
		msg.orderIndex = msgIndex++;
		msg.isSelf = (uid1 === uid2);

		diagram.messages.push(msg);
	}

	// ── Extract activations ──
	// Activation bars: <rect fill="#FFFFFF" width="10" inside participant-lifeline groups
	for (const g of groups) {
		if (!/class="participant-lifeline"/.test(g)) continue;

		const uid = attr(g, 'data-entity-uid');
		if (!uid) continue;
		const participantName = uidToName.get(uid) || uid;

		// Find white activation rects (width=10, fill=#FFFFFF)
		const activationRegex = /<rect\s+fill="#FFFFFF"[^>]*width="10"[^>]*>/g;
		let am;
		while ((am = activationRegex.exec(g)) !== null) {
			// We don't know exact message indices from SVG coordinates,
			// but we record per-participant activations for count comparison
			diagram.activations.push(new NActivation(participantName, -1, -1));
		}
	}

	// ── Extract fragments ──
	// Fragments: <rect fill="none" ... stroke-width:1.5> followed by tab path and text
	extractFragments(svgText, diagram);

	// ── Extract notes ──
	// Notes: <path fill="#FEFFDD"> with nearby <text>
	extractNotes(svgText, diagram, uidToName, uidToX);

	// ── Extract dividers ──
	// Dividers: <rect fill="#EEEEEE"> full-width with <text> label
	extractDividers(svgText, diagram);

	// ── Extract title ──
	// Title appears as a standalone <text> element before participant groups
	extractTitle(svgText, diagram, uidToX);

	return diagram;
}

// ── Participant type detection ────────────────────────────────────────────

function detectParticipantType(groupSvg) {
	// Actor: has <ellipse> (head) and <path> (body/limbs)
	if (/<ellipse/.test(groupSvg) && /<path/.test(groupSvg)) {
		return 'actor';
	}
	// Database: cylinder shape — <path> with arc curves, no <ellipse>
	// PlantUML draws cylinders with specific path patterns
	if (/<path[^>]*d="[^"]*[Aa]\s/i.test(groupSvg) && !/<ellipse/.test(groupSvg)) {
		// Check if it looks like a cylinder (has arc commands)
		const pathD = groupSvg.match(/<path[^>]*d="([^"]*)"/);
		if (pathD && /[Aa]/.test(pathD[1]) && /[Cc]/.test(pathD[1])) {
			return 'database';
		}
	}
	// Boundary: circle + line pattern (specific path geometry)
	if (/<circle/.test(groupSvg) || (/<ellipse/.test(groupSvg) && /<line/.test(groupSvg))) {
		// Could be boundary, control, or entity — hard to distinguish without more detail
		// For now, if there's a circle but not the actor pattern, try more specific checks
	}
	// Default: regular participant (rectangle)
	return 'participant';
}

// ── Arrow type detection ──────────────────────────────────────────────────

function detectArrowType(messageSvg) {
	// Check for <polygon> (filled arrowhead) vs open arrow
	if (/<polygon[^>]*fill="#181818"/.test(messageSvg)) {
		return 'filled';
	}
	if (/<polygon[^>]*fill="none"/.test(messageSvg) || /<polygon[^>]*fill="#FFFFFF"/.test(messageSvg)) {
		return 'open';
	}
	// Cross: usually rendered as two short lines forming an X
	// For simplicity, check for absence of polygon = no arrowhead or special
	if (!/<polygon/.test(messageSvg)) {
		return 'none';
	}
	return 'filled'; // default
}

// ── Fragment extraction ───────────────────────────────────────────────────

function extractFragments(svgText, diagram) {
	// Fragments are rendered as:
	//   <rect fill="none" ... stroke-width:1.5> — the border
	//   <path fill="#EEEEEE" ... stroke-width:1.5> — the tab
	//   <text ...>alt</text> — the fragment type/label

	// Find all fragment tab paths with adjacent text
	const tabRegex = /<path[^>]*fill="#EEEEEE"[^>]*stroke-width:1\.5[^>]*\/>/g;
	let m;
	const fragTexts = [];

	// Extract text that appears near fragment tabs
	// Strategy: find all bold text that follows a #EEEEEE path (fragment type labels)
	const boldTextRegex = /<text[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/g;
	while ((m = boldTextRegex.exec(svgText)) !== null) {
		const text = m[1].trim();
		if (text) fragTexts.push(text);
	}

	// Fragment types we recognize
	const fragTypes = new Set(['alt', 'else', 'loop', 'opt', 'par', 'break', 'critical', 'group', 'ref']);

	for (const text of fragTexts) {
		// Check if this is a fragment type keyword
		const lower = text.toLowerCase();
		if (fragTypes.has(lower) && lower !== 'else') {
			diagram.fragments.push(new NFragment(lower, '', []));
		}
	}

	// Also find fragment conditions from non-bold text near fragment borders
	// This is approximate — we capture the main fragment types and labels
	const conditionRegex = /\[([^\]]+)\]/g;
	while ((m = conditionRegex.exec(svgText)) !== null) {
		// Conditions in square brackets like [payment success], [payment failed]
		// These are rendered as part of the fragment text
	}
}

// ── Note extraction ───────────────────────────────────────────────────────

function extractNotes(svgText, diagram, uidToName, uidToX) {
	// Notes have fill="#FEFFDD" (yellow)
	// Find all note paths and their adjacent text
	const noteRegex = /<path[^>]*fill="#FEFFDD"[^>]*\/>/g;
	const notePositions = [];
	let m;

	while ((m = noteRegex.exec(svgText)) !== null) {
		// Extract x coordinate from the path's d attribute
		const dAttr = m[0].match(/d="([^"]*)"/);
		if (!dAttr) continue;

		const xMatch = dAttr[1].match(/^M\s*([\d.]+)/);
		const x = xMatch ? parseFloat(xMatch[1]) : 0;

		// Only record unique notes (PlantUML renders note shape as two paths)
		if (notePositions.length === 0 || Math.abs(notePositions[notePositions.length - 1] - x) > 5) {
			notePositions.push(x);
		}
	}

	// Extract note text — text that appears between/after note paths
	// Find text elements with note-like positioning
	const allTexts = [];
	const textRegex = /<text[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
	while ((m = textRegex.exec(svgText)) !== null) {
		allTexts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), text: m[3].trim() });
	}

	// For each unique note position, find nearby text
	for (const noteX of notePositions) {
		const nearbyTexts = allTexts.filter(t =>
			Math.abs(t.x - noteX) < 150
		);
		// Filter to texts that are likely note content (not participant names or message labels)
		// This is approximate — take the first text that isn't a known participant name
		const participantNames = new Set([...uidToName.values()].map(n => n.toLowerCase()));
		for (const t of nearbyTexts) {
			if (!participantNames.has(t.text.toLowerCase()) && t.text.length > 0) {
				diagram.notes.push(new NNote(t.text, [], 'over'));
				break;
			}
		}
	}
}

// ── Divider extraction ────────────────────────────────────────────────────

function extractDividers(svgText, diagram) {
	// Dividers: <rect fill="#EEEEEE"> that spans the full width
	// followed by or containing <text> label
	// They are wide rectangles (separators), not the small fragment tabs

	// Look for wide #EEEEEE rects (width > 200) that aren't fragment tabs
	const rectRegex = /<rect[^>]*fill="#EEEEEE"[^>]*width="([\d.]+)"[^>]*>/g;
	let m;

	while ((m = rectRegex.exec(svgText)) !== null) {
		const width = parseFloat(m[1]);
		if (width < 100) continue; // Skip small rects (fragment tabs)

		// Find nearby text for the divider label
		const afterText = svgText.substring(m.index, m.index + 500);
		const textMatch = afterText.match(/<text[^>]*>([^<]*)<\/text>/);
		const label = textMatch ? textMatch[1].trim() : '';

		diagram.dividers.push(new NDivider(label));
	}
}

// ── Title extraction ──────────────────────────────────────────────────────

function extractTitle(svgText, diagram, uidToX) {
	// Title is rendered as a centered bold text before the main diagram content
	// Look for font-weight="bold" text that isn't inside a known group
	const boldTexts = [];
	const re = /<text[^>]*font-size="14"[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/g;
	let m;
	while ((m = re.exec(svgText)) !== null) {
		boldTexts.push(m[1].trim());
	}

	// Fragment types to exclude
	const fragTypes = new Set(['alt', 'else', 'loop', 'opt', 'par', 'break', 'critical', 'group', 'ref']);

	for (const text of boldTexts) {
		if (!fragTypes.has(text.toLowerCase()) && text.length > 1) {
			diagram.title = text;
			break;
		}
	}
}
