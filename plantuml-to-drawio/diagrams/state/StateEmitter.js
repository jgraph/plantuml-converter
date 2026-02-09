/**
 * StateEmitter.js
 *
 * Emits mxCell XML strings from a StateDiagram model.
 *
 * Three-pass recursive emitter:
 *   1. Measure (bottom-up): compute bounding-box sizes for all states
 *   2. Place (top-down): assign absolute x,y positions
 *   3. Emit: generate mxCell XML in z-order (composites → leaves → notes → edges)
 *
 * Uses MxBuilder utilities for XML generation.
 *
 * Exports emitStateDiagram(model, parentId) → string[]
 */

import {
	StateType,
	TransitionStyle,
	TransitionDirection,
	NotePosition,
	DiagramDirection,
} from './StateModel.js';

import {
	buildCell,
	buildStyle,
	createIdGenerator,
	geom,
	normalizeColor,
	xmlEscape,
} from '../../MxBuilder.js';

// ── Layout constants ─────────────────────────────────────────────────────────

const L = Object.freeze({
	STATE_MIN_WIDTH:    120,
	STATE_MIN_HEIGHT:    40,
	STATE_CHAR_WIDTH:     7,
	STATE_PADDING:       30,
	STATE_DESC_HEIGHT:   18,
	CIRCLE_SIZE:         24,
	FINAL_OUTER_SIZE:    28,
	FINAL_INNER_SIZE:    16,
	DIAMOND_SIZE:        30,
	BAR_WIDTH:           60,
	BAR_HEIGHT:           5,
	HISTORY_SIZE:        28,
	NOTE_WIDTH:         140,
	NOTE_MIN_HEIGHT:     40,
	NOTE_LINE_HEIGHT:    16,
	NOTE_OFFSET:        160,
	H_GAP:               60,
	V_GAP:               40,
	COMPOSITE_PAD:       20,
	COMPOSITE_HEADER:    30,
	MARGIN:              40,
	CONCURRENT_SEP:      10,
});

// ── Style helpers ────────────────────────────────────────────────────────────

function stateStyle(el) {
	const base = {
		rounded: 1,
		whiteSpace: 'wrap',
		html: 1,
		arcSize: 20,
	};
	if (el.color) base.fillColor = normalizeColor(el.color);
	if (el.lineColor) base.strokeColor = normalizeColor(el.lineColor);
	if (el.lineStyle === 'dashed') base.dashed = 1;
	if (el.lineStyle === 'bold') base.strokeWidth = 2;
	if (el.lineStyle === 'dotted') { base.dashed = 1; base.dashPattern = '1 4'; }
	return base;
}

function stateWithDescStyle(el) {
	const base = {
		shape: 'swimlane',
		rounded: 1,
		html: 1,
		fontStyle: 1,
		align: 'center',
		startSize: 26,
		arcSize: 10,
		swimlaneLine: 1,
	};
	if (el.color) base.fillColor = normalizeColor(el.color);
	if (el.lineColor) base.strokeColor = normalizeColor(el.lineColor);
	if (el.lineStyle === 'dashed') base.dashed = 1;
	if (el.lineStyle === 'bold') base.strokeWidth = 2;
	if (el.lineStyle === 'dotted') { base.dashed = 1; base.dashPattern = '1 4'; }
	return base;
}

function compositeStyle(el) {
	return {
		rounded: 1,
		whiteSpace: 'wrap',
		html: 1,
		container: 1,
		collapsible: 0,
		verticalAlign: 'top',
		fontStyle: 1,
		arcSize: 10,
		swimlaneLine: 0,
		fillColor: el.color ? normalizeColor(el.color) : 'none',
		strokeColor: el.lineColor ? normalizeColor(el.lineColor) : undefined,
	};
}

function initialStyle() {
	return {
		ellipse: null,
		fillColor: '#000000',
		strokeColor: '#000000',
		html: 1,
	};
}

function finalOuterStyle() {
	return {
		ellipse: null,
		fillColor: 'none',
		strokeColor: '#000000',
		strokeWidth: 2,
		html: 1,
	};
}

