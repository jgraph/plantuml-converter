/**
 * ComponentEmitter.js
 *
 * Walks a ComponentDiagram model and emits mxCell XML strings.
 * Uses a simple grid layout — ELK handles real layout on the draw.io side.
 *
 * Supports all element types from PlantUML's DescriptionDiagram including
 * components, nodes, clouds, databases, interfaces, and many more.
 */

import {
	ElementType,
	RelationDecor,
	LineStyle,
	Direction,
	NotePosition,
	DiagramDirection,
} from '../../common/DescriptionModel.js';

import {
	buildCell,
	buildStyle,
	xmlEscape,
	geom,
	createIdGenerator,
	normalizeColor,
} from '../../MxBuilder.js';

// ── Layout constants ───────────────────────────────────────────────────────

const LAYOUT = Object.freeze({
	DEFAULT_WIDTH:        120,
	DEFAULT_HEIGHT:       60,
	COMPONENT_WIDTH:      120,
	COMPONENT_HEIGHT:     60,
	INTERFACE_WIDTH:      20,
	INTERFACE_HEIGHT:     20,
	ACTOR_WIDTH:          40,
	ACTOR_HEIGHT:         80,
	PORT_WIDTH:           8,
	PORT_HEIGHT:          8,
	H_GAP:                80,
	V_GAP:                80,
	MARGIN:               40,
	COLS_PER_ROW:         4,
	NOTE_WIDTH:           140,
	NOTE_MIN_HEIGHT:      40,
	NOTE_LINE_HEIGHT:     16,
	CONTAINER_PADDING:    30,
	CONTAINER_HEADER:     30,
});

// ── Element size lookup ────────────────────────────────────────────────────

function getElementSize(element) {
	switch (element.type) {
		case ElementType.INTERFACE:
			return { width: LAYOUT.INTERFACE_WIDTH, height: LAYOUT.INTERFACE_HEIGHT };
		case ElementType.ACTOR:
		case ElementType.ACTOR_BUSINESS:
			return { width: LAYOUT.ACTOR_WIDTH, height: LAYOUT.ACTOR_HEIGHT };
		case ElementType.PORT:
		case ElementType.PORTIN:
		case ElementType.PORTOUT:
			return { width: LAYOUT.PORT_WIDTH, height: LAYOUT.PORT_HEIGHT };
		case ElementType.LABEL:
			return { width: Math.max(80, element.displayName.length * 8), height: 20 };
		default: {
			const nameLen = element.displayName.length;
			const width = Math.max(LAYOUT.DEFAULT_WIDTH, nameLen * 8 + 40);
			return { width: width, height: LAYOUT.DEFAULT_HEIGHT };
		}
	}
}

// ── Style helpers ──────────────────────────────────────────────────────────

