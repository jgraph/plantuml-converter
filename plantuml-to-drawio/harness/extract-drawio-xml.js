/**
 * extract-drawio-xml.js
 *
 * Extracts a NormalizedDiagram from a .drawio mxCell XML file.
 * Since we generate this XML, we know the exact structure and style patterns.
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

// ── Cell parsing ──────────────────────────────────────────────────────────

/**
 * Parse all mxCell elements from draw.io XML.
 */
function parseCells(xmlText) {
	const cells = [];

	// Match self-closing and content-bearing mxCell elements
	const cellRegex = /<mxCell\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g;
	let m;

	while ((m = cellRegex.exec(xmlText)) !== null) {
		const attrStr = m[1];
		const innerContent = m[2] || '';
		const cell = {
			id: extractAttr(attrStr, 'id'),
			value: decodeXml(extractAttr(attrStr, 'value') || ''),
			style: extractAttr(attrStr, 'style') || '',
			vertex: extractAttr(attrStr, 'vertex') === '1',
			edge: extractAttr(attrStr, 'edge') === '1',
			parent: extractAttr(attrStr, 'parent'),
			source: extractAttr(attrStr, 'source'),
			target: extractAttr(attrStr, 'target'),
			geometry: parseGeometry(innerContent || attrStr),
		};
		cells.push(cell);
	}

	return cells;
}

function extractAttr(str, name) {
	const re = new RegExp(`${name}="([^"]*)"`, 'i');
	const m = str.match(re);
	return m ? m[1] : null;
}

