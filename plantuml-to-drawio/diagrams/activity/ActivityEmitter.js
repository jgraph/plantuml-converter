/**
 * Emitter for PlantUML activity diagrams → draw.io mxGraph XML.
 *
 * Uses a three-pass approach:
 *   1. Measure (bottom-up): compute bounding boxes for each instruction subtree
 *   2. Place (top-down): assign (x, y) coordinates
 *   3. Emit: walk placed instructions and generate mxCell XML via MxBuilder
 *
 * The layout is a vertical flowchart.  Branching structures (if, switch, fork,
 * split) place their branches side-by-side horizontally.  Loop structures
 * (while, repeat) have back-arrows routed to the side.
 */

import {
	InstructionType,
	NotePosition,
} from './ActivityModel.js';

import {
	buildCell,
	buildStyle,
	xmlEscape,
	createIdGenerator,
	geom,
	normalizeColor,
} from '../../MxBuilder.js';

// ── Layout constants ───────────────────────────────────────────────────────

const L = Object.freeze({
	ACTION_WIDTH:       140,
	ACTION_HEIGHT:       40,
	ACTION_CHAR_WIDTH:    7,
	ACTION_PADDING:      30,
	ACTION_LINE_HEIGHT:  20,
	DIAMOND_SIZE:        40,
	CIRCLE_SIZE:         30,
	BAR_WIDTH:           40,   // min width for fork/join bars
	BAR_HEIGHT:           4,
	NOTE_WIDTH:         140,
	NOTE_MIN_HEIGHT:     40,
	NOTE_LINE_HEIGHT:    16,
	NOTE_OFFSET:        160,   // horizontal offset from flow center
	H_GAP:               40,
	V_GAP:               30,
	PARTITION_PAD:       20,
	PARTITION_HEADER:    25,
	SWIMLANE_MIN_W:     200,
	SWIMLANE_HEADER:     30,
	MARGIN:              40,
	LOOP_OFFSET:         30,   // horizontal offset for loop back-arrows
});

// ── Style builders ─────────────────────────────────────────────────────────

function actionStyle(color) {
	const s = {
		rounded: 1,
		whiteSpace: 'wrap',
		html: 1,
		align: 'center',
		verticalAlign: 'middle',
	};
	if (color) s.fillColor = normalizeColor(color);
	return buildStyle(s);
}

function startStyle() {
	return buildStyle({
		shape: 'ellipse',
		fillColor: '#000000',
		strokeColor: '#000000',
		html: 1,
		resizable: 0,
	});
}

function stopOuterStyle() {
	// UML activity final node: outer ring (unfilled circle with border)
	return buildStyle({
		shape: 'ellipse',
		fillColor: 'none',
		strokeColor: '#000000',
		strokeWidth: 2,
		html: 1,
		resizable: 0,
	});
}

function stopInnerStyle() {
	// UML activity final node: inner filled circle
	return buildStyle({
		shape: 'ellipse',
		fillColor: '#000000',
		strokeColor: '#000000',
		html: 1,
		resizable: 0,
	});
}

function endOuterStyle() {
	return stopOuterStyle();
}

function endInnerStyle() {
	return stopInnerStyle();
}

function killStyle() {
	return buildStyle({
		shape: 'ellipse',
		fillColor: '#FF0000',
		strokeColor: '#FF0000',
		html: 1,
	});
}

function diamondStyle(color) {
	const s = {
		shape: 'rhombus',
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#FFFDE7',
		strokeColor: '#000000',
	};
	if (color) s.fillColor = normalizeColor(color);
	return buildStyle(s);
}

function mergeStyle() {
	return buildStyle({
		shape: 'rhombus',
		fillColor: '#FFFDE7',
		strokeColor: '#000000',
		html: 1,
	});
}

function barStyle() {
	return buildStyle({
		rounded: 1,
		fillColor: '#444444',
		strokeColor: '#444444',
		html: 1,
		arcSize: 50,
	});
}

function partitionStyle(color) {
	const s = {
		rounded: 0,
		whiteSpace: 'wrap',
		html: 1,
		verticalAlign: 'top',
		fontStyle: 1,
		fillColor: 'none',
		strokeColor: '#666666',
	};
	if (color) s.fillColor = normalizeColor(color);
	return buildStyle(s);
}