function elementStyle(element) {
	const base = {
		html: 1,
		whiteSpace: 'wrap',
		align: 'center',
		verticalAlign: 'middle',
	};

	switch (element.type) {
		case ElementType.COMPONENT:
			base.shape = 'component';
			base.align = 'left';
			base.spacingLeft = 36;
			break;

		case ElementType.NODE:
			base.shape = 'mxgraph.flowchart.process';
			break;

		case ElementType.CLOUD:
			base.shape = 'cloud';
			break;

		case ElementType.DATABASE:
			base.shape = 'cylinder3';
			base.size = 15;
			break;

		case ElementType.STORAGE:
			base.shape = 'mxgraph.eip.dataStore';
			break;

		case ElementType.ARTIFACT:
			base.shape = 'mxgraph.sysml.package';
			break;

		case ElementType.FOLDER:
			base.shape = 'folder';
			base.tabWidth = 80;
			base.tabHeight = 20;
			base.tabPosition = 'left';
			break;

		case ElementType.FILE:
			base.shape = 'note';
			base.size = 15;
			break;

		case ElementType.FRAME:
			base.shape = 'mxgraph.sysml.package';
			break;

		case ElementType.RECTANGLE:
			base.rounded = 0;
			break;

		case ElementType.INTERFACE:
			base.shape = 'ellipse';
			base.perimeter = 'ellipsePerimeter';
			break;

		case ElementType.ACTOR:
		case ElementType.ACTOR_BUSINESS:
			base.shape = 'umlActor';
			base.verticalLabelPosition = 'bottom';
			base.verticalAlign = 'top';
			base.outlineConnect = 0;
			break;

		case ElementType.AGENT:
			base.rounded = 0;
			break;

		case ElementType.PERSON:
			base.shape = 'mxgraph.basic.person';
			break;

		case ElementType.BOUNDARY:
			base.shape = 'mxgraph.sysml.boundary';
			break;

		case ElementType.CONTROL:
			base.shape = 'mxgraph.sysml.control';
			break;

		case ElementType.ENTITY_DESC:
			base.shape = 'mxgraph.sysml.entity';
			break;

		case ElementType.HEXAGON:
			base.shape = 'hexagon';
			base.perimeter = 'hexagonPerimeter2';
			base.size = 0.25;
			break;

		case ElementType.CARD:
			base.shape = 'card';
			base.size = 18;
			break;

		case ElementType.QUEUE:
			base.shape = 'mxgraph.sysml.queue';
			break;

		case ElementType.STACK:
			base.shape = 'process';
			break;

		case ElementType.LABEL:
			base.strokeColor = 'none';
			base.fillColor = 'none';
			break;

		case ElementType.COLLECTIONS:
			base.rounded = 0;
			base.shadow = 1;
			break;

		case ElementType.PACKAGE:
			base.shape = 'folder';
			base.tabWidth = 80;
			base.tabHeight = 20;
			base.tabPosition = 'left';
			break;

		case ElementType.USECASE:
		case ElementType.USECASE_BUSINESS:
			base.shape = 'ellipse';
			break;

		case ElementType.PORT:
		case ElementType.PORTIN:
		case ElementType.PORTOUT:
			base.shape = 'ellipse';
			base.perimeter = 'ellipsePerimeter';
			base.fillColor = '#000000';
			break;

		default:
			base.rounded = 0;
			break;
	}

	if (element.color) {
		base.fillColor = normalizeColor(element.color);
	}
	if (element.lineColor) {
		base.strokeColor = normalizeColor(element.lineColor);
	}

	return buildStyle(base);
}

function containerStyle(container) {
	const base = {
		html: 1,
		whiteSpace: 'wrap',
		verticalAlign: 'top',
		fontStyle: 1,
		fillColor: 'none',
		strokeColor: '#666666',
		fontSize: 12,
		container: 1,
		collapsible: 0,
	};

	switch (container.type) {
		case ElementType.PACKAGE:
			base.shape = 'folder';
			base.tabWidth = 80;
			base.tabHeight = 20;
			base.tabPosition = 'left';
			break;
		case ElementType.RECTANGLE:
			base.rounded = 0;
			break;
		case ElementType.FRAME:
			base.shape = 'mxgraph.sysml.package';
			break;
		case ElementType.CLOUD:
			base.shape = 'cloud';
			break;
		case ElementType.NODE:
			base.shape = 'mxgraph.flowchart.process';
			break;
		case ElementType.FOLDER:
			base.shape = 'folder';
			base.tabWidth = 80;
			base.tabHeight = 20;
			base.tabPosition = 'left';
			break;
		case ElementType.DATABASE:
			base.shape = 'mxgraph.flowchart.database';
			break;
		case ElementType.COMPONENT:
			base.shape = 'component';
			break;
		case ElementType.CARD:
			base.shape = 'card';
			base.size = 18;
			break;
		case ElementType.FILE:
			base.shape = 'note';
			base.size = 15;
			break;
		case ElementType.HEXAGON:
			base.shape = 'hexagon';
			base.perimeter = 'hexagonPerimeter2';
			base.size = 0.25;
			break;
		case ElementType.STORAGE:
			base.shape = 'mxgraph.eip.dataStore';
			break;
		case ElementType.QUEUE:
			base.shape = 'mxgraph.sysml.queue';
			break;
		case ElementType.STACK:
			base.shape = 'process';
			break;
		case ElementType.AGENT:
			base.rounded = 0;
			break;
		case ElementType.ARTIFACT:
			base.shape = 'mxgraph.sysml.package';
			break;
		default:
			base.rounded = 0;
			break;
	}

	if (container.color) {
		base.fillColor = normalizeColor(container.color);
	}

	return buildStyle(base);
}

