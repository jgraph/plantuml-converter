/**
 * extract-drawio-xml-state.js
 *
 * Extracts a NormalizedStateDiagram from the converter's draw.io XML output.
 * Since we generate this XML, we know the exact style patterns.
 */

import {
	NState,
	NCompositeState,
	NTransition,
	NNote,
	NormalizedStateDiagram,
} from './normalize-state.js';

/**
 * Extract NormalizedStateDiagram from draw.io XML text.
 * @param {string} xmlText - draw.io XML content
 * @returns {NormalizedStateDiagram}
 */
export function extractFromDrawioXml(xmlText) {
	const diagram = new NormalizedStateDiagram();
	const cells = parseCells(xmlText);

	// Classify cells
	const compositeCells = cells.filter(c =>
		c.vertex && c.style &&
		c.style.includes('container=1') &&
		c.style.includes('rounded=1')
	);

	const noteCells = cells.filter(c =>
		c.vertex && c.style &&
		c.style.includes('shape=note') &&
		c.style.includes('fillColor=#FFF2CC')
	);

	const noteCellIds = new Set(noteCells.map(c => c.id));
	const compositeCellIds = new Set(compositeCells.map(c => c.id));

	const edgeCells = cells.filter(c => c.edge);

	// Skip: root cells (0, 1), group cells, note cells, composites,
	// description body cells (fillColor=none;strokeColor=none inside swimlane),
	// edge label cells, note connector edges
	const skipCellIds = new Set([
		'0', '1',
		...noteCellIds,
		...compositeCellIds,
	]);

	// Detect swimlane body cells (children of swimlane-style states)
	const swimlaneCellIds = new Set(
		cells.filter(c => c.vertex && c.style && c.style.includes('shape=swimlane')).map(c => c.id)
	);
	const bodyChildIds = new Set(
		cells.filter(c => c.vertex && swimlaneCellIds.has(c.parent) &&
			c.style && c.style.includes('fillColor=none') && c.style.includes('strokeColor=none')
		).map(c => c.id)
	);

	const elementCells = cells.filter(c =>
		c.vertex && c.style &&
		!skipCellIds.has(c.id) &&
		!bodyChildIds.has(c.id) &&
		!c.style.includes('group;') &&
		!c.style.includes('edgeLabel=1')
	);

	// Extract composites
	for (const cell of compositeCells) {
		const name = extractNameFromValue(cell.value);
		if (!name) continue;
		const comp = new NCompositeState(name);
		diagram.composites.push(comp);
	}

	// Extract leaf states
	for (const cell of elementCells) {
		const name = extractNameFromValue(cell.value);
		let type = 'state';

		// Initial state: black filled ellipse
		if (cell.style.includes('ellipse') && cell.style.includes('fillColor=#000000')) {
			// Could be initial or inner part of final
			// Check if there's an outer unfilled ellipse at similar position
			type = 'initial';
			const st = new NState('[*]', type);
			diagram.states.push(st);
			continue;
		}

		// Final state outer: unfilled ellipse with strokeWidth=2
		if (cell.style.includes('ellipse') && cell.style.includes('strokeWidth=2') &&
			cell.style.includes('fillColor=none')) {
			type = 'final';
			const st = new NState('[*]', type);
			diagram.states.push(st);
			continue;
		}

		// Choice: rhombus
		if (cell.style.includes('rhombus')) {
			type = 'choice';
			const st = new NState(name || '', type);
			diagram.states.push(st);
			continue;
		}

		// Fork/join: black filled bar (arcSize=50)
		if (cell.style.includes('fillColor=#000000') && cell.style.includes('arcSize=50')) {
			type = 'fork_join';
			const st = new NState(name || '', type);
			diagram.states.push(st);
			continue;
		}

		// History: ellipse with H or H*
		if (cell.style.includes('ellipse') && (name === 'H' || name === 'H*')) {
			type = name === 'H*' ? 'deep_history' : 'history';
			const st = new NState(name, type);
			diagram.states.push(st);
			continue;
		}

		// Regular state or swimlane state
		if (!name) continue;
		const st = new NState(name, 'state');
		diagram.states.push(st);
	}

	// Extract notes
	for (const cell of noteCells) {
		const note = new NNote(unescapeXml(cell.value || ''));
		diagram.notes.push(note);
	}

	// Extract transitions
	for (const cell of edgeCells) {
		// Skip note connections (dashed with no arrows)
		if (cell.style &&
			cell.style.includes('endArrow=none') &&
			cell.style.includes('dashed=1')) {
			continue;
		}

		// Skip concurrent separator lines (no source/target cells)
		if (!cell.source || !cell.target) continue;

		const sourceCell = cells.find(c => c.id === cell.source);
		const targetCell = cells.find(c => c.id === cell.target);

		if (!sourceCell || !targetCell) continue;

		const fromName = extractStateNameFromCell(sourceCell);
		const toName = extractStateNameFromCell(targetCell);

		if (!fromName || !toName) continue;

		const t = new NTransition(fromName, toName);
		t.label = unescapeXml(cell.value || '') || null;
		diagram.transitions.push(t);
	}

	return diagram;
}

function extractStateNameFromCell(cell) {
	if (!cell || !cell.style) return null;

	// Initial/final pseudostates
	if (cell.style.includes('ellipse') && cell.style.includes('fillColor=#000000')) {
		return '[*]';
	}
	if (cell.style.includes('ellipse') && cell.style.includes('strokeWidth=2')) {
		return '[*]';
	}

	// History
	const name = extractNameFromValue(cell.value);
	if (cell.style.includes('ellipse') && (name === 'H' || name === 'H*')) {
		return name;
	}

	return name;
}

function extractNameFromValue(value) {
	if (!value) return null;
	let name = unescapeXml(value);
	// Remove stereotypes
	name = name.replace(/\u00AB[^\u00BB]*\u00BB(?:\\n|<br\s*\/?>)?/g, '');
	name = name.replace(/<br\s*\/?>/g, ' ');
	name = name.replace(/<[^>]*>/g, '');
	name = name.replace(/\\n/g, ' ');
	return name.trim() || null;
}

function unescapeXml(str) {
	if (!str) return '';
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function parseCells(xmlText) {
	const cells = [];
	const cellRegex = /<mxCell\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g;
	let match;

	while ((match = cellRegex.exec(xmlText)) !== null) {
		const attrs = match[1];
		const cell = {
			id: extractAttr(attrs, 'id'),
			value: extractAttr(attrs, 'value'),
			style: extractAttr(attrs, 'style'),
			vertex: attrs.includes('vertex="1"'),
			edge: attrs.includes('edge="1"'),
			parent: extractAttr(attrs, 'parent'),
			source: extractAttr(attrs, 'source'),
			target: extractAttr(attrs, 'target'),
		};
		cells.push(cell);
	}

	return cells;
}

function extractAttr(attrStr, name) {
	const re = new RegExp(name + '="([^"]*)"');
	const m = attrStr.match(re);
	return m ? m[1] : null;
}