function decodeXml(str) {
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function parseGeometry(content) {
	const geo = {};

	// Vertex geometry: <mxGeometry x="..." y="..." width="..." height="..." .../>
	const geoMatch = content.match(/<mxGeometry([^>]*)>/);
	if (geoMatch) {
		const geoStr = geoMatch[1];
		const x = extractAttr(geoStr, 'x');
		const y = extractAttr(geoStr, 'y');
		const w = extractAttr(geoStr, 'width');
		const h = extractAttr(geoStr, 'height');
		if (x !== null) geo.x = parseFloat(x);
		if (y !== null) geo.y = parseFloat(y);
		if (w !== null) geo.width = parseFloat(w);
		if (h !== null) geo.height = parseFloat(h);
	}

	// Edge points: <mxPoint x="..." y="..." as="sourcePoint|targetPoint"/>
	const srcMatch = content.match(/<mxPoint[^>]*as="sourcePoint"[^>]*>/);
	if (srcMatch) {
		const sx = extractAttr(srcMatch[0], 'x');
		const sy = extractAttr(srcMatch[0], 'y');
		if (sx !== null && sy !== null) {
			geo.sourcePoint = { x: parseFloat(sx), y: parseFloat(sy) };
		}
	}

	const tgtMatch = content.match(/<mxPoint[^>]*as="targetPoint"[^>]*>/);
	if (tgtMatch) {
		const tx = extractAttr(tgtMatch[0], 'x');
		const ty = extractAttr(tgtMatch[0], 'y');
		if (tx !== null && ty !== null) {
			geo.targetPoint = { x: parseFloat(tx), y: parseFloat(ty) };
		}
	}

	return geo;
}

// ── Style helpers ─────────────────────────────────────────────────────────

function hasStyle(cell, key, value) {
	if (value !== undefined) {
		return cell.style.includes(`${key}=${value}`);
	}
	return cell.style.includes(key);
}

function getStyleValue(cell, key) {
	const re = new RegExp(`${key}=([^;]+)`);
	const m = cell.style.match(re);
	return m ? m[1] : null;
}

// ── Cell classification ───────────────────────────────────────────────────

function isGroup(cell) {
	return cell.vertex && hasStyle(cell, 'container', '1');
}

function isParticipantHeader(cell, groupIds) {
	if (!cell.vertex) return false;
	if (!groupIds.has(cell.parent)) return false;
	// Participant headers have small y (at top of their group)
	// and have recognizable participant styles
	const style = cell.style;
	return (
		hasStyle(cell, 'rounded') ||
		hasStyle(cell, 'shape', 'umlActor') ||
		hasStyle(cell, 'shape', 'cylinder3') ||
		hasStyle(cell, 'shape', 'umlBoundary') ||
		hasStyle(cell, 'shape', 'umlControl') ||
		hasStyle(cell, 'shape', 'umlEntity') ||
		hasStyle(cell, 'shape', 'mxgraph.flowchart.delay') ||
		hasStyle(cell, 'shape', 'mxgraph.basic.layered_rect')
	);
}

function isMessage(cell) {
	return cell.edge && hasStyle(cell, 'verticalAlign', 'bottom');
}

function isLifeline(cell) {
	return cell.edge && hasStyle(cell, 'endArrow', 'none') && hasStyle(cell, 'dashed', '1');
}

function isActivation(cell) {
	return cell.vertex && hasStyle(cell, 'targetShapes', 'umlLifeline');
}

function isNote(cell) {
	return cell.vertex && (
		hasStyle(cell, 'shape', 'note') ||
		hasStyle(cell, 'shape', 'hexagon') // hnote
	);
}

function isDivider(cell) {
	return cell.vertex && hasStyle(cell, 'shape', 'line') && hasStyle(cell, 'labelPosition', 'center');
}

function isFragment(cell) {
	// Fragment containers: fillColor=none + strokeColor=#666666 + dashed
	return cell.vertex && hasStyle(cell, 'fillColor', 'none') &&
		hasStyle(cell, 'strokeColor', '#666666') && hasStyle(cell, 'dashed', '1') &&
		!hasStyle(cell, 'dashPattern'); // boxes have dashPattern, fragments don't
}

function isFragmentLabel(cell) {
	return cell.vertex && hasStyle(cell, 'fillColor', '#e6e6e6') && hasStyle(cell, 'strokeColor', '#666666');
}

function isReference(cell) {
	return cell.vertex && hasStyle(cell, 'fillColor', '#f5f5f5') && hasStyle(cell, 'strokeColor', '#666666');
}

// ── Participant type from style ───────────────────────────────────────────

function detectParticipantType(cell) {
	if (hasStyle(cell, 'shape', 'umlActor')) return 'actor';
	if (hasStyle(cell, 'shape', 'cylinder3')) return 'database';
	if (hasStyle(cell, 'shape', 'umlBoundary')) return 'boundary';
	if (hasStyle(cell, 'shape', 'umlControl')) return 'control';
	if (hasStyle(cell, 'shape', 'umlEntity')) return 'entity';
	if (hasStyle(cell, 'shape', 'mxgraph.flowchart.delay')) return 'queue';
	if (hasStyle(cell, 'shape', 'mxgraph.basic.layered_rect')) return 'collections';
	return 'participant';
}

// ── Message style detection ───────────────────────────────────────────────

function detectMessageStyle(cell) {
	const dashed = hasStyle(cell, 'dashed', '1');

	let arrowType = 'filled';
	const endArrow = getStyleValue(cell, 'endArrow');
	const endFill = getStyleValue(cell, 'endFill');

	if (endArrow === 'open') {
		arrowType = 'open';
	} else if (endArrow === 'block') {
		arrowType = endFill === '0' ? 'open' : 'filled';
	} else if (endArrow === 'cross') {
		arrowType = 'cross';
	}

	return { dashed, arrowType };
}

// ── Main extractor ────────────────────────────────────────────────────────

/**
 * Extract a NormalizedDiagram from draw.io XML text.
 */
export function extractFromDrawioXml(xmlText) {
	const diagram = new NormalizedDiagram();
	const cells = parseCells(xmlText);

	// Build lookup maps
	const cellById = new Map();
	for (const cell of cells) {
		if (cell.id) cellById.set(cell.id, cell);
	}

	// Find group containers (participant columns)
	const groupIds = new Set();
	const groupCells = [];
	for (const cell of cells) {
		if (isGroup(cell)) {
			groupIds.add(cell.id);
			groupCells.push(cell);
		}
	}

	// Sort groups by x position for left-to-right ordering
	groupCells.sort((a, b) => (a.geometry.x || 0) - (b.geometry.x || 0));

	// Map group ID → participant info
	const groupToParticipant = new Map(); // groupId → { name, type, index, centerX }

	// ── Extract participants ──
	// For each group, find the first participant header cell (smallest y)
	for (let gi = 0; gi < groupCells.length; gi++) {
		const group = groupCells[gi];
		let headerCell = null;
		let minY = Infinity;

		for (const cell of cells) {
			if (cell.parent !== group.id) continue;
			if (!isParticipantHeader(cell, groupIds)) continue;
			const y = cell.geometry.y || 0;
			if (y < minY) {
				minY = y;
				headerCell = cell;
			}
		}

		if (headerCell) {
			const name = headerCell.value;
			const type = detectParticipantType(headerCell);
			const centerX = (group.geometry.x || 0) + (group.geometry.width || 0) / 2;

			diagram.participants.push(new NParticipant(name, type, gi));
			groupToParticipant.set(group.id, { name, type, index: gi, centerX });
		}
	}

	// Build centerX → participant name lookup for message endpoint matching
	const centerXToName = [];
	for (const [, info] of groupToParticipant) {
		centerXToName.push({ x: info.centerX, name: info.name });
	}

	function findParticipantByX(x) {
		if (centerXToName.length === 0) return null;
		let closest = centerXToName[0];
		let minDist = Math.abs(x - closest.x);
		for (let i = 1; i < centerXToName.length; i++) {
			const dist = Math.abs(x - centerXToName[i].x);
			if (dist < minDist) {
				minDist = dist;
				closest = centerXToName[i];
			}
		}
		// Tolerance: 20px for activation bar offset
		return minDist < 30 ? closest.name : null;
	}

	// ── Extract messages ──
	const messageCells = cells.filter(c => isMessage(c) && !isLifeline(c));

	// Sort by Y position (top-to-bottom order)
	messageCells.sort((a, b) => {
		const ay = a.geometry.sourcePoint ? a.geometry.sourcePoint.y : (a.geometry.y || 0);
		const by = b.geometry.sourcePoint ? b.geometry.sourcePoint.y : (b.geometry.y || 0);
		return ay - by;
	});

	for (let i = 0; i < messageCells.length; i++) {
		const cell = messageCells[i];
		const sp = cell.geometry.sourcePoint;
		const tp = cell.geometry.targetPoint;

		let fromName = null;
		let toName = null;

		if (sp && tp) {
			fromName = findParticipantByX(sp.x);
			toName = findParticipantByX(tp.x);
		}

		const style = detectMessageStyle(cell);
		const label = cell.value || '';

		const msg = new NMessage(
			fromName || '?',
			toName || '?',
			label,
			style
		);
		msg.orderIndex = i;
		msg.isSelf = (fromName !== null && fromName === toName);

		diagram.messages.push(msg);
	}

	// ── Extract activations ──
	for (const cell of cells) {
		if (!isActivation(cell)) continue;

		// Find which participant group this activation belongs to
		const groupInfo = groupToParticipant.get(cell.parent);
		if (groupInfo) {
			diagram.activations.push(new NActivation(groupInfo.name, -1, -1));
		}
	}

	// ── Extract fragments ──
	for (const cell of cells) {
		if (isFragment(cell)) {
			// Fragment type/label from the value attribute
			const value = cell.value || '';
			diagram.fragments.push(new NFragment(value.toLowerCase(), value, []));
		} else if (isFragmentLabel(cell)) {
			// Fragment label cells contain the type keyword (alt, loop, etc.)
			const value = cell.value || '';
			const lower = value.toLowerCase();
			const fragTypes = ['alt', 'loop', 'opt', 'par', 'break', 'critical', 'group', 'ref'];
			if (fragTypes.includes(lower)) {
				// Check if we already have this fragment from the container cell
				const exists = diagram.fragments.some(f => f.type === lower);
				if (!exists) {
					diagram.fragments.push(new NFragment(lower, '', []));
				}
			}
		}
	}

	// ── Extract notes ──
	for (const cell of cells) {
		if (isNote(cell)) {
			diagram.notes.push(new NNote(cell.value || '', [], 'over'));
		}
	}

	// ── Extract dividers ──
	for (const cell of cells) {
		if (isDivider(cell)) {
			diagram.dividers.push(new NDivider(cell.value || ''));
		}
	}

	// ── Extract title ──
	// Title is stored in the UserObject or as the first text-bearing element
	const titleMatch = xmlText.match(/label="([^"]*)"[^>]*plantUml="/);
	// Actually, title might not be in UserObject label. Check for a title cell.
	// For now, skip title extraction from drawio XML — it's cosmetic.

	return diagram;
}