function noteStyle(note) {
	const style = {
		shape: 'note',
		whiteSpace: 'wrap',
		html: 1,
		size: 14,
		verticalAlign: 'top',
		align: 'left',
		spacingLeft: 4,
		fillColor: '#FFF2CC',
		strokeColor: '#D6B656',
	};

	if (note.color) {
		style.fillColor = normalizeColor(note.color);
	}

	return buildStyle(style);
}

function edgeStyle(link) {
	const style = {
		html: 1,
		rounded: 0,
		endArrow: 'none',
		endFill: 0,
		startArrow: 'none',
		startFill: 0,
	};

	if (link.lineStyle === LineStyle.DASHED) {
		style.dashed = 1;
	} else if (link.lineStyle === LineStyle.BOLD) {
		style.strokeWidth = 2;
	} else if (link.lineStyle === LineStyle.DOTTED) {
		style.dashed = 1;
		style.dashPattern = '1 2';
	}

	applyDecorToEnd(link.rightDecor, style, 'end');
	applyDecorToEnd(link.leftDecor, style, 'start');

	if (link.color) {
		style.strokeColor = normalizeColor(link.color);
	}

	return buildStyle(style);
}

function applyDecorToEnd(decor, style, prefix) {
	const arrowKey = prefix + 'Arrow';
	const fillKey = prefix + 'Fill';

	switch (decor) {
		case RelationDecor.EXTENDS:
			style[arrowKey] = 'block';
			style[fillKey] = 0;
			break;
		case RelationDecor.COMPOSITION:
			style[arrowKey] = 'diamond';
			style[fillKey] = 1;
			break;
		case RelationDecor.AGGREGATION:
			style[arrowKey] = 'diamond';
			style[fillKey] = 0;
			break;
		case RelationDecor.ARROW:
			style[arrowKey] = 'open';
			style[fillKey] = 1;
			break;
		case RelationDecor.ARROW_TRIANGLE:
			style[arrowKey] = 'block';
			style[fillKey] = 1;
			break;
		case RelationDecor.NOT_NAVIGABLE:
			style[arrowKey] = 'cross';
			style[fillKey] = 1;
			break;
		case RelationDecor.CROWFOOT:
			style[arrowKey] = 'ERmany';
			style[fillKey] = 0;
			break;
		case RelationDecor.CIRCLE_CROWFOOT:
			style[arrowKey] = 'ERmandOne';
			style[fillKey] = 0;
			break;
		case RelationDecor.DOUBLE_LINE:
			style[arrowKey] = 'ERmandOne';
			style[fillKey] = 0;
			break;
		case RelationDecor.CIRCLE_LINE:
			style[arrowKey] = 'ERzeroToOne';
			style[fillKey] = 0;
			break;
		case RelationDecor.LINE_CROWFOOT:
			style[arrowKey] = 'ERoneToMany';
			style[fillKey] = 0;
			break;
		case RelationDecor.CIRCLE:
			style[arrowKey] = 'oval';
			style[fillKey] = 0;
			break;
		case RelationDecor.CIRCLE_FILL:
			style[arrowKey] = 'oval';
			style[fillKey] = 1;
			break;
		case RelationDecor.SQUARE:
			style[arrowKey] = 'box';
			style[fillKey] = 1;
			break;
		case RelationDecor.PLUS:
			style[arrowKey] = 'cross';
			style[fillKey] = 0;
			break;
		case RelationDecor.NONE:
		default:
			break;
	}
}

// ── Emitter class ──────────────────────────────────────────────────────────

class ComponentEmitter {
	constructor(parentId) {
		this.parentId = parentId;
		this.nextId = createIdGenerator('puml');
		this.cells = [];
		this.elementPositions = new Map();  // code → { x, y, width, height }
		this.elementCellIds = new Map();    // code → cell id
		this.containerBounds = new Map();   // container code → { x, y, width, height, id }
	}

