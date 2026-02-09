/**
 * extract-drawio-xml-component.js
 *
 * Extracts a NormalizedComponentDiagram from the converter's draw.io XML output.
 * Since we generate this XML, we know the exact style patterns.
 */

import {
	NComponent,
	NContainer,
	NRelationship,
	NNote,
	NormalizedComponentDiagram,
} from './normalize-component.js';

// ── Shape → type mapping ───────────────────────────────────────────────────

const SHAPE_TYPE_MAP = {
	'shape=component':                'component',
	'shape=mxgraph.flowchart.process':'node',
	'shape=cloud':                    'cloud',
	'shape=cylinder3':                'database',
	'shape=mxgraph.eip.dataStore':    'storage',
	'shape=mxgraph.sysml.package':    'artifact', // or frame
	'shape=folder':                   'folder',
	'shape=note':                     'file',      // also used for notes
	'shape=umlActor':                 'actor',
	'shape=mxgraph.basic.person':     'person',
	'shape=hexagon':                  'hexagon',
	'shape=card':                     'card',
	'shape=mxgraph.sysml.queue':      'queue',
	'shape=process':                  'stack',
	'shape=mxgraph.sysml.boundary':   'boundary',
	'shape=mxgraph.sysml.control':    'control',
	'shape=mxgraph.sysml.entity':     'entity',
	'shape=ellipse':                  'interface', // default for ellipse
};

/**
 * Extract NormalizedComponentDiagram from draw.io XML text.
 * @param {string} xmlText - draw.io XML content
 * @returns {NormalizedComponentDiagram}
 */
export function extractFromDrawioXml(xmlText) {
	const diagram = new NormalizedComponentDiagram();
	const cells = parseCells(xmlText);

	// Separate containers, elements, notes, and edges
	const containerCells = cells.filter(c =>
		c.vertex && c.style && c.style.includes('container=1')
	);

	const noteCells = cells.filter(c =>
		c.vertex && c.style &&
		c.style.includes('shape=note') &&
		!c.style.includes('container=1') &&
		c.style.includes('fillColor=#FFF2CC')
	);

	const noteCellIds = new Set(noteCells.map(c => c.id));
	const containerCellIds = new Set(containerCells.map(c => c.id));

	// Edge label cells (edgeLabel=1) — skip these as elements
	const edgeLabelCellIds = new Set(
		cells.filter(c => c.vertex && c.style && c.style.includes('edgeLabel=1')).map(c => c.id)
	);

	const elementCells = cells.filter(c =>
		c.vertex && c.style &&
		!containerCellIds.has(c.id) &&
		!noteCellIds.has(c.id) &&
		!edgeLabelCellIds.has(c.id) &&
		c.id !== '0' && c.id !== '1' &&
		!c.style.includes('group;')
	);

	const edgeCells = cells.filter(c => c.edge);

	// Extract containers
	for (const cell of containerCells) {
		const name = extractNameFromValue(cell.value);
		if (!name) continue;

		let type = 'package';
		if (cell.style.includes('shape=cloud')) type = 'cloud';
		else if (cell.style.includes('shape=mxgraph.flowchart.process')) type = 'node';
		else if (cell.style.includes('shape=mxgraph.flowchart.database')) type = 'database';
		else if (cell.style.includes('shape=component')) type = 'component';
		else if (cell.style.includes('shape=mxgraph.sysml.package')) type = 'frame';
		else if (cell.style.includes('shape=folder')) type = 'folder';
		else if (cell.style.includes('shape=card')) type = 'card';
		else if (cell.style.includes('shape=note')) type = 'file';
		else if (cell.style.includes('shape=hexagon')) type = 'hexagon';
		else if (cell.style.includes('shape=mxgraph.eip.dataStore')) type = 'storage';
		else if (cell.style.includes('shape=mxgraph.sysml.queue')) type = 'queue';
		else if (cell.style.includes('shape=process')) type = 'stack';
		else if (cell.style.includes('rounded=0')) type = 'rectangle';

		const container = new NContainer(name, type);
		diagram.containers.push(container);
	}

	// Extract elements
	for (const cell of elementCells) {
		const name = extractNameFromValue(cell.value);
		if (!name) continue;

		let type = 'component'; // default
		for (const [pattern, mappedType] of Object.entries(SHAPE_TYPE_MAP)) {
			if (cell.style.includes(pattern)) {
				type = mappedType;
				break;
			}
		}

		// Distinguish interface (small ellipse) from usecase (large ellipse)
		if (type === 'interface' && cell.style.includes('shape=ellipse')) {
			// Check geometry width — interfaces are 20px, usecases are larger
			const widthMatch = xmlText.match(new RegExp(
				'id="' + escapeRegex(cell.id) + '"[^>]*>[\\s\\S]*?width="(\\d+)"'
			));
			if (widthMatch && parseInt(widthMatch[1]) > 40) {
				type = 'usecase';
			}
		}

		// Notes with note shape but different fill are files
		if (type === 'file' && cell.style.includes('fillColor=#FFF2CC')) {
			continue; // Skip — this is a note, already handled
		}

		const el = new NComponent(name, type);
		diagram.elements.push(el);
	}

	// Extract notes
	for (const cell of noteCells) {
		const note = new NNote(unescapeXml(cell.value || ''));
		diagram.notes.push(note);
	}

	// Extract relationships
	for (const cell of edgeCells) {
		// Skip note connections
		if (cell.style &&
			cell.style.includes('endArrow=none') &&
			cell.style.includes('startArrow=none') &&
			cell.style.includes('dashed=1')) {
			continue;
		}

		const rel = extractRelFromEdge(cell, cells);
		if (rel) {
			diagram.relationships.push(rel);
		}
	}

	return diagram;
}

function extractRelFromEdge(cell, allCells) {
	const sourceId = cell.source;
	const targetId = cell.target;

	if (!sourceId || !targetId) return null;

	const sourceCell = allCells.find(c => c.id === sourceId);
	const targetCell = allCells.find(c => c.id === targetId);

	if (!sourceCell || !targetCell) return null;

	const fromName = extractNameFromValue(sourceCell.value);
	const toName = extractNameFromValue(targetCell.value);

	if (!fromName || !toName) return null;

	const relType = inferRelType(cell.style || '');

	const rel = new NRelationship(fromName, toName, relType);
	rel.label = unescapeXml(cell.value || '') || null;

	return rel;
}

function inferRelType(style) {
	const isDashed = style.includes('dashed=1');

	if (style.includes('Arrow=block') && style.includes('Fill=0')) {
		return isDashed ? 'implementation' : 'extension';
	}
	if (style.includes('Arrow=diamond') && style.includes('Fill=1')) {
		return 'composition';
	}
	if (style.includes('Arrow=diamond') && style.includes('Fill=0')) {
		return 'aggregation';
	}
	if (style.includes('Arrow=open')) {
		return isDashed ? 'dependency' : 'association';
	}

	return 'association';
}

function extractNameFromValue(value) {
	if (!value) return null;
	let name = unescapeXml(value);
	// Remove stereotypes
	name = name.replace(/&lt;&lt;[^&]*&gt;&gt;(?:\\n|<br\s*\/?>)/g, '');
	name = name.replace(/<<[^>]*>>(?:\\n|<br\s*\/?>)/g, '');
	name = name.replace(/\\n/g, '');
	name = name.replace(/<[^>]*>/g, '');
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

function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
