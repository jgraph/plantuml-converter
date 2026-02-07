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
} from './normalize-sequence.js';

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
	const qualNameToUid = new Map(); // qualified name → partN

	const groups = splitGroups(svgText);

	// ── Extract participants ──
	for (const g of groups) {
		if (!/class="participant\s+participant-head"/.test(g)) continue;

		const uid = attr(g, 'data-entity-uid');
		if (!uid) continue;

		const qualName = attr(g, 'data-qualified-name');
		if (qualName) qualNameToUid.set(qualName, uid);

		// Display name from <text> child
		const name = extractFirstText(g);
		if (!name) continue;

		uidToName.set(uid, name);

		// X position: use <text> x (always absolute) rather than <rect> x
		// which can be a small local offset (e.g. 2.5) within the group
		const textX = extractNumericAttr(g, /<text[^>]+>/, 'x');
		const x = textX !== null ? textX : 0;
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
	// Activation bars are <rect fill="#FFFFFF" width="10"> inside lifeline <g> groups.
	// These appear inside inner <g> with <title>QualifiedName</title>.
	// PlantUML renders each lifeline segment separately (head/foot), causing
	// duplicate activation rects. We deduplicate by participant + y-position.
	{
		const seenActivations = new Set(); // "participantName|y" to deduplicate

		const titleRegex = /<title>([^<]+)<\/title>/g;
		let tm;
		while ((tm = titleRegex.exec(svgText)) !== null) {
			const titleName = tm[1].trim();
			// Check if a white activation rect follows within 300 chars
			const after = svgText.substring(tm.index, tm.index + 300);
			const actMatch = after.match(/<rect\s+fill="#FFFFFF"[^>]*width="10"[^>]*>/);
			if (!actMatch) continue;

			// Extract y position for deduplication
			const yMatch = actMatch[0].match(/y="([\d.]+)"/);
			const y = yMatch ? yMatch[1] : 'unknown';

			// Resolve title name to participant display name
			let participantName = null;

			// Try direct match to display name
			for (const [, name] of uidToName) {
				if (name === titleName) {
					participantName = name;
					break;
				}
			}

			// Try match via qualified name → uid → display name
			if (participantName === null) {
				const uid = qualNameToUid.get(titleName);
				if (uid) {
					participantName = uidToName.get(uid) || null;
				}
			}

			if (participantName) {
				const key = `${participantName}|${y}`;
				if (!seenActivations.has(key)) {
					seenActivations.add(key);
					diagram.activations.push(new NActivation(participantName, -1, -1));
				}
			}
		}
	}

	// ── Extract title ──
	// Title appears as a <title> element at the top of the SVG, and also as
	// a bold font-size="14" <text> element. Extract from <title> first.
	extractTitle(svgText, diagram);

	// ── Extract fragments ──
	// Fragments: <rect fill="none" ... stroke-width:1.5> followed by tab path and text
	extractFragments(svgText, diagram);

	// ── Extract dividers ──
	// Dividers: <rect fill="#EEEEEE" height="3"> separator + label rect + <text>
	extractDividers(svgText, diagram);

	// ── Extract notes ──
	// Notes: <path fill="#FEFFDD"> with nearby <text>
	// Must run after title/divider extraction so we can exclude those texts
	extractNotes(svgText, diagram, uidToName);

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
	//   <text font-weight="bold">alt</text> — the fragment type keyword
	//   <text>[condition text]</text> — the condition in square brackets

	// Find fragment border rects (fill="none" with stroke-width:1.5)
	// then look for associated bold text with a recognized fragment keyword
	const fragBorderRegex = /<rect[^>]*fill="none"[^>]*stroke-width:1\.5[^>]*>/g;
	let m;
	const fragTypes = new Set(['alt', 'else', 'loop', 'opt', 'par', 'break', 'critical', 'group', 'ref']);

	while ((m = fragBorderRegex.exec(svgText)) !== null) {
		// Search 800 chars after the border rect for bold text with fragment keyword
		const after = svgText.substring(m.index, m.index + 800);
		const boldTexts = [];
		const boldRe = /<text[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/g;
		let bm;
		while ((bm = boldRe.exec(after)) !== null) {
			boldTexts.push(bm[1].trim());
		}

		for (const text of boldTexts) {
			const lower = text.toLowerCase();
			if (fragTypes.has(lower) && lower !== 'else') {
				// Extract condition if present (bracketed text after the keyword)
				const condTexts = [];
				const condRe = /\[([^\]]+)\]/g;
				let cm;
				while ((cm = condRe.exec(after)) !== null) {
					condTexts.push(cm[1].trim());
				}
				const condition = condTexts.length > 0 ? condTexts[0] : '';
				diagram.fragments.push(new NFragment(lower, condition, []));
				break; // One fragment per border rect
			}
		}
	}
}