	/**
	 * Emit the full diagram.
	 * @param {import('./ComponentModel.js').ComponentDiagram} diagram
	 * @returns {string[]} Array of mxCell XML strings
	 */
	emit(diagram) {
		this.diagram = diagram;

		// 1. Calculate element sizes
		const elementSizes = this._calculateElementSizes(diagram);

		// 2. Grid layout
		this._layoutElements(diagram, elementSizes);

		// 3. Emit containers (background, z-order first)
		this._emitContainers(diagram.containers);

		// 4. Emit elements
		for (const [code, element] of diagram.elements) {
			this._emitElement(element);
		}

		// 5. Emit notes
		this._emitNotes(diagram);

		// 6. Emit relationships (edges on top)
		for (const link of diagram.links) {
			this._emitLink(link);
		}

		return this.cells;
	}

	// ── Size calculation ─────────────────────────────────────────────────

	_calculateElementSizes(diagram) {
		const sizes = new Map();

		for (const [code, element] of diagram.elements) {
			sizes.set(code, getElementSize(element));
		}

		return sizes;
	}

	// ── Grid layout ──────────────────────────────────────────────────────

	_layoutElements(diagram, elementSizes) {
		const containeredElements = new Set();
		for (const container of diagram.containers) {
			this._collectContainerElements(container, containeredElements);
		}

		const rootElements = [];
		for (const [code] of diagram.elements) {
			if (!containeredElements.has(code)) {
				rootElements.push(code);
			}
		}

		let currentY = LAYOUT.MARGIN;

		if (rootElements.length > 0) {
			currentY = this._layoutGrid(rootElements, elementSizes, LAYOUT.MARGIN, currentY);
			currentY += LAYOUT.V_GAP;
		}

		for (const container of diagram.containers) {
			currentY = this._layoutContainer(container, elementSizes, LAYOUT.MARGIN, currentY);
			currentY += LAYOUT.V_GAP;
		}
	}

	_collectContainerElements(container, set) {
		for (const code of container.elements) {
			set.add(code);
		}
		for (const sub of container.subContainers) {
			this._collectContainerElements(sub, set);
		}
	}

	_layoutGrid(elementCodes, elementSizes, startX, startY) {
		let col = 0;
		let x = startX;
		let y = startY;
		let rowMaxHeight = 0;

		for (const code of elementCodes) {
			const size = elementSizes.get(code);
			if (!size) continue;

			this.elementPositions.set(code, {
				x, y,
				width: size.width,
				height: size.height,
			});

			rowMaxHeight = Math.max(rowMaxHeight, size.height);
			col++;

			if (col >= LAYOUT.COLS_PER_ROW) {
				col = 0;
				x = startX;
				y += rowMaxHeight + LAYOUT.V_GAP;
				rowMaxHeight = 0;
			} else {
				x += size.width + LAYOUT.H_GAP;
			}
		}

		return y + rowMaxHeight;
	}

	_layoutContainer(container, elementSizes, startX, startY) {
		const innerX = startX + LAYOUT.CONTAINER_PADDING;
		let innerY = startY + LAYOUT.CONTAINER_HEADER + LAYOUT.CONTAINER_PADDING;

		if (container.elements.length > 0) {
			innerY = this._layoutGrid(container.elements, elementSizes, innerX, innerY);
			innerY += LAYOUT.CONTAINER_PADDING;
		}

		for (const sub of container.subContainers) {
			innerY = this._layoutContainer(sub, elementSizes, innerX, innerY);
			innerY += LAYOUT.V_GAP;
		}

		let maxX = startX + LAYOUT.DEFAULT_WIDTH + 2 * LAYOUT.CONTAINER_PADDING;
		for (const code of container.elements) {
			const pos = this.elementPositions.get(code);
			if (pos) {
				maxX = Math.max(maxX, pos.x + pos.width + LAYOUT.CONTAINER_PADDING);
			}
		}
		for (const sub of container.subContainers) {
			const subBounds = this.containerBounds.get(sub.code);
			if (subBounds) {
				maxX = Math.max(maxX, subBounds.x + subBounds.width + LAYOUT.CONTAINER_PADDING);
			}
		}

		const containerWidth = maxX - startX;
		const containerHeight = innerY - startY;

		this.containerBounds.set(container.code, {
			x: startX,
			y: startY,
			width: containerWidth,
			height: containerHeight,
		});

		return innerY;
	}

