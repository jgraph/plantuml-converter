/**
 * extract-drawio-xml-usecase.js
 *
 * Extracts a NormalizedUsecaseDiagram from the converter's draw.io XML output.
 * Since we generate this XML, we know the exact style patterns.
 */

import {
	NActor,
	NUsecase,
	NContainer,
	NRelationship,
	NNote,
	NormalizedUsecaseDiagram
} from './normalize-usecase.js';

/**
 * Extract NormalizedUsecaseDiagram from draw.io XML text.
 * @param {string} xmlText - draw.io XML content
 * @returns {NormalizedUsecaseDiagram}
 */
export function extractFromDrawioXml(xmlText) {
	const diagram = new NormalizedUsecaseDiagram();

	// Parse all mxCells
	const cells = parseCells(xmlText);

	// Find actor cells (shape=umlActor)
	const actorCells = cells.filter(c => c.vertex && c.style && c.style.includes('shape=umlActor'));
	for (const cell of actorCells) {
		const name = extractNameFromValue(cell.value);
		if (!name) continue;
		const actor = new NActor(name);
		diagram.actors.push(actor);
	}

	// Find usecase cells (ellipse, but not notes)
	const usecaseCells = cells.filter(c =>
		c.vertex && c.style &&
		(c.style.includes('shape=ellipse') || c.style.includes('ellipse=1')) &&
		!c.style.includes('shape=note')
	);
	for (const cell of usecaseCells) {
		const name = extractNameFromValue(cell.value);
		if (!name) continue;
		const uc = new NUsecase(name);
		diagram.usecases.push(uc);
	}

	// Find container cells (container=1)
	const containerCells = cells.filter(c =>
		c.vertex && c.style &&
		c.style.includes('container=1')
	);
	for (const cell of containerCells) {
		const name = extractNameFromValue(cell.value);
		if (!name) continue;

		let type = 'package';
		if (cell.style.includes('shape=folder')) type = 'package';
		else if (cell.style.includes('shape=cloud')) type = 'cloud';
		else if (cell.style.includes('shape=mxgraph.sysml.package')) type = 'frame';
		else if (cell.style.includes('shape=component')) type = 'component';
		else if (cell.style.includes('rounded=0')) type = 'rectangle';

		const container = new NContainer(name, type);
		diagram.containers.push(container);
	}

	// Find edge cells (relationships)
	const edgeCells = cells.filter(c => c.edge);
	for (const cell of edgeCells) {
		// Skip note connections (dashed with no arrows)
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

	// Find note cells
	const noteCells = cells.filter(c => c.vertex && c.style && c.style.includes('shape=note'));
	for (const cell of noteCells) {
		const note = new NNote(unescapeXml(cell.value || ''));
		diagram.notes.push(note);
	}

	return diagram;
}

function extractRelFromEdge(cell, allCells) {
	const sourceId = cell.source;
	const targetId = cell.target;

	if (!sourceId || !targetId) return null;

	// Find source and target cells
	const sourceCell = allCells.find(c => c.id === sourceId);
	const targetCell = allCells.find(c => c.id === targetId);

	if (!sourceCell || !targetCell) return null;

	const fromName = extractNameFromValue(sourceCell.value);
	const toName = extractNameFromValue(targetCell.value);

	if (!fromName || !toName) return null;

	// Determine relationship type from style
	const relType = inferRelType(cell.style || '');

	const rel = new NRelationship(fromName, toName, relType);
	rel.label = unescapeXml(cell.value || '') || null;

	return rel;
}

function inferRelType(style) {
	const isDashed = style.includes('dashed=1');

	// Check both start and end arrows
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
	// Remove HTML tags
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

/**
 * Parse all mxCell elements from XML text.
 */
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
