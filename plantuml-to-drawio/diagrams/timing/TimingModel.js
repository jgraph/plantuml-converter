/**
 * TimingModel.js
 *
 * Data model for PlantUML timing diagrams.
 *
 * Timing diagrams display state changes over a shared horizontal time axis.
 * Players are stacked vertically, each showing their own waveform.
 *
 * Times are stored as resolved numbers. The parser resolves relative offsets
 * (+10) to absolute values using a running currentTime tracker.
 */

// ── Enums ────────────────────────────────────────────────────────────────────

const PlayerType = Object.freeze({
	ROBUST:    'robust',
	CONCISE:   'concise',
	CLOCK:     'clock',
	BINARY:    'binary',
	ANALOG:    'analog',
	RECTANGLE: 'rectangle',
});

const NotePosition = Object.freeze({
	TOP:    'top',
	BOTTOM: 'bottom',
});

// ── Model Classes ────────────────────────────────────────────────────────────

class TimingPlayer {
	constructor(code, displayName, type) {
		this.code = code;
		this.displayName = displayName || code;
		this.type = type;
		this.compact = false;
		this.color = null;
		this.stereotype = null;
		this.states = [];               // declared state names (for robust/concise)
		this.stateAliases = new Map();  // code → display label
		this.stateChanges = [];         // StateChange[] (ordered by time)
		// Clock-specific
		this.clockPeriod = null;
		this.clockPulse = null;
		this.clockOffset = null;
		// Analog-specific
		this.analogStart = null;
		this.analogEnd = null;
	}
}

class StateChange {
	constructor(time, state) {
		this.time = time;        // numeric (resolved absolute)
		this.state = state;      // string state name or numeric value
		this.comment = null;     // optional : comment text
		this.color = null;       // optional state background color
	}
}

class TimeConstraint {
	constructor(time1, time2) {
		this.playerCode = null;  // optional player context
		this.time1 = time1;      // numeric
		this.time2 = time2;      // numeric
		this.label = null;
	}
}

class TimeMessage {
	constructor(fromPlayer, fromTime, toPlayer, toTime) {
		this.fromPlayer = fromPlayer;   // player code
		this.fromTime = fromTime;       // numeric
		this.toPlayer = toPlayer;       // player code
		this.toTime = toTime;           // numeric
		this.label = null;
		this.style = null;              // arrow style string
	}
}

class TimingHighlight {
	constructor(startTime, endTime) {
		this.startTime = startTime;  // numeric
		this.endTime = endTime;      // numeric
		this.color = null;
		this.caption = null;
	}
}

class TimingNote {
	constructor(position, playerCode, text) {
		this.position = position;     // NotePosition
		this.playerCode = playerCode; // player code
		this.text = text;
		this.color = null;
	}
}

class TimingDiagram {
	constructor() {
		this.title = null;
		this.players = [];           // TimingPlayer[] (ordered)
		this.constraints = [];       // TimeConstraint[]
		this.messages = [];          // TimeMessage[]
		this.highlights = [];        // TimingHighlight[]
		this.notes = [];             // TimingNote[]
		this.hideTimeAxis = false;
		this.compactMode = false;    // global compact
		this.timeAliases = new Map(); // name → numeric time
	}

	getPlayer(code) {
		return this.players.find(p => p.code === code) || null;
	}

	getOrCreatePlayer(code, displayName, type) {
		const existing = this.getPlayer(code);
		if (existing) {
			if (displayName && existing.displayName === existing.code) {
				existing.displayName = displayName;
			}
			return existing;
		}
		const player = new TimingPlayer(code, displayName, type);
		this.players.push(player);
		return player;
	}

	hasPlayer(code) {
		return this.players.some(p => p.code === code);
	}

	addConstraint(constraint) {
		this.constraints.push(constraint);
	}

	addMessage(message) {
		this.messages.push(message);
	}

	addHighlight(highlight) {
		this.highlights.push(highlight);
	}

	addNote(note) {
		this.notes.push(note);
	}
}

// ── Exports ──────────────────────────────────────────────────────────────────

export {
	PlayerType,
	NotePosition,
	TimingPlayer,
	StateChange,
	TimeConstraint,
	TimeMessage,
	TimingHighlight,
	TimingNote,
	TimingDiagram,
};