function finalInnerStyle() {
	return {
		ellipse: null,
		fillColor: '#000000',
		strokeColor: '#000000',
		html: 1,
	};
}

function choiceStyle() {
	return {
		rhombus: null,
		fillColor: '#FFFDE7',
		strokeColor: '#000000',
		html: 1,
	};
}

function forkJoinStyle() {
	return {
		fillColor: '#000000',
		strokeColor: '#000000',
		rounded: 1,
		arcSize: 50,
		html: 1,
	};
}

function historyStyle() {
	return {
		ellipse: null,
		fillColor: 'none',
		strokeColor: '#000000',
		html: 1,
		fontStyle: 1,
		fontSize: 14,
	};
}

function noteStyle(color) {
	return {
		shape: 'note',
		fillColor: color ? normalizeColor(color) : '#FFF2CC',
		strokeColor: color ? normalizeColor(color) : '#D6B656',
		whiteSpace: 'wrap',
		html: 1,
		size: 14,
	};
}

function edgeStyle(transition) {
	const s = {
		html: 1,
		endArrow: 'block',
		endFill: 1,
	};
	if (transition.lineStyle === TransitionStyle.DASHED) {
		s.dashed = 1;
	} else if (transition.lineStyle === TransitionStyle.DOTTED) {
		s.dashed = 1;
		s.dashPattern = '1 4';
	} else if (transition.lineStyle === TransitionStyle.BOLD) {
		s.strokeWidth = 2;
	} else if (transition.lineStyle === TransitionStyle.HIDDEN) {
		s.opacity = 0;
	}
	if (transition.color) {
		s.strokeColor = normalizeColor(transition.color);
	}
	if (transition.crossStart) {
		s.startArrow = 'cross';
		s.startFill = 0;
		s.startSize = 10;
	}
	if (transition.circleEnd) {
		s.endArrow = 'oval';
		s.endFill = 0;
		s.endSize = 8;
	}
	return s;
}

function noteDashedEdgeStyle() {
	return {
		html: 1,
		dashed: 1,
		endArrow: 'none',
		endFill: 0,
		strokeColor: '#D6B656',
	};
}

// ── Emitter class ────────────────────────────────────────────────────────────

class StateEmitter {
	constructor(parentId) {
		this.parentId = parentId;
		this.nextId = createIdGenerator('puml');
		this.cells = [];
		this.idMap = new Map();     // stateCode → cellId
		this.posMap = new Map();    // stateCode → {x, y, w, h}
		this.sizeMap = new Map();   // stateCode → {width, height}
		this.diagram = null;
	}

	emit(diagram) {
		this.diagram = diagram;

		// Collect top-level states (those with no parent)
		const topLevel = [];
		for (const [code, el] of diagram.elements) {
			if (el.parentCode == null) {
				topLevel.push(code);
			}
		}

		// 0. Emit title if present
		if (diagram.title) {
			this._emitTitle(diagram.title);
		}

		// 1. Measure all states bottom-up
		for (const code of topLevel) {
			this._measureState(code);
		}

		// 2. Place top-level states
		this._placeTopLevel(topLevel);

		// 3. Emit in z-order
		// Pass 1: composite containers (background)
		for (const code of topLevel) {
			this._emitComposites(code);
		}

		// Pass 2: leaf states
		for (const code of topLevel) {
			this._emitLeaves(code);
		}

		// Pass 3: notes
		this._emitNotes();

		// Pass 4: edges (transitions) — on top
		// diagram.transitions contains ALL transitions (top-level + inside composites)
		this._emitTransitions(diagram.transitions);

		return this.cells;
	}

	// ── Measure pass ─────────────────────────────────────────────────────────

	_measureState(code) {
		const el = this.diagram.elements.get(code);
		let size;

		const isComposite = el.children.length > 0 || el.concurrentRegions.length > 0;

		if (isComposite) {
			size = this._measureComposite(code);
		} else {
			size = this._measureLeaf(el);
		}

		this.sizeMap.set(code, size);
		return size;
	}