function noteStyle(color) {
	const s = {
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
	if (color) s.fillColor = normalizeColor(color);
	return buildStyle(s);
}

function edgeStyle(color, dashed) {
	const s = {
		html: 1,
		rounded: 0,
		endArrow: 'block',
		endFill: 1,
	};
	if (color) s.strokeColor = normalizeColor(color);
	if (dashed) s.dashed = 1;
	return buildStyle(s);
}

function loopBackEdgeStyle(exitSide, entrySide) {
	// exitSide/entrySide: 'left' or 'right'
	const s = {
		html: 1,
		rounded: 1,
		endArrow: 'block',
		endFill: 1,
		edgeStyle: 'orthogonalEdgeStyle',
		curved: 1,
	};
	if (exitSide === 'left') {
		s.exitX = 0;
		s.exitY = 0.5;
		s.exitDx = 0;
		s.exitDy = 0;
	} else if (exitSide === 'right') {
		s.exitX = 1;
		s.exitY = 0.5;
		s.exitDx = 0;
		s.exitDy = 0;
	}
	if (entrySide === 'left') {
		s.entryX = 0;
		s.entryY = 0.5;
		s.entryDx = 0;
		s.entryDy = 0;
	} else if (entrySide === 'right') {
		s.entryX = 1;
		s.entryY = 0.5;
		s.entryDx = 0;
		s.entryDy = 0;
	}
	return buildStyle(s);
}

function swimlaneStyle(color) {
	const s = {
		shape: 'swimlane',
		startSize: L.SWIMLANE_HEADER,
		html: 1,
		collapsible: 0,
		fontStyle: 1,
		fillColor: 'none',
		swimlaneLine: 1,
	};
	if (color) s.fillColor = normalizeColor(color);
	return buildStyle(s);
}

function breakStyle() {
	return buildStyle({
		rounded: 1,
		whiteSpace: 'wrap',
		html: 1,
		fillColor: '#F8CECC',
		strokeColor: '#B85450',
		dashed: 1,
	});
}

// ── Emitter class ──────────────────────────────────────────────────────────

class ActivityEmitter {
	constructor(parentId) {
		this.parentId = parentId;
		this.nextId = createIdGenerator('puml');
		this.cells = [];
		this._laneCx = null;  // Map<laneName, centerX> — set during swimlane mode
	}

	/**
	 * Emit an ActivityDiagram model as an array of mxCell XML strings.
	 * @param {import('./ActivityModel.js').ActivityDiagram} diagram
	 * @returns {string[]}
	 */
	emit(diagram) {
		this.diagram = diagram;

		// Filter out pure ARROW instructions at top level for measurement
		// (they don't occupy space themselves — they style the next edge)
		const flowInstructions = diagram.instructions;

		// 1. Measure
		const size = this._measureSequence(flowInstructions);

		// 2. Place
		const startX = L.MARGIN + size.width / 2;
		const startY = L.MARGIN;

		if (diagram.swimlanes.size > 0) {
			this._placeSwimlanes(diagram, flowInstructions, size);
		} else {
			this._placeSequence(flowInstructions, startX, startY, size.width);
		}

		// 3. Emit
		if (diagram.swimlanes.size > 0) {
			this._emitSwimlanes(diagram, size);
		}
		this._emitSequence(flowInstructions);

		return this.cells;
	}

	// ── Measure pass ───────────────────────────────────────────────────────

	_measureSequence(instructions) {
		let totalHeight = 0;
		let maxWidth = 0;

		for (let i = 0; i < instructions.length; i++) {
			const instr = instructions[i];
			const size = this._measureInstruction(instr);
			instr._size = size;

			if (instr.type === InstructionType.ARROW ||
				instr.type === InstructionType.NOTE ||
				instr.type === InstructionType.BREAK) {
				// Arrows and notes don't occupy vertical space in layout;
				// arrows modify the next edge's style, notes float to the side.
				// Break is invisible — it terminates the branch silently.
				continue;
			}

			if (totalHeight > 0) totalHeight += L.V_GAP;
			totalHeight += size.height;
			maxWidth = Math.max(maxWidth, size.width);
		}

		return { width: maxWidth || L.ACTION_WIDTH, height: totalHeight };
	}

	_measureInstruction(instr) {
		switch (instr.type) {
			case InstructionType.ACTION:
				return this._measureAction(instr);
			case InstructionType.START:
			case InstructionType.STOP:
			case InstructionType.END:
			case InstructionType.KILL:
				return { width: L.CIRCLE_SIZE, height: L.CIRCLE_SIZE };
			case InstructionType.BREAK:
				return { width: 0, height: 0 };
			case InstructionType.IF:
				return this._measureIf(instr);
			case InstructionType.WHILE:
				return this._measureWhile(instr);
			case InstructionType.REPEAT:
				return this._measureRepeat(instr);
			case InstructionType.SWITCH:
				return this._measureSwitch(instr);
			case InstructionType.FORK:
			case InstructionType.SPLIT:
				return this._measureForkSplit(instr);
			case InstructionType.PARTITION:
				return this._measurePartition(instr);
			case InstructionType.NOTE:
				return this._measureNote(instr);
			case InstructionType.ARROW:
				return { width: 0, height: 0 };
			default:
				return { width: L.ACTION_WIDTH, height: L.ACTION_HEIGHT };
		}
	}

	_measureAction(instr) {
		const lines = (instr.label || '').split('\n');
		const maxLineLen = Math.max(...lines.map(l => l.length));
		const w = Math.max(L.ACTION_WIDTH, maxLineLen * L.ACTION_CHAR_WIDTH + L.ACTION_PADDING);
		const h = Math.max(L.ACTION_HEIGHT, lines.length * L.ACTION_LINE_HEIGHT + 20);
		return { width: w, height: h };
	}

	_measureIf(instr) {
		// Check for trivial if-then-break (no else): just a diamond, no branches
		const thenOnlyBreak = instr.elseBranch.length === 0
			&& instr.elseIfBranches.length === 0
			&& instr.thenBranch.length > 0
			&& instr.thenBranch.every(i => i.type === InstructionType.BREAK);

		if (thenOnlyBreak) {
			instr._thenSize = { width: 0, height: 0 };
			instr._elseSize = { width: 0, height: 0 };
			instr._allBranches = [];
			instr._hasElseIfChain = false;
			instr._thenOnlyBreak = true;
			return { width: L.DIAMOND_SIZE, height: L.DIAMOND_SIZE };
		}

		// Then branch
		const thenSize = this._measureSequence(instr.thenBranch);
		instr._thenSize = thenSize;

		// ElseIf branches
		for (const eib of instr.elseIfBranches) {
			const eibSize = this._measureSequence(eib.instructions);
			eib._size = eibSize;
		}

		// Else branch
		const elseSize = this._measureSequence(instr.elseBranch);
		instr._elseSize = elseSize;

		if (instr.elseIfBranches.length === 0) {
			// Simple if/else: two parallel branches
			const thenW = Math.max(thenSize.width, L.DIAMOND_SIZE);
			const elseW = Math.max(elseSize.width, L.DIAMOND_SIZE);
			const maxBranchH = Math.max(thenSize.height, elseSize.height);
			const totalW = thenW + L.H_GAP + elseW;
			const h = L.DIAMOND_SIZE + L.V_GAP + maxBranchH + L.V_GAP + L.DIAMOND_SIZE / 2;
			instr._allBranches = [
				{ size: thenSize, width: thenW },
				{ size: elseSize, width: elseW },
			];
			instr._hasElseIfChain = false;
			return { width: totalW, height: h };
		}

		// ElseIf chain: each decision has a "yes" branch, chained horizontally
		// Collect all branch columns: [then, eib1, eib2, ..., else]
		const columns = [];
		columns.push({ size: thenSize, width: Math.max(thenSize.width, L.DIAMOND_SIZE) });
		for (const eib of instr.elseIfBranches) {
			columns.push({ size: eib._size, width: Math.max(eib._size.width, L.DIAMOND_SIZE) });
		}
		columns.push({ size: elseSize, width: Math.max(elseSize.width, L.DIAMOND_SIZE) });

		let totalWidth = 0;
		let maxBranchHeight = 0;
		for (const col of columns) {
			totalWidth += col.width;
			maxBranchHeight = Math.max(maxBranchHeight, col.size.height);
		}
		totalWidth += L.H_GAP * (columns.length - 1);

		// Height includes: top diamond + gap + max branch body + gap + merge
		// ElseIf diamonds are placed at the same Y as the top diamond (horizontally offset)
		const h = L.DIAMOND_SIZE + L.V_GAP + maxBranchHeight + L.V_GAP + L.DIAMOND_SIZE / 2;

		instr._allBranches = columns;
		instr._hasElseIfChain = true;
		return { width: totalWidth, height: h };
	}

	_measureWhile(instr) {
		const bodySize = this._measureSequence(instr.whileBody);
		instr._bodySize = bodySize;

		const w = Math.max(bodySize.width + L.LOOP_OFFSET * 2, L.DIAMOND_SIZE + L.LOOP_OFFSET * 2);
		const h = L.DIAMOND_SIZE + L.V_GAP + bodySize.height + L.V_GAP;
		return { width: w, height: h };
	}

	_measureRepeat(instr) {
		const bodySize = this._measureSequence(instr.repeatBody);
		instr._bodySize = bodySize;

		// If there's a start label (repeat :Label;), measure an extra action
		let startLabelHeight = 0;
		if (instr.repeatStartLabel) {
			const lines = instr.repeatStartLabel.split('\n');
			const maxLineLen = Math.max(...lines.map(l => l.length));
			instr._startLabelWidth = Math.max(L.ACTION_WIDTH, maxLineLen * L.ACTION_CHAR_WIDTH + L.ACTION_PADDING);
			instr._startLabelHeight = Math.max(L.ACTION_HEIGHT, lines.length * L.ACTION_LINE_HEIGHT + 20);
			startLabelHeight = instr._startLabelHeight + L.V_GAP;
		}

		const w = Math.max(bodySize.width + L.LOOP_OFFSET * 2, L.DIAMOND_SIZE + L.LOOP_OFFSET * 2);
		const h = startLabelHeight + bodySize.height + L.V_GAP + L.DIAMOND_SIZE + L.V_GAP;
		return { width: w, height: h };
	}

	_measureSwitch(instr) {
		let totalCaseWidth = 0;
		let maxCaseHeight = 0;

		for (const c of instr.switchCases) {
			const cSize = this._measureSequence(c.instructions);
			c._size = cSize;
			totalCaseWidth += Math.max(cSize.width, L.ACTION_WIDTH);
			maxCaseHeight = Math.max(maxCaseHeight, cSize.height);
		}
		if (instr.switchCases.length > 1) {
			totalCaseWidth += L.H_GAP * (instr.switchCases.length - 1);
		}

		const w = Math.max(totalCaseWidth, L.DIAMOND_SIZE);
		const h = L.DIAMOND_SIZE + L.V_GAP + maxCaseHeight + L.V_GAP + L.DIAMOND_SIZE / 2;

		instr._maxCaseHeight = maxCaseHeight;
		return { width: w, height: h };
	}

	_measureForkSplit(instr) {
		let totalBranchWidth = 0;
		let maxBranchHeight = 0;

		for (const branch of instr.branches) {
			const bSize = this._measureSequence(branch);
			branch._size = bSize;
			totalBranchWidth += Math.max(bSize.width, L.ACTION_WIDTH);
			maxBranchHeight = Math.max(maxBranchHeight, bSize.height);
		}
		if (instr.branches.length > 1) {
			totalBranchWidth += L.H_GAP * (instr.branches.length - 1);
		}

		const w = Math.max(totalBranchWidth, L.BAR_WIDTH);
		const h = L.BAR_HEIGHT + L.V_GAP + maxBranchHeight + L.V_GAP + L.BAR_HEIGHT;

		instr._maxBranchHeight = maxBranchHeight;
		// Bar width: 80% of total branch spread, capped at a reasonable size
		instr._barWidth = Math.max(L.BAR_WIDTH, totalBranchWidth * 0.7);
		return { width: w, height: h };
	}

	_measurePartition(instr) {
		const bodySize = this._measureSequence(instr.partitionBody);
		instr._bodySize = bodySize;

		const w = bodySize.width + L.PARTITION_PAD * 2;
		const h = L.PARTITION_HEADER + bodySize.height + L.PARTITION_PAD;
		return { width: w, height: h };
	}

	_measureNote(instr) {
		const lines = (instr.noteText || '').split('\n');
		const h = Math.max(L.NOTE_MIN_HEIGHT, lines.length * L.NOTE_LINE_HEIGHT + 16);
		return { width: L.NOTE_WIDTH, height: h };
	}

	// ── Place pass ─────────────────────────────────────────────────────────

	_placeSequence(instructions, cx, y, availWidth) {
		let currentY = y;
		let lastPlacedY = y;
		let lastPlacedHeight = 0;
		// Track bottom Y of notes on each side to avoid overlap
		let noteBottomLeft = 0;
		let noteBottomRight = 0;
		for (const instr of instructions) {
			if (instr.type === InstructionType.ARROW) continue;
			if (instr.type === InstructionType.BREAK) continue;
			if (instr.type === InstructionType.NOTE) {
				// Place note beside the last placed instruction, avoiding overlap
				const instrCx = this._getLaneCx(instr, cx);
				const side = instr.notePosition;
				const noteBottom = side === NotePosition.LEFT ? noteBottomLeft : noteBottomRight;
				const noteY = Math.max(lastPlacedY, noteBottom);
				this._placeNote(instr, instrCx, noteY);
				const newBottom = noteY + instr._size.height + 4;
				if (side === NotePosition.LEFT) {
					noteBottomLeft = newBottom;
				} else {
					noteBottomRight = newBottom;
				}
				continue;
			}
			// In swimlane mode, override cx with the instruction's lane center
			const instrCx = this._getLaneCx(instr, cx);
			this._placeInstruction(instr, instrCx, currentY, availWidth);
			lastPlacedY = currentY;
			lastPlacedHeight = instr._size.height;
			currentY += instr._size.height + L.V_GAP;
		}
	}

	/**
	 * Get the center X for an instruction, respecting swimlane assignment.
	 * Falls back to the provided default cx.
	 */
	_getLaneCx(instr, defaultCx) {
		if (this._laneCx !== null && instr.swimlane) {
			const laneCx = this._laneCx.get(instr.swimlane);
			if (laneCx !== undefined) return laneCx;
		}
		return defaultCx;
	}

	_placeInstruction(instr, cx, y, availWidth) {
		switch (instr.type) {
			case InstructionType.ACTION:
			case InstructionType.BREAK:
				instr._x = cx - instr._size.width / 2;
				instr._y = y;
				break;

			case InstructionType.START:
			case InstructionType.STOP:
			case InstructionType.END:
			case InstructionType.KILL:
				instr._x = cx - L.CIRCLE_SIZE / 2;
				instr._y = y;
				break;

			case InstructionType.IF:
				this._placeIf(instr, cx, y);
				break;

			case InstructionType.WHILE:
				this._placeWhile(instr, cx, y);
				break;

			case InstructionType.REPEAT:
				this._placeRepeat(instr, cx, y);
				break;

			case InstructionType.SWITCH:
				this._placeSwitch(instr, cx, y);
				break;

			case InstructionType.FORK:
			case InstructionType.SPLIT:
				this._placeForkSplit(instr, cx, y);
				break;

			case InstructionType.PARTITION:
				this._placePartition(instr, cx, y);
				break;

			case InstructionType.NOTE:
				this._placeNote(instr, cx, y);
				break;
		}
	}

	_placeIf(instr, cx, y) {
		const totalW = instr._size.width;
		const branchY = y + L.DIAMOND_SIZE + L.V_GAP;

		if (instr._thenOnlyBreak) {
			// Trivial if-then-break: just a diamond, no branches/merge
			instr._diamondX = cx - L.DIAMOND_SIZE / 2;
			instr._diamondY = y;
			return;
		}

		if (!instr._hasElseIfChain) {
			// Simple if/else: single diamond at top center, two parallel branches
			instr._diamondX = cx - L.DIAMOND_SIZE / 2;
			instr._diamondY = y;

			let branchX = cx - totalW / 2;
			const thenW = instr._allBranches[0].width;
			this._placeSequence(instr.thenBranch, branchX + thenW / 2, branchY, thenW);
			branchX += thenW + L.H_GAP;
			const elseW = instr._allBranches[1].width;
			this._placeSequence(instr.elseBranch, branchX + elseW / 2, branchY, elseW);
		} else {
			// ElseIf chain: separate diamonds at same Y, spaced above their columns.
			// Columns: [then, eib1, eib2, ..., else]
			// Diamonds: main diamond above then, eib1 diamond above eib1, etc.
			let colX = cx - totalW / 2;
			let colIdx = 0;

			// Main diamond above the then-branch column
			const thenW = instr._allBranches[colIdx].width;
			const thenCx = colX + thenW / 2;
			instr._diamondX = thenCx - L.DIAMOND_SIZE / 2;
			instr._diamondY = y;
			this._placeSequence(instr.thenBranch, thenCx, branchY, thenW);
			colX += thenW + L.H_GAP;
			colIdx++;

			// ElseIf diamonds — each above its branch column
			instr._elseIfDiamonds = [];
			for (const eib of instr.elseIfBranches) {
				const eibW = instr._allBranches[colIdx].width;
				const eibCx = colX + eibW / 2;
				eib._diamondX = eibCx - L.DIAMOND_SIZE / 2;
				eib._diamondY = y;
				this._placeSequence(eib.instructions, eibCx, branchY, eibW);
				instr._elseIfDiamonds.push({ x: eib._diamondX, y: eib._diamondY, cx: eibCx });
				colX += eibW + L.H_GAP;
				colIdx++;
			}

			// Else branch
			const elseW = instr._allBranches[colIdx].width;
			const elseCx = colX + elseW / 2;
			this._placeSequence(instr.elseBranch, elseCx, branchY, elseW);
		}

		// Merge point at bottom center
		instr._mergeX = cx - L.DIAMOND_SIZE / 4;
		instr._mergeY = y + instr._size.height - L.DIAMOND_SIZE / 2;
	}

	_placeWhile(instr, cx, y) {
		// Diamond at top
		instr._diamondX = cx - L.DIAMOND_SIZE / 2;
		instr._diamondY = y;

		// Body below diamond
		const bodyY = y + L.DIAMOND_SIZE + L.V_GAP;
		this._placeSequence(instr.whileBody, cx, bodyY, instr._bodySize.width);
	}

	_placeRepeat(instr, cx, y) {
		let currentY = y;

		// Start label action (if present)
		if (instr.repeatStartLabel) {
			instr._startLabelX = cx - instr._startLabelWidth / 2;
			instr._startLabelY = currentY;
			currentY += instr._startLabelHeight + L.V_GAP;
		}

		// Body
		this._placeSequence(instr.repeatBody, cx, currentY, instr._bodySize.width);
		currentY += instr._bodySize.height + L.V_GAP;

		// Diamond below body
		instr._diamondX = cx - L.DIAMOND_SIZE / 2;
		instr._diamondY = currentY;
	}

	_placeSwitch(instr, cx, y) {
		// Diamond at top
		instr._diamondX = cx - L.DIAMOND_SIZE / 2;
		instr._diamondY = y;

		// Cases placed side-by-side below diamond
		const caseY = y + L.DIAMOND_SIZE + L.V_GAP;
		const totalW = instr._size.width;
		let caseX = cx - totalW / 2;

		for (const c of instr.switchCases) {
			const caseW = Math.max(c._size.width, L.ACTION_WIDTH);
			const caseCx = caseX + caseW / 2;
			this._placeSequence(c.instructions, caseCx, caseY, caseW);
			caseX += caseW + L.H_GAP;
		}

		// Merge at bottom
		instr._mergeX = cx - L.DIAMOND_SIZE / 4;
		instr._mergeY = y + instr._size.height - L.DIAMOND_SIZE / 2;
	}

	_placeForkSplit(instr, cx, y) {
		const barW = instr._barWidth || instr._size.width;

		// Top bar (centered, narrower than full width)
		instr._topBarX = cx - barW / 2;
		instr._topBarY = y;
		instr._barRenderWidth = barW;

		// Branches below top bar
		const branchY = y + L.BAR_HEIGHT + L.V_GAP;
		const totalW = instr._size.width;
		let branchX = cx - totalW / 2;

		for (const branch of instr.branches) {
			const bw = Math.max(branch._size.width, L.ACTION_WIDTH);
			const branchCx = branchX + bw / 2;
			this._placeSequence(branch, branchCx, branchY, bw);
			branchX += bw + L.H_GAP;
		}

		// Bottom bar (centered, same width as top bar)
		instr._botBarX = cx - barW / 2;
		instr._botBarY = y + instr._size.height - L.BAR_HEIGHT;
	}

	_placePartition(instr, cx, y) {
		instr._x = cx - instr._size.width / 2;
		instr._y = y;

		// Body inside partition
		const bodyY = y + L.PARTITION_HEADER;
		this._placeSequence(instr.partitionBody, cx, bodyY, instr._bodySize.width);
	}

	_placeNote(instr, cx, y) {
		// Notes offset to the side
		if (instr.notePosition === NotePosition.LEFT) {
			instr._x = cx - L.NOTE_OFFSET - L.NOTE_WIDTH / 2;
		} else {
			instr._x = cx + L.NOTE_OFFSET - L.NOTE_WIDTH / 2;
		}
		instr._y = y;
	}

	_placeSwimlanes(diagram, instructions, totalSize) {
		// Collect unique swimlane names in order of first appearance
		const laneOrder = [];
		for (const [name] of diagram.swimlanes) {
			laneOrder.push(name);
		}

		// Also create a "default" lane for unassigned instructions
		const defaultLane = '__default__';
		const hasUnassigned = instructions.some(i => i.swimlane === null);
		if (hasUnassigned) {
			laneOrder.unshift(defaultLane);
		}

		// Compute lane widths: use max instruction width per lane, or min
		const laneWidths = new Map();
		for (const name of laneOrder) {
			laneWidths.set(name, L.SWIMLANE_MIN_W);
		}
		for (const instr of instructions) {
			if (instr.type === InstructionType.ARROW || instr.type === InstructionType.NOTE) continue;
			const lane = instr.swimlane || defaultLane;
			const instrW = (instr._size ? instr._size.width : L.ACTION_WIDTH) + L.PARTITION_PAD * 2;
			const cur = laneWidths.get(lane) || L.SWIMLANE_MIN_W;
			laneWidths.set(lane, Math.max(cur, instrW));
		}

		// Assign lane X positions and center X for each lane
		const laneCx = new Map();
		let laneX = L.MARGIN;
		for (const name of laneOrder) {
			const laneW = laneWidths.get(name);
			const def = diagram.swimlanes.get(name);
			if (def) {
				def._x = laneX;
				def._width = laneW;
				def._height = totalSize.height + L.SWIMLANE_HEADER + L.MARGIN;
			}
			laneCx.set(name, laneX + laneW / 2);
			laneX += laneW;
		}

		// Store lane centers for use in nested placement (branches inside if/while)
		this._laneCx = laneCx;

		// Place all instructions sequentially, using the lane's center X
		let currentY = L.MARGIN + L.SWIMLANE_HEADER;
		let lastPlacedY = currentY;
		for (const instr of instructions) {
			if (instr.type === InstructionType.ARROW) continue;
			if (instr.type === InstructionType.BREAK) continue;
			if (instr.type === InstructionType.NOTE) {
				const lane = instr.swimlane || defaultLane;
				const cx = laneCx.get(lane) || laneCx.values().next().value;
				this._placeNote(instr, cx, lastPlacedY);
				continue;
			}

			const lane = instr.swimlane || defaultLane;
			const cx = laneCx.get(lane) || laneCx.values().next().value;
			this._placeInstruction(instr, cx, currentY, laneWidths.get(lane) || L.SWIMLANE_MIN_W);
			lastPlacedY = currentY;
			currentY += instr._size.height + L.V_GAP;
		}
	}

	// ── Emit pass ──────────────────────────────────────────────────────────

	_emitSequence(instructions) {
		let prevCellId = null;
		let pendingArrowInstr = null;
		let prevInstr = null;

		for (const instr of instructions) {
			if (instr.type === InstructionType.ARROW) {
				pendingArrowInstr = instr;
				continue;
			}

			const result = this._emitInstruction(instr);

			// Connect to previous element
			if (prevCellId !== null && result.entryId !== null) {
				const arrowColor = pendingArrowInstr ? pendingArrowInstr.arrowColor : null;
				const arrowDashed = pendingArrowInstr ? pendingArrowInstr.arrowDashed : false;
				let arrowLabel = pendingArrowInstr ? pendingArrowInstr.arrowLabel : null;
				// Use exit label from while/repeat loops
				if (arrowLabel === null && prevInstr && prevInstr._exitLabel) {
					arrowLabel = prevInstr._exitLabel;
				}
				this._emitEdge(prevCellId, result.entryId, arrowLabel, arrowColor, arrowDashed);
			}

			pendingArrowInstr = null;
			// Only update prev tracking for flow-participating instructions
			// (notes return null for both entry/exit and shouldn't break the chain)
			if (result.entryId !== null || result.exitId !== null) {
				prevCellId = result.exitId;
				prevInstr = instr;
			}
		}
	}

	/**
	 * Emit a single instruction.  Returns { entryId, exitId } for edge wiring.
	 */
	_emitInstruction(instr) {
		switch (instr.type) {
			case InstructionType.ACTION:
				return this._emitAction(instr);
			case InstructionType.START:
				return this._emitStart(instr);
			case InstructionType.STOP:
				return this._emitStop(instr);
			case InstructionType.END:
				return this._emitEnd(instr);
			case InstructionType.KILL:
				return this._emitKill(instr);
			case InstructionType.BREAK:
				return this._emitBreak(instr);
			case InstructionType.IF:
				return this._emitIf(instr);
			case InstructionType.WHILE:
				return this._emitWhile(instr);
			case InstructionType.REPEAT:
				return this._emitRepeat(instr);
			case InstructionType.SWITCH:
				return this._emitSwitch(instr);
			case InstructionType.FORK:
			case InstructionType.SPLIT:
				return this._emitForkSplit(instr);
			case InstructionType.PARTITION:
				return this._emitPartition(instr);
			case InstructionType.NOTE:
				return this._emitNote(instr);
			default:
				return { entryId: null, exitId: null };
		}
	}

	_emitAction(instr) {
		const id = this.nextId();
		this.cells.push(buildCell({
			id,
			value: instr.label || '',
			style: actionStyle(instr.color),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x, instr._y, instr._size.width, instr._size.height),
		}));
		return { entryId: id, exitId: id };
	}

	_emitStart(instr) {
		const id = this.nextId();
		this.cells.push(buildCell({
			id,
			value: '',
			style: startStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x, instr._y, L.CIRCLE_SIZE, L.CIRCLE_SIZE),
		}));
		return { entryId: id, exitId: id };
	}

	_emitStop(instr) {
		// UML final node: outer ring + inner filled circle
		const outerId = this.nextId();
		this.cells.push(buildCell({
			id: outerId,
			value: '',
			style: stopOuterStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x, instr._y, L.CIRCLE_SIZE, L.CIRCLE_SIZE),
		}));
		const innerSize = Math.round(L.CIRCLE_SIZE * 0.53);
		const innerOffset = Math.round((L.CIRCLE_SIZE - innerSize) / 2);
		const innerId = this.nextId();
		this.cells.push(buildCell({
			id: innerId,
			value: '',
			style: stopInnerStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x + innerOffset, instr._y + innerOffset, innerSize, innerSize),
		}));
		return { entryId: outerId, exitId: outerId };
	}

	_emitEnd(instr) {
		// UML final node: outer ring + inner filled circle
		const outerId = this.nextId();
		this.cells.push(buildCell({
			id: outerId,
			value: '',
			style: endOuterStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x, instr._y, L.CIRCLE_SIZE, L.CIRCLE_SIZE),
		}));
		const innerSize = Math.round(L.CIRCLE_SIZE * 0.53);
		const innerOffset = Math.round((L.CIRCLE_SIZE - innerSize) / 2);
		const innerId = this.nextId();
		this.cells.push(buildCell({
			id: innerId,
			value: '',
			style: endInnerStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x + innerOffset, instr._y + innerOffset, innerSize, innerSize),
		}));
		return { entryId: outerId, exitId: outerId };
	}

	_emitKill(instr) {
		const id = this.nextId();
		this.cells.push(buildCell({
			id,
			value: '',
			style: killStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x, instr._y, L.CIRCLE_SIZE, L.CIRCLE_SIZE),
		}));
		return { entryId: id, exitId: null }; // kill has no exit
	}

	_emitBreak(instr) {
		// PlantUML does not render break as a visible node.
		// It terminates the branch silently — the containing if-branch
		// becomes empty, routing the edge directly to the merge point.
		return { entryId: null, exitId: null };
	}

	_emitIf(instr) {
		// Check if this is a trivial if-then with only break (no else).
		// Break is invisible, so the if-block effectively has no visible branches.
		// Skip the merge diamond and use the diamond as both entry and exit.
		const thenOnlyBreak = instr.elseBranch.length === 0
			&& instr.elseIfBranches.length === 0
			&& instr.thenBranch.every(i => i.type === InstructionType.BREAK);

		// Main diamond
		const diamondId = this.nextId();
		this.cells.push(buildCell({
			id: diamondId,
			value: instr.condition || '',
			style: diamondStyle(instr.color),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._diamondX, instr._diamondY, L.DIAMOND_SIZE, L.DIAMOND_SIZE),
		}));

		if (thenOnlyBreak) {
			// Diamond acts as a simple pass-through — no merge needed
			return { entryId: diamondId, exitId: diamondId };
		}

		// Merge point
		const mergeId = this.nextId();
		this.cells.push(buildCell({
			id: mergeId,
			value: '',
			style: mergeStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._mergeX, instr._mergeY, L.DIAMOND_SIZE / 2, L.DIAMOND_SIZE / 2),
		}));

		// Emit then branch (goes down from main diamond)
		const thenResult = this._emitBranch(instr.thenBranch);
		if (thenResult.entryId) {
			this._emitEdge(diamondId, thenResult.entryId, instr.thenLabel);
		} else {
			this._emitEdge(diamondId, mergeId, instr.thenLabel);
		}
		if (thenResult.exitId) {
			this._emitEdge(thenResult.exitId, mergeId);
		}

		if (!instr._hasElseIfChain) {
			// Simple if/else
			if (instr.elseBranch.length > 0) {
				const elseResult = this._emitBranch(instr.elseBranch);
				if (elseResult.entryId) {
					this._emitEdge(diamondId, elseResult.entryId, instr.elseLabel);
				}
				if (elseResult.exitId) {
					this._emitEdge(elseResult.exitId, mergeId);
				}
			} else {
				this._emitEdge(diamondId, mergeId, instr.elseLabel);
			}
		} else {
			// ElseIf chain: each elseif gets its own diamond.
			// Main diamond → eib1 diamond → eib2 diamond → ... → else branch
			let prevDiamondId = diamondId;
			for (let i = 0; i < instr.elseIfBranches.length; i++) {
				const eib = instr.elseIfBranches[i];
				const pos = instr._elseIfDiamonds[i];

				// Create diamond for this elseif
				const eibDiamondId = this.nextId();
				this.cells.push(buildCell({
					id: eibDiamondId,
					value: eib.condition || '',
					style: diamondStyle(null),
					vertex: true,
					parent: this.parentId,
					geometry: geom(pos.x, pos.y, L.DIAMOND_SIZE, L.DIAMOND_SIZE),
				}));

				// Previous diamond → this diamond (the "else" path)
				this._emitEdge(prevDiamondId, eibDiamondId);

				// This diamond → branch body (the "yes" path)
				const eibResult = this._emitBranch(eib.instructions);
				if (eibResult.entryId) {
					this._emitEdge(eibDiamondId, eibResult.entryId, eib.label || 'yes');
				} else {
					this._emitEdge(eibDiamondId, mergeId, eib.label || 'yes');
				}
				if (eibResult.exitId) {
					this._emitEdge(eibResult.exitId, mergeId);
				}

				prevDiamondId = eibDiamondId;
			}

			// Last diamond → else branch
			if (instr.elseBranch.length > 0) {
				const elseResult = this._emitBranch(instr.elseBranch);
				if (elseResult.entryId) {
					this._emitEdge(prevDiamondId, elseResult.entryId, instr.elseLabel);
				}
				if (elseResult.exitId) {
					this._emitEdge(elseResult.exitId, mergeId);
				}
			} else {
				this._emitEdge(prevDiamondId, mergeId, instr.elseLabel);
			}
		}

		return { entryId: diamondId, exitId: mergeId };
	}

	_emitWhile(instr) {
		// Diamond
		const diamondId = this.nextId();
		this.cells.push(buildCell({
			id: diamondId,
			value: instr.whileCondition || '',
			style: diamondStyle(instr.color),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._diamondX, instr._diamondY, L.DIAMOND_SIZE, L.DIAMOND_SIZE),
		}));

		// Emit body
		const bodyResult = this._emitBranch(instr.whileBody);

		// Diamond → body (yes)
		if (bodyResult.entryId) {
			this._emitEdge(diamondId, bodyResult.entryId, instr.whileYesLabel);
		}

		// Body → diamond (loop back)
		if (bodyResult.exitId) {
			this._emitLoopBack(bodyResult.exitId, diamondId, instr);
		}

		// Diamond exit (no) — the next instruction will connect here
		// We use the diamond as both entry and exit.
		// The "no" label will be on the edge from diamond to next instruction.
		// Store it for the parent to use.
		instr._exitLabel = instr.whileNoLabel;

		return { entryId: diamondId, exitId: diamondId };
	}

	_emitRepeat(instr) {
		let topEntryId = null;

		// Emit start label action if present (repeat :Initialize;)
		let startLabelId = null;
		if (instr.repeatStartLabel) {
			startLabelId = this.nextId();
			this.cells.push(buildCell({
				id: startLabelId,
				value: instr.repeatStartLabel,
				style: actionStyle(null),
				vertex: true,
				parent: this.parentId,
				geometry: geom(instr._startLabelX, instr._startLabelY, instr._startLabelWidth, instr._startLabelHeight),
			}));
			topEntryId = startLabelId;
		}

		// Emit body
		const bodyResult = this._emitBranch(instr.repeatBody);

		// Connect start label → body
		if (startLabelId !== null && bodyResult.entryId) {
			this._emitEdge(startLabelId, bodyResult.entryId);
		}

		if (topEntryId === null) {
			topEntryId = bodyResult.entryId;
		}

		// Diamond at bottom
		const diamondId = this.nextId();
		this.cells.push(buildCell({
			id: diamondId,
			value: instr.repeatCondition || '',
			style: diamondStyle(instr.color),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._diamondX, instr._diamondY, L.DIAMOND_SIZE, L.DIAMOND_SIZE),
		}));

		// Body → diamond
		if (bodyResult.exitId) {
			this._emitEdge(bodyResult.exitId, diamondId);
		}

		// Diamond → loop back to top (loop back, "yes")
		const loopBackTarget = topEntryId || diamondId;
		this._emitLoopBack(diamondId, loopBackTarget, instr, instr.repeatYesLabel);

		// Entry is the top, exit is the diamond (continues to next via "no")
		instr._exitLabel = instr.repeatNoLabel;

		return { entryId: topEntryId || diamondId, exitId: diamondId };
	}

	_emitSwitch(instr) {
		// Diamond
		const diamondId = this.nextId();
		this.cells.push(buildCell({
			id: diamondId,
			value: instr.switchCondition || '',
			style: diamondStyle(instr.color),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._diamondX, instr._diamondY, L.DIAMOND_SIZE, L.DIAMOND_SIZE),
		}));

		// Merge point
		const mergeId = this.nextId();
		this.cells.push(buildCell({
			id: mergeId,
			value: '',
			style: mergeStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._mergeX, instr._mergeY, L.DIAMOND_SIZE / 2, L.DIAMOND_SIZE / 2),
		}));

		// Emit cases
		for (const c of instr.switchCases) {
			const cResult = this._emitBranch(c.instructions);
			if (cResult.entryId) {
				this._emitEdge(diamondId, cResult.entryId, c.label);
			}
			if (cResult.exitId) {
				this._emitEdge(cResult.exitId, mergeId);
			}
		}

		return { entryId: diamondId, exitId: mergeId };
	}

	_emitForkSplit(instr) {
		const barW = instr._barRenderWidth || instr._size.width;

		// Top bar
		const topBarId = this.nextId();
		this.cells.push(buildCell({
			id: topBarId,
			value: '',
			style: barStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._topBarX, instr._topBarY, barW, L.BAR_HEIGHT),
		}));

		// Bottom bar
		const botBarId = this.nextId();
		this.cells.push(buildCell({
			id: botBarId,
			value: '',
			style: barStyle(),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._botBarX, instr._botBarY, barW, L.BAR_HEIGHT),
		}));

		// Emit branches
		for (const branch of instr.branches) {
			const bResult = this._emitBranch(branch);
			if (bResult.entryId) {
				this._emitEdge(topBarId, bResult.entryId);
			}
			if (bResult.exitId) {
				this._emitEdge(bResult.exitId, botBarId);
			}
		}

		return { entryId: topBarId, exitId: botBarId };
	}

	_emitPartition(instr) {
		// Partition container
		const partId = this.nextId();
		this.cells.push(buildCell({
			id: partId,
			value: instr.partitionName || '',
			style: partitionStyle(instr.partitionColor),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x, instr._y, instr._size.width, instr._size.height),
		}));

		// Emit body (body cells have the partition as visual context but
		// still use the main parentId for draw.io grouping)
		const bodyResult = this._emitBranch(instr.partitionBody);

		return { entryId: bodyResult.entryId || partId, exitId: bodyResult.exitId || partId };
	}

	_emitNote(instr) {
		const id = this.nextId();
		this.cells.push(buildCell({
			id,
			value: instr.noteText || '',
			style: noteStyle(instr.color),
			vertex: true,
			parent: this.parentId,
			geometry: geom(instr._x, instr._y, L.NOTE_WIDTH, instr._size.height),
		}));
		// Notes don't participate in flow — they don't break the edge chain
		return { entryId: null, exitId: null };
	}

	_emitSwimlanes(diagram, totalSize) {
		for (const [name, def] of diagram.swimlanes) {
			if (def._x === undefined) continue;
			const id = this.nextId();
			this.cells.push(buildCell({
				id,
				value: def.label || name,
				style: swimlaneStyle(def.color),
				vertex: true,
				parent: this.parentId,
				geometry: geom(def._x, 0, def._width, def._height),
			}));
		}
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	/**
	 * Emit a sequence of instructions as a branch, returning entry/exit IDs.
	 */
	_emitBranch(instructions) {
		if (instructions.length === 0) {
			return { entryId: null, exitId: null };
		}

		let firstId = null;
		let prevExitId = null;
		let pendingArrowInstr = null;
		let prevInstr = null;

		for (const instr of instructions) {
			if (instr.type === InstructionType.ARROW) {
				pendingArrowInstr = instr;
				continue;
			}

			const result = this._emitInstruction(instr);

			if (firstId === null) {
				firstId = result.entryId;
			}

			if (prevExitId !== null && result.entryId !== null) {
				const arrowColor = pendingArrowInstr ? pendingArrowInstr.arrowColor : null;
				const arrowDashed = pendingArrowInstr ? pendingArrowInstr.arrowDashed : false;
				let arrowLabel = pendingArrowInstr ? pendingArrowInstr.arrowLabel : null;
				// Use exit label from while/repeat loops
				if (arrowLabel === null && prevInstr && prevInstr._exitLabel) {
					arrowLabel = prevInstr._exitLabel;
				}
				this._emitEdge(prevExitId, result.entryId, arrowLabel, arrowColor, arrowDashed);
			}

			pendingArrowInstr = null;
			// Only update prev tracking for flow-participating instructions
			if (result.entryId !== null || result.exitId !== null) {
				prevExitId = result.exitId;
				prevInstr = instr;
			}
		}

		return { entryId: firstId, exitId: prevExitId };
	}

	/**
	 * Emit a standard directed edge between two cells.
	 */
	_emitEdge(sourceId, targetId, label, color, dashed) {
		if (sourceId === null || targetId === null) return;
		const id = this.nextId();
		this.cells.push(buildCell({
			id,
			value: label || '',
			style: edgeStyle(color, dashed),
			edge: true,
			source: sourceId,
			target: targetId,
			parent: this.parentId,
		}));
	}

	/**
	 * Emit a loop-back edge (for while/repeat).
	 * Uses orthogonal routing to go around the body via the left side.
	 */
	_emitLoopBack(sourceId, targetId, loopInstr, label) {
		const id = this.nextId();
		// Route via left side: exit from left of source, enter from left of target
		this.cells.push(buildCell({
			id,
			value: label || '',
			style: loopBackEdgeStyle('left', 'left'),
			edge: true,
			source: sourceId,
			target: targetId,
			parent: this.parentId,
		}));
	}
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Emit an ActivityDiagram model as an array of mxCell XML strings.
 * @param {import('./ActivityModel.js').ActivityDiagram} diagram
 * @param {string} parentId
 * @returns {string[]}
 */
export function emitActivityDiagram(diagram, parentId) {
	const emitter = new ActivityEmitter(parentId);
	return emitter.emit(diagram);
}

export { ActivityEmitter };