	// ── Container emission ───────────────────────────────────────────────

	_emitContainers(containers) {
		for (const container of containers) {
			this._emitContainer(container);
		}
	}

	_emitContainer(container) {
		const bounds = this.containerBounds.get(container.code);
		if (!bounds) return;

		const id = this.nextId();

		let label = xmlEscape(container.name);
		for (const stereo of container.stereotypes) {
			label = '&lt;&lt;' + xmlEscape(stereo) + '&gt;&gt;<br>' + label;
		}

		this.cells.push(buildCell({
			id: id,
			value: label,
			style: containerStyle(container),
			vertex: true,
			parent: this.parentId,
			geometry: geom(bounds.x, bounds.y, bounds.width, bounds.height),
		}));

		for (const sub of container.subContainers) {
			this._emitContainer(sub);
		}
	}

	// ── Element emission ─────────────────────────────────────────────────

	_emitElement(element) {
		const pos = this.elementPositions.get(element.code);
		if (!pos) return;

		const id = this.nextId();
		this.elementCellIds.set(element.code, id);

		let label = '';
		for (const stereo of element.stereotypes) {
			label += '&lt;&lt;' + xmlEscape(stereo) + '&gt;&gt;<br>';
		}
		label += xmlEscape(element.displayName);

		this.cells.push(buildCell({
			id: id,
			value: label,
			style: elementStyle(element),
			vertex: true,
			parent: this.parentId,
			geometry: geom(pos.x, pos.y, pos.width, pos.height),
		}));
	}

	// ── Note emission ────────────────────────────────────────────────────

	_emitNotes(diagram) {
		for (const note of diagram.notes) {
			if (note.isOnLink) {
				this._emitNoteOnLink(note);
			} else {
				this._emitNote(note);
			}
		}
	}

	_emitNote(note) {
		const id = this.nextId();

		let x = LAYOUT.MARGIN;
		let y = LAYOUT.MARGIN;

		if (note.entityCode) {
			const pos = this.elementPositions.get(note.entityCode);
			if (pos) {
				const offset = 20;
				switch (note.position) {
					case NotePosition.LEFT:
						x = pos.x - LAYOUT.NOTE_WIDTH - offset;
						y = pos.y;
						break;
					case NotePosition.RIGHT:
						x = pos.x + pos.width + offset;
						y = pos.y;
						break;
					case NotePosition.TOP:
						x = pos.x;
						y = pos.y - LAYOUT.NOTE_MIN_HEIGHT - offset;
						break;
					case NotePosition.BOTTOM:
						x = pos.x;
						y = pos.y + pos.height + offset;
						break;
				}
			}
		} else {
			let maxY = 0;
			for (const [, pos] of this.elementPositions) {
				maxY = Math.max(maxY, pos.y + pos.height);
			}
			y = maxY + LAYOUT.V_GAP;
		}

		const textLines = note.text.split('\n').length;
		const noteHeight = Math.max(LAYOUT.NOTE_MIN_HEIGHT, textLines * LAYOUT.NOTE_LINE_HEIGHT + 16);

		const noteText = xmlEscape(note.text).replace(/\n/g, '<br>');

		this.cells.push(buildCell({
			id: id,
			value: noteText,
			style: noteStyle(note),
			vertex: true,
			parent: this.parentId,
			geometry: geom(x, y, LAYOUT.NOTE_WIDTH, noteHeight),
		}));

		if (note.entityCode) {
			const targetId = this.elementCellIds.get(note.entityCode);
			if (targetId) {
				this.cells.push(buildCell({
					id: this.nextId(),
					style: buildStyle({ html: 1, dashed: 1, endArrow: 'none', endFill: 0, startArrow: 'none', startFill: 0 }),
					edge: true,
					parent: this.parentId,
					source: id,
					target: targetId,
				}));
			}
		}
	}