	_measureLeaf(el) {
		switch (el.type) {
			case StateType.INITIAL:
				return { width: L.CIRCLE_SIZE, height: L.CIRCLE_SIZE };
			case StateType.FINAL:
				return { width: L.FINAL_OUTER_SIZE, height: L.FINAL_OUTER_SIZE };
			case StateType.CHOICE:
				return { width: L.DIAMOND_SIZE, height: L.DIAMOND_SIZE };
			case StateType.FORK_JOIN:
			case StateType.SYNCHRO_BAR:
				return { width: L.BAR_WIDTH, height: L.BAR_HEIGHT };
			case StateType.HISTORY:
			case StateType.DEEP_HISTORY:
				return { width: L.HISTORY_SIZE, height: L.HISTORY_SIZE };
			case StateType.STATE:
			default: {
				const nameLen = el.displayName.length;
				let w = Math.max(L.STATE_MIN_WIDTH, nameLen * L.STATE_CHAR_WIDTH + L.STATE_PADDING);
				let h = L.STATE_MIN_HEIGHT;

				// Stereotypes add width
				if (el.stereotypes.length > 0) {
					const stereoLen = el.stereotypes.map(s => s.length + 4).reduce((a, b) => Math.max(a, b), 0);
					w = Math.max(w, stereoLen * L.STATE_CHAR_WIDTH + L.STATE_PADDING);
				}

				// Descriptions add height
				if (el.descriptions.length > 0) {
					h = 26; // startSize header
					h += el.descriptions.length * L.STATE_DESC_HEIGHT + 8;
					// Descriptions might need wider box
					for (const desc of el.descriptions) {
						w = Math.max(w, desc.length * L.STATE_CHAR_WIDTH + L.STATE_PADDING);
					}
				}

				return { width: w, height: h };
			}
		}
	}

	_measureComposite(code) {
		const el = this.diagram.elements.get(code);

		if (el.concurrentRegions.length > 0) {
			return this._measureConcurrentComposite(code);
		}

		// Measure children
		let innerW = 0;
		let innerH = 0;

		for (const childCode of el.children) {
			const childSize = this._measureState(childCode);
			innerW = Math.max(innerW, childSize.width);
			innerH += childSize.height + L.V_GAP;
		}

		if (el.children.length > 0) {
			innerH -= L.V_GAP; // Remove trailing gap
		}

		// Account for title length
		const titleLen = el.displayName.length;
		const titleW = titleLen * L.STATE_CHAR_WIDTH + L.STATE_PADDING;

		const width = Math.max(titleW, innerW + L.COMPOSITE_PAD * 2);
		const height = L.COMPOSITE_HEADER + innerH + L.COMPOSITE_PAD * 2;

		return { width, height };
	}

	_measureConcurrentComposite(code) {
		const el = this.diagram.elements.get(code);
		let totalW = 0;
		let totalH = 0;

		for (const region of el.concurrentRegions) {
			let regionW = 0;
			let regionH = 0;

			for (const childCode of region.elements) {
				const childSize = this._measureState(childCode);
				regionW = Math.max(regionW, childSize.width);
				regionH += childSize.height + L.V_GAP;
			}

			if (region.elements.length > 0) {
				regionH -= L.V_GAP;
			}

			totalW = Math.max(totalW, regionW);
			totalH += regionH + L.CONCURRENT_SEP;
		}

		const titleLen = el.displayName.length;
		const titleW = titleLen * L.STATE_CHAR_WIDTH + L.STATE_PADDING;

		const width = Math.max(titleW, totalW + L.COMPOSITE_PAD * 2);
		const height = L.COMPOSITE_HEADER + totalH + L.COMPOSITE_PAD;

		return { width, height };
	}

	// ── Place pass ───────────────────────────────────────────────────────────

