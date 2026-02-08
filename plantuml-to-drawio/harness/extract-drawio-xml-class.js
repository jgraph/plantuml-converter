/**
 * extract-drawio-xml-class.js
 *
 * Extracts a NormalizedClassDiagram from the converter's draw.io XML output.
 * Since we generate this XML, we know the exact style patterns.
 */

import {
	NClass,
	NMember,
	NRelationship,
	NNote,
	NormalizedClassDiagram
} from './normalize-class.js';

/**
 * Extract NormalizedClassDiagram from draw.io XML text.
 * @param {string} xmlText - draw.io XML content
 * @returns {NormalizedClassDiagram}
 */
export function extractFromDrawioXml(xmlText) {
	const diagram = new NormalizedClassDiagram();

	// Parse all mxCells
	const cells = parseCells(xmlText);

	// Build parent → children map
	const childrenMap = new Map();
	for (const cell of cells) {
		if (cell.parent) {
			if (!childrenMap.has(cell.parent)) {
				childrenMap.set(cell.parent, []);
			}
			childrenMap.get(cell.parent).push(cell);
		}
	}

	// Find swimlane cells (class boxes)
	const classCells = cells.filter(c => c.vertex && c.style && c.style.includes('swimlane'));
	const classCellIds = new Set(classCells.map(c => c.id));

	for (const cell of classCells) {
		// Skip package folders
		if (cell.style.includes('shape=folder')) continue;

		const cls = extractClassFromCell(cell, childrenMap);
		diagram.classes.push(cls);
	}

	// Find ellipse cells (lollipop/circle entities)
	const ellipseCells = cells.filter(c => c.vertex && c.style && c.style.includes('ellipse') && !c.style.includes('shape=note'));
	for (const cell of ellipseCells) {
		const name = unescapeXml(cell.value || '').trim();
		if (!name) continue;
		const cls = new NClass(name);
		cls.type = 'interface'; // Lollipops represent interfaces
		classCellIds.add(cell.id);
		diagram.classes.push(cls);
	}

	// Find rhombus cells (diamond entities)
	const rhombusCells = cells.filter(c => c.vertex && c.style && c.style.includes('rhombus'));
	for (const cell of rhombusCells) {
		const name = unescapeXml(cell.value || '').trim() || 'diamond';
		const cls = new NClass(name);
		classCellIds.add(cell.id);
		diagram.classes.push(cls);
	}

	// Find edge cells (relationships)
	const edgeCells = cells.filter(c => c.edge);

	for (const cell of edgeCells) {
		// Skip note connections (dashed with no arrows)
		if (cell.style && cell.style.includes('dashPattern=1 1') &&
			cell.style.includes('endArrow=none') && cell.style.includes('startArrow=none')) {
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

function extractClassFromCell(cell, childrenMap) {
	// Parse class name from value (strip stereotypes and HTML)
	let name = unescapeXml(cell.value || '');

	// Remove stereotype prefixes like <<interface>>\n or <<interface>><br>
	name = name.replace(/&lt;&lt;[^&]*&gt;&gt;(?:\\n|<br>)/g, '');
	name = name.replace(/<<[^>]*>>(?:\\n|<br>)/g, '');
	name = name.replace(/\\n/g, '');

	// Remove HTML tags (like <br>) and generic params
	name = name.replace(/&lt;[^&]*&gt;/g, '');
	name = name.replace(/<[^>]*>/g, '');
	name = name.trim();

	const cls = new NClass(name);

	// Determine type from style and value
	const value = cell.value || '';
	if (value.includes('interface') || value.includes('&lt;&lt;interface&gt;&gt;')) {
		cls.type = 'interface';
	} else if (value.includes('enumeration') || value.includes('&lt;&lt;enumeration&gt;&gt;')) {
		cls.type = 'enum';
	} else if (value.includes('annotation') || value.includes('&lt;&lt;annotation&gt;&gt;')) {
		cls.type = 'annotation';
	}

	// Check fontStyle for abstract/object
	if (cell.style) {
		const fontStyleMatch = cell.style.match(/fontStyle=(\d+)/);
		if (fontStyleMatch) {
			const fontStyle = parseInt(fontStyleMatch[1], 10);
			if (fontStyle === 3) {
				// 3 = bold+italic (abstract class)
				if (cls.type === 'class') {
					cls.type = 'abstract_class';
					cls.isAbstract = true;
				}
			} else if (fontStyle === 4) {
				// 4 = underline (object instance)
				cls.type = 'object';
			}
		}
	}

	// Extract members from child cells
	const children = childrenMap.get(cell.id) || [];
	for (const child of children) {
		if (!child.style) continue;

		if (child.style.includes('line=1')) {
			// Separator — skip
			continue;
		}

		if (child.style.includes('text=1') || child.style.includes('align=left')) {
			const memberText = unescapeXml(child.value || '').trim();
			if (memberText === '') continue;

			const member = new NMember(memberText);

			// Parse visibility from text
			if (memberText.startsWith('+ ')) member.visibility = '+';
			else if (memberText.startsWith('- ')) member.visibility = '-';
			else if (memberText.startsWith('# ')) member.visibility = '#';
			else if (memberText.startsWith('~ ')) member.visibility = '~';

			member.isMethod = memberText.includes('(');

			// Check fontStyle
			if (child.style) {
				const fs = child.style.match(/fontStyle=(\d+)/);
				if (fs) {
					const v = parseInt(fs[1], 10);
					if (v === 4) member.isStatic = true;
					if (v === 2) member.isAbstract = true;
				}
			}

			cls.members.push(member);
		}
	}

	return cls;
}

function extractRelFromEdge(cell, allCells) {
	const sourceId = cell.source;
	const targetId = cell.target;

	if (!sourceId || !targetId) return null;

	// Find source and target class names
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
	name = name.replace(/&lt;&lt;[^&]*&gt;&gt;(?:\\n|<br>)/g, '');
	name = name.replace(/<<[^>]*>>(?:\\n|<br>)/g, '');
	name = name.replace(/\\n/g, '');
	name = name.replace(/&lt;[^&]*&gt;/g, '');
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