// ── Note extraction ───────────────────────────────────────────────────────

function extractNotes(svgText, diagram, uidToName) {
	// Notes have fill="#FEFFDD" (yellow note paths)
	// PlantUML renders each note as two paths (background + fold corner)
	// followed by <text> elements with the note content.
	const noteRegex = /<path[^>]*fill="#FEFFDD"[^>]*\/>/g;
	const notePositions = []; // { x, y, index } for each unique note
	let m;

	while ((m = noteRegex.exec(svgText)) !== null) {
		// Extract x,y from the path's d attribute
		const dAttr = m[0].match(/d="([^"]*)"/);
		if (!dAttr) continue;

		const xMatch = dAttr[1].match(/^M\s*([\d.]+)/);
		const x = xMatch ? parseFloat(xMatch[1]) : 0;

		// Extract y for deduplication — both paths for a single note share
		// the same y coordinate even though x values differ (background vs fold corner)
		const yMatch = dAttr[1].match(/^M\s*[\d.]+\s*,\s*([\d.]+)/);
		const y = yMatch ? parseFloat(yMatch[1]) : 0;

		// Only record unique notes: deduplicate by y coordinate
		// (two paths per note share the same y but have very different x values)
		const isDuplicate = notePositions.some(p => Math.abs(p.y - y) < 5);
		if (!isDuplicate) {
			notePositions.push({ x, y, index: m.index });
		}
	}

	// Build a set of texts to exclude (title, divider labels, participant names, message labels, fragment types)
	const excludeTexts = new Set();
	if (diagram.title) excludeTexts.add(diagram.title.toLowerCase());
	for (const d of diagram.dividers) {
		if (d.label) excludeTexts.add(d.label.toLowerCase());
	}
	for (const [, name] of uidToName) {
		excludeTexts.add(name.toLowerCase());
	}
	for (const msg of diagram.messages) {
		if (msg.label) excludeTexts.add(msg.label.toLowerCase());
	}
	const fragKeywords = new Set(['alt', 'else', 'loop', 'opt', 'par', 'break', 'critical', 'group', 'ref']);

	// For each unique note position, find text that follows the note path in the SVG
	for (const note of notePositions) {
		// Search 600 chars after the note path for text elements
		const after = svgText.substring(note.index, note.index + 600);
		const texts = extractTexts(after);

		// Filter out texts that are clearly not note content
		const noteTexts = [];
		for (const t of texts) {
			const lower = t.toLowerCase();
			if (excludeTexts.has(lower)) continue;
			if (fragKeywords.has(lower)) continue;
			if (t.length === 0) continue;
			noteTexts.push(t);
		}

		if (noteTexts.length > 0) {
			// Join multi-line note texts
			const fullText = noteTexts.join('\\n');
			diagram.notes.push(new NNote(fullText, [], 'over'));
		}
	}
}

// ── Divider extraction ────────────────────────────────────────────────────

function extractDividers(svgText, diagram) {
	// Dividers (== text ==) in PlantUML SVG:
	//   <rect fill="#EEEEEE" height="3" ...> — thin separator bar (full-width)
	//   <line ...> — top border
	//   <line ...> — bottom border
	//   <rect fill="#EEEEEE" height="23" width="small" ...> — label background
	//   <text font-weight="bold">Label</text> — divider label
	//
	// Strategy: find thin (height ≤ 5) #EEEEEE rects that span the diagram width,
	// then look for the label text in the next 800 chars.

	const rectRegex = /<rect[^>]*fill="#EEEEEE"[^>]*>/g;
	let m;

	while ((m = rectRegex.exec(svgText)) !== null) {
		const fullTag = m[0];
		const heightStr = attr(fullTag, 'height');
		const widthStr = attr(fullTag, 'width');
		const height = heightStr ? parseFloat(heightStr) : 0;
		const width = widthStr ? parseFloat(widthStr) : 0;

		// Divider separator bars are thin (height ≤ 5) and wide (> 200)
		if (height > 5 || width < 200) continue;

		// Search for label text within 800 chars after the separator rect
		const after = svgText.substring(m.index, m.index + 800);
		const textMatch = after.match(/<text[^>]*font-weight="bold"[^>]*>([^<]*)<\/text>/);
		const label = textMatch ? textMatch[1].trim() : '';

		diagram.dividers.push(new NDivider(label));
	}
}

// ── Title extraction ──────────────────────────────────────────────────────

function extractTitle(svgText, diagram) {
	// Title is in the <title> element at the SVG root
	const titleMatch = svgText.match(/<title>([^<]+)<\/title>/);
	if (titleMatch) {
		const titleText = titleMatch[1].trim();
		// PlantUML always has a <title> — skip generic ones like "untitled"
		if (titleText && titleText.toLowerCase() !== 'untitled') {
			diagram.title = titleText;
		}
	}
}