	_placeTopLevel(topLevel) {
		const isLTR = this.diagram.direction === DiagramDirection.LEFT_TO_RIGHT;

		// Build adjacency from top-level transitions
		const topLevelSet = new Set(topLevel);
		const adj = new Map();       // code → [successors]
		const inDegree = new Map();

		for (const code of topLevel) {
			adj.set(code, []);
			inDegree.set(code, 0);
		}

		// Build forward edges for layout (deduplicated, skip reverse edges that create cycles)
		const edgeSet = new Set();
		const pairSeen = new Set();  // track A-B pair regardless of direction
		for (const t of this.diagram.transitions) {
			if (topLevelSet.has(t.from) && topLevelSet.has(t.to) && t.from !== t.to) {
				const key = t.from + '->' + t.to;
				const pair = [t.from, t.to].sort().join('~');
				if (edgeSet.has(key) === false) {
					// Skip if the reverse edge was already seen (back-edge)
					if (pairSeen.has(pair)) continue;
					pairSeen.add(pair);
					edgeSet.add(key);
					adj.get(t.from).push(t.to);
					inDegree.set(t.to, (inDegree.get(t.to) || 0) + 1);
				}
			}
		}

		// Assign layers via topological sort (Kahn's algorithm)
		// Only forward edges affect layer assignment; back-edges are ignored
		const layer = new Map();
		const deg = new Map();
		for (const code of topLevel) deg.set(code, inDegree.get(code) || 0);

		const topoQueue = topLevel.filter(c => deg.get(c) === 0);
		if (topoQueue.length === 0 && topLevel.length > 0) {
			topoQueue.push(topLevel[0]); // fallback for cyclic
		}

		const visited = new Set();
		for (const s of topoQueue) {
			layer.set(s, 0);
		}

		while (topoQueue.length > 0) {
			const code = topoQueue.shift();
			if (visited.has(code)) continue;
			visited.add(code);
			const currentLayer = layer.get(code) || 0;

			for (const next of (adj.get(code) || [])) {
				if (visited.has(next)) continue; // skip back-edges
				const nextLayer = Math.max(layer.get(next) || 0, currentLayer + 1);
				layer.set(next, nextLayer);
				const newDeg = (deg.get(next) || 1) - 1;
				deg.set(next, newDeg);
				if (newDeg <= 0) {
					topoQueue.push(next);
				}
			}
		}

		// Assign unvisited nodes (cycles) to layer 0
		for (const code of topLevel) {
			if (layer.has(code) === false) {
				layer.set(code, 0);
			}
		}

		// Group by layer
		const maxLayer = Math.max(0, ...layer.values());
		const layers = [];
		for (let i = 0; i <= maxLayer; i++) {
			layers.push([]);
		}
		for (const code of topLevel) {
			layers[layer.get(code)].push(code);
		}

		// Place nodes: layers along main axis, nodes spread in cross axis
		if (isLTR) {
			let x = L.MARGIN;
			for (const layerNodes of layers) {
				if (layerNodes.length === 0) continue;
				let y = L.MARGIN;
				let maxW = 0;
				for (const code of layerNodes) {
					const size = this.sizeMap.get(code);
					if (size == null) continue;
					this.posMap.set(code, { x, y, w: size.width, h: size.height });
					y += size.height + L.V_GAP;
					if (size.width > maxW) maxW = size.width;
				}
				x += maxW + L.H_GAP;
			}
		} else {
			// Top-to-bottom: layers are rows, nodes spread horizontally
			let y = L.MARGIN;
			for (const layerNodes of layers) {
				if (layerNodes.length === 0) continue;
				let x = L.MARGIN;
				let maxH = 0;
				for (const code of layerNodes) {
					const size = this.sizeMap.get(code);
					if (size == null) continue;
					this.posMap.set(code, { x, y, w: size.width, h: size.height });
					x += size.width + L.H_GAP;
					if (size.height > maxH) maxH = size.height;
				}
				y += maxH + L.V_GAP;
			}
		}

		// Place children inside composites
		for (const code of topLevel) {
			this._placeChildren(code);
		}
	}

	_placeChildren(code) {
		const el = this.diagram.elements.get(code);
		if (el == null) return;

		const pos = this.posMap.get(code);
		if (pos == null) return;

		if (el.concurrentRegions.length > 0) {
			this._placeConcurrentChildren(code);
			return;
		}

		if (el.children.length === 0) return;

		let cy = pos.y + L.COMPOSITE_HEADER + L.COMPOSITE_PAD;
		const cx = pos.x + L.COMPOSITE_PAD;

		for (const childCode of el.children) {
			const childSize = this.sizeMap.get(childCode);
			if (childSize == null) continue;

			// Center horizontally within composite
			const innerW = pos.w - L.COMPOSITE_PAD * 2;
			const childX = cx + (innerW - childSize.width) / 2;

			this.posMap.set(childCode, {
				x: childX,
				y: cy,
				w: childSize.width,
				h: childSize.height,
			});

			cy += childSize.height + L.V_GAP;

			// Recurse for nested composites
			this._placeChildren(childCode);
		}
	}