	_emitNoteOnLink(note) {
		const linkIndex = note.linkIndex;
		if (linkIndex === null || linkIndex === undefined) return;

		const link = this.diagram.links[linkIndex];
		if (!link) return;

		const fromPos = this.elementPositions.get(link.from);
		const toPos = this.elementPositions.get(link.to);
		if (!fromPos || !toPos) return;

		const midX = (fromPos.x + fromPos.width / 2 + toPos.x + toPos.width / 2) / 2;
		const midY = (fromPos.y + fromPos.height / 2 + toPos.y + toPos.height / 2) / 2;

		const noteText = xmlEscape(note.text).replace(/\n/g, '<br>');
		const textLines = note.text.split('\n').length;
		const noteHeight = Math.max(LAYOUT.NOTE_MIN_HEIGHT, textLines * LAYOUT.NOTE_LINE_HEIGHT + 16);

		this.cells.push(buildCell({
			id: this.nextId(),
			value: noteText,
			style: noteStyle(note),
			vertex: true,
			parent: this.parentId,
			geometry: geom(midX + 20, midY - noteHeight / 2, LAYOUT.NOTE_WIDTH, noteHeight),
		}));
	}

	// ── Link emission ────────────────────────────────────────────────────

	_emitLink(link) {
		const fromId = this.elementCellIds.get(link.from);
		const toId = this.elementCellIds.get(link.to);

		let label = '';
		if (link.label) {
			label = xmlEscape(link.label);
		}

		if (fromId && toId) {
			this.cells.push(buildCell({
				id: this.nextId(),
				value: label,
				style: edgeStyle(link),
				edge: true,
				parent: this.parentId,
				source: fromId,
				target: toId,
			}));
		} else {
			const fromPos = this.elementPositions.get(link.from);
			const toPos = this.elementPositions.get(link.to);

			const sx = fromPos ? fromPos.x + fromPos.width / 2 : 0;
			const sy = fromPos ? fromPos.y + fromPos.height / 2 : 0;
			const tx = toPos ? toPos.x + toPos.width / 2 : 100;
			const ty = toPos ? toPos.y + toPos.height / 2 : 100;

			this.cells.push(buildCell({
				id: this.nextId(),
				value: label,
				style: edgeStyle(link),
				edge: true,
				parent: this.parentId,
				sourcePoint: { x: sx, y: sy },
				targetPoint: { x: tx, y: ty },
			}));
		}

		if (link.leftLabel || link.rightLabel) {
			this._emitLinkLabels(link);
		}
	}

	_emitLinkLabels(link) {
		if (link.leftLabel) {
			const fromPos = this.elementPositions.get(link.from);
			if (fromPos) {
				this.cells.push(buildCell({
					id: this.nextId(),
					value: xmlEscape(link.leftLabel),
					style: buildStyle({
						edgeLabel: 1,
						html: 1,
						align: 'left',
						verticalAlign: 'bottom',
						resizable: 0,
						points: '[]',
					}),
					vertex: true,
					connectable: false,
					parent: this.parentId,
					geometry: geom(fromPos.x + fromPos.width + 5, fromPos.y - 15, 30, 15),
				}));
			}
		}

		if (link.rightLabel) {
			const toPos = this.elementPositions.get(link.to);
			if (toPos) {
				this.cells.push(buildCell({
					id: this.nextId(),
					value: xmlEscape(link.rightLabel),
					style: buildStyle({
						edgeLabel: 1,
						html: 1,
						align: 'left',
						verticalAlign: 'bottom',
						resizable: 0,
						points: '[]',
					}),
					vertex: true,
					connectable: false,
					parent: this.parentId,
					geometry: geom(toPos.x - 35, toPos.y - 15, 30, 15),
				}));
			}
		}
	}
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Emit a ComponentDiagram model as mxCell XML strings.
 * @param {import('./ComponentModel.js').ComponentDiagram} diagram
 * @param {string} parentId - Parent cell ID for all emitted cells
 * @returns {string[]} Array of mxCell XML strings
 */
export function emitComponentDiagram(diagram, parentId) {
	const emitter = new ComponentEmitter(parentId);
	return emitter.emit(diagram);
}

export { ComponentEmitter };