	_placeConcurrentChildren(code) {
		const el = this.diagram.elements.get(code);
		const pos = this.posMap.get(code);

		let cy = pos.y + L.COMPOSITE_HEADER + L.COMPOSITE_PAD;
		const cx = pos.x + L.COMPOSITE_PAD;
		const innerW = pos.w - L.COMPOSITE_PAD * 2;

		for (const region of el.concurrentRegions) {
			for (const childCode of region.elements) {
				const childSize = this.sizeMap.get(childCode);
				if (childSize == null) continue;

				const childX = cx + (innerW - childSize.width) / 2;
				this.posMap.set(childCode, {
					x: childX,
					y: cy,
					w: childSize.width,
					h: childSize.height,
				});

				cy += childSize.height + L.V_GAP;

				this._placeChildren(childCode);
			}

			cy += L.CONCURRENT_SEP;
		}
	}

	// ── Emit pass ────────────────────────────────────────────────────────────

	_emitTitle(title) {
		const titleId = this.nextId();
		this.cells.push(buildCell({
			id: titleId,
			value: xmlEscape(title),
			style: buildStyle({
				text: null,
				html: 1,
				align: 'center',
				verticalAlign: 'middle',
				fontStyle: 1,
				fontSize: 16,
				fillColor: 'none',
				strokeColor: 'none',
			}),
			vertex: true,
			parent: this.parentId,
			geometry: geom(L.MARGIN, 0, 300, 30),
		}));
	}

	_emitComposites(code) {
		const el = this.diagram.elements.get(code);
		if (el == null) return;

		const isComposite = el.children.length > 0 || el.concurrentRegions.length > 0;
		if (isComposite === false) return;

		const pos = this.posMap.get(code);
		if (pos == null) return;

		const cellId = this.nextId();
		this.idMap.set(code, cellId);

		const label = this._buildLabel(el);
		const style = buildStyle(compositeStyle(el));

		this.cells.push(buildCell({
			id: cellId,
			value: label,
			style,
			vertex: true,
			parent: this.parentId,
			geometry: geom(pos.x, pos.y, pos.w, pos.h),
		}));

		// Emit concurrent separators as dashed lines
		if (el.concurrentRegions.length > 1) {
			this._emitConcurrentSeparators(code);
		}

		// Recurse for nested composites
		const allChildren = el.children.length > 0
			? el.children
			: el.concurrentRegions.flatMap(r => r.elements);

		for (const childCode of allChildren) {
			this._emitComposites(childCode);
		}
	}

	_emitConcurrentSeparators(code) {
		const el = this.diagram.elements.get(code);
		const pos = this.posMap.get(code);
		if (pos == null || el.concurrentRegions.length < 2) return;

		// Calculate approximate y positions for separators between regions
		let cy = pos.y + L.COMPOSITE_HEADER + L.COMPOSITE_PAD;

		for (let i = 0; i < el.concurrentRegions.length - 1; i++) {
			const region = el.concurrentRegions[i];
			let regionH = 0;
			for (const childCode of region.elements) {
				const childSize = this.sizeMap.get(childCode);
				if (childSize) regionH += childSize.height + L.V_GAP;
			}
			if (region.elements.length > 0) regionH -= L.V_GAP;

			cy += regionH + L.V_GAP;

			// Emit dashed line
			const sepId = this.nextId();
			this.cells.push(buildCell({
				id: sepId,
				edge: true,
				parent: this.parentId,
				style: buildStyle({
					html: 1,
					dashed: 1,
					endArrow: 'none',
					endFill: 0,
					strokeColor: '#999999',
				}),
				sourcePoint: { x: pos.x + 5, y: cy },
				targetPoint: { x: pos.x + pos.w - 5, y: cy },
			}));

			cy += L.CONCURRENT_SEP;
		}
	}

	_emitLeaves(code) {
		const el = this.diagram.elements.get(code);
		if (el == null) return;

		const isComposite = el.children.length > 0 || el.concurrentRegions.length > 0;

		if (isComposite) {
			// Recurse to emit leaves inside composite
			const allChildren = el.children.length > 0
				? el.children
				: el.concurrentRegions.flatMap(r => r.elements);

			for (const childCode of allChildren) {
				this._emitLeaves(childCode);
			}
			return;
		}

		const pos = this.posMap.get(code);
		if (pos == null) return;

		this._emitLeafState(el, pos);
	}

	_emitLeafState(el, pos) {
		const cellId = this.nextId();
		this.idMap.set(el.code, cellId);

		switch (el.type) {
			case StateType.INITIAL: {
				this.cells.push(buildCell({
					id: cellId,
					value: '',
					style: buildStyle(initialStyle()),
					vertex: true,
					parent: this.parentId,
					geometry: geom(pos.x, pos.y, L.CIRCLE_SIZE, L.CIRCLE_SIZE),
				}));
				break;
			}

			case StateType.FINAL: {
				// Outer circle
				this.cells.push(buildCell({
					id: cellId,
					value: '',
					style: buildStyle(finalOuterStyle()),
					vertex: true,
					parent: this.parentId,
					geometry: geom(pos.x, pos.y, L.FINAL_OUTER_SIZE, L.FINAL_OUTER_SIZE),
				}));
				// Inner filled circle
				const innerSize = L.FINAL_INNER_SIZE;
				const offset = (L.FINAL_OUTER_SIZE - innerSize) / 2;
				const innerId = this.nextId();
				this.cells.push(buildCell({
					id: innerId,
					value: '',
					style: buildStyle(finalInnerStyle()),
					vertex: true,
					parent: this.parentId,
					geometry: geom(pos.x + offset, pos.y + offset, innerSize, innerSize),
				}));
				break;
			}

			case StateType.CHOICE: {
				this.cells.push(buildCell({
					id: cellId,
					value: '',
					style: buildStyle(choiceStyle()),
					vertex: true,
					parent: this.parentId,
					geometry: geom(pos.x, pos.y, L.DIAMOND_SIZE, L.DIAMOND_SIZE),
				}));
				break;
			}

			case StateType.FORK_JOIN:
			case StateType.SYNCHRO_BAR: {
				this.cells.push(buildCell({
					id: cellId,
					value: '',
					style: buildStyle(forkJoinStyle()),
					vertex: true,
					parent: this.parentId,
					geometry: geom(pos.x, pos.y, L.BAR_WIDTH, L.BAR_HEIGHT),
				}));
				break;
			}

			case StateType.HISTORY: {
				this.cells.push(buildCell({
					id: cellId,
					value: 'H',
					style: buildStyle(historyStyle()),
					vertex: true,
					parent: this.parentId,
					geometry: geom(pos.x, pos.y, L.HISTORY_SIZE, L.HISTORY_SIZE),
				}));
				break;
			}

			case StateType.DEEP_HISTORY: {
				this.cells.push(buildCell({
					id: cellId,
					value: 'H*',
					style: buildStyle(historyStyle()),
					vertex: true,
					parent: this.parentId,
					geometry: geom(pos.x, pos.y, L.HISTORY_SIZE, L.HISTORY_SIZE),
				}));
				break;
			}

			case StateType.STATE:
			default: {
				const label = this._buildLabel(el);

				if (el.descriptions.length > 0) {
					// Swimlane-style with header + body
					const style = buildStyle(stateWithDescStyle(el));
					this.cells.push(buildCell({
						id: cellId,
						value: label,
						style,
						vertex: true,
						parent: this.parentId,
						geometry: geom(pos.x, pos.y, pos.w, pos.h),
					}));

					// Description body as child cell
					const bodyId = this.nextId();
					const descText = el.descriptions.map(d => xmlEscape(d)).join('<br>');
					const bodyH = pos.h - 26; // startSize
					this.cells.push(buildCell({
						id: bodyId,
						value: descText,
						style: buildStyle({
							html: 1,
							align: 'left',
							verticalAlign: 'top',
							overflow: 'hidden',
							whiteSpace: 'wrap',
							fillColor: 'none',
							strokeColor: 'none',
							spacingLeft: 4,
						}),
						vertex: true,
						parent: cellId,
						geometry: geom(0, 26, pos.w, bodyH),
					}));
				} else {
					const style = buildStyle(stateStyle(el));
					this.cells.push(buildCell({
						id: cellId,
						value: label,
						style,
						vertex: true,
						parent: this.parentId,
						geometry: geom(pos.x, pos.y, pos.w, pos.h),
					}));
				}
				break;
			}
		}
	}

	_emitNotes() {
		for (const note of this.diagram.notes) {
			const noteId = this.nextId();

			// Compute note text and size
			const text = xmlEscape(note.text);
			const lineCount = note.text.split('\n').length;
			const noteH = Math.max(L.NOTE_MIN_HEIGHT, lineCount * L.NOTE_LINE_HEIGHT + 16);

			// Position note near its entity
			let noteX = L.MARGIN;
			let noteY = L.MARGIN;

			if (note.entityCode && this.posMap.has(note.entityCode)) {
				const entityPos = this.posMap.get(note.entityCode);
				switch (note.position) {
					case NotePosition.LEFT:
						noteX = entityPos.x - L.NOTE_OFFSET;
						noteY = entityPos.y;
						break;
					case NotePosition.RIGHT:
						noteX = entityPos.x + entityPos.w + L.H_GAP;
						noteY = entityPos.y;
						break;
					case NotePosition.TOP:
						noteX = entityPos.x;
						noteY = entityPos.y - noteH - L.V_GAP;
						break;
					case NotePosition.BOTTOM:
						noteX = entityPos.x;
						noteY = entityPos.y + entityPos.h + L.V_GAP;
						break;
				}
			} else if (note.isOnLink && note.linkIndex != null) {
				// Position near the midpoint of the linked transition
				const transitions = this.diagram.transitions;
				if (note.linkIndex < transitions.length) {
					const t = transitions[note.linkIndex];
					const fromPos = this.posMap.get(t.from);
					const toPos = this.posMap.get(t.to);
					if (fromPos && toPos) {
						noteX = (fromPos.x + toPos.x) / 2 + L.H_GAP;
						noteY = (fromPos.y + toPos.y) / 2;
					}
				}
			}

			this.cells.push(buildCell({
				id: noteId,
				value: text,
				style: buildStyle(noteStyle(note.color)),
				vertex: true,
				parent: this.parentId,
				geometry: geom(noteX, noteY, L.NOTE_WIDTH, noteH),
			}));

			// Dashed connector from note to entity
			if (note.entityCode && this.idMap.has(note.entityCode)) {
				const connId = this.nextId();
				this.cells.push(buildCell({
					id: connId,
					edge: true,
					parent: this.parentId,
					source: noteId,
					target: this.idMap.get(note.entityCode),
					style: buildStyle(noteDashedEdgeStyle()),
				}));
			}
		}
	}

	_emitTransitions(transitions) {
		for (const t of transitions) {
			const fromId = this.idMap.get(t.from);
			const toId = this.idMap.get(t.to);
			if (fromId == null || toId == null) continue;

			const edgeId = this.nextId();
			const label = t.label ? xmlEscape(t.label).replace(/\\n/g, '<br>') : '';

			this.cells.push(buildCell({
				id: edgeId,
				value: label,
				edge: true,
				parent: this.parentId,
				source: fromId,
				target: toId,
				style: buildStyle(edgeStyle(t)),
			}));
		}
	}

	// ── Label helpers ────────────────────────────────────────────────────────

	_buildLabel(el) {
		let label = xmlEscape(el.displayName);

		if (el.stereotypes.length > 0) {
			const stereoStr = el.stereotypes
				.map(s => '\u00AB' + xmlEscape(s) + '\u00BB')
				.join(' ');
			label = stereoStr + '<br>' + label;
		}

		return label;
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

export function emitStateDiagram(model, parentId) {
	const emitter = new StateEmitter(parentId);
	return emitter.emit(model);
}

export { StateEmitter };
