/**
 * extract-drawio-xml-timing.js
 *
 * Extracts a NormalizedTimingDiagram from the converter's draw.io XML output.
 *
 * Since we generate the XML, we know the exact style patterns:
 *   - Player labels: text cells with fontStyle=1 and align=right
 *   - Waveform edges: edge cells with endArrow=none
 *   - Concise/rectangle bars: vertex cells with rounded=0 and specific fillColors
 *   - Constraints: edge cells with startArrow=block and endArrow=block
 *   - Messages: edge cells with endArrow=block (not constraints)
 *   - Highlights: vertex cells with opacity=30
 *   - Notes: vertex cells with shape=note
 */

import {
	NPlayer,
	NStateChange,
	NConstraint,
	NMessage,
	NHighlight,
	NNote,
	NormalizedTimingDiagram,
} from './normalize-timing.js';

function parseStyle(styleStr) {
	const result = {};
	if (!styleStr) return result;
	const parts = styleStr.split(';');
	for (const part of parts) {
		const eq = part.indexOf('=');
		if (eq >= 0) {
			result[part.substring(0, eq).trim()] = part.substring(eq + 1).trim();
		} else if (part.trim()) {
			result[part.trim()] = null;
		}
	}
	return result;
}

function unescapeXml(str) {
	if (!str) return '';
	return str
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/<br\s*\/?>/g, '\n')
		.replace(/<[^>]+>/g, '')
		.trim();
}

/**
 * Extract a NormalizedTimingDiagram from draw.io XML text.
 */
export function extractFromDrawioXml(xmlText) {
	const diagram = new NormalizedTimingDiagram();

	// Parse all mxCell elements
	const cellRegex = /<mxCell\s+([^>]*?)\/?>(?:[\s\S]*?<\/mxCell>)?/g;
	let m;

	const playerLabels = [];
	const constraints = [];
	const messages = [];
	const highlights = [];
	const notes = [];
	const conciseBars = [];

	while ((m = cellRegex.exec(xmlText)) !== null) {
		const attrs = m[1];

		// Extract key attributes
		const styleMatch = /style="([^"]*)"/.exec(attrs);
		const valueMatch = /value="([^"]*)"/.exec(attrs);
		const edgeMatch = /edge="1"/.exec(attrs);
		const vertexMatch = /vertex="1"/.exec(attrs);

		const style = styleMatch ? parseStyle(styleMatch[1]) : {};
		const value = valueMatch ? unescapeXml(valueMatch[1]) : '';
		const isEdge = edgeMatch != null;
		const isVertex = vertexMatch != null;

		if (isVertex) {
			// Player labels: text with fontStyle=1 and align=right
			if (style.text !== undefined && style.fontStyle === '1' && style.align === 'right') {
				if (value) playerLabels.push(value);
			}

			// Highlights: large cells with opacity=30
			if (style.opacity === '30' && style.strokeColor === 'none') {
				highlights.push({ caption: value || null });
			}

			// Notes: shape=note
			if (style.shape === 'note') {
				notes.push(new NNote(value));
			}

			// Concise/rectangle bars: rounded=0 with specific colors
			if (style.rounded === '0' && style.whiteSpace === 'wrap' && value) {
				conciseBars.push(value);
			}
		}

		if (isEdge) {
			// Constraints: both startArrow=block and endArrow=block
			if (style.startArrow === 'block' && style.endArrow === 'block') {
				const c = new NConstraint(0, 0);
				c.label = value || null;
				constraints.push(c);
			}
			// Messages: endArrow=block but NOT startArrow=block, and has a value
			else if (style.endArrow === 'block' && style.startArrow == null && value) {
				const msg = new NMessage('', '');
				msg.label = value;
				messages.push(msg);
			}
		}
	}

	// Build players from labels
	for (const name of playerLabels) {
		const player = new NPlayer(name, 'unknown');
		// Count state changes from concise bars that might belong to this player
		diagram.players.push(player);
	}

	diagram.constraints = constraints;
	diagram.messages = messages;
	diagram.highlights = highlights.map(h => {
		const hl = new NHighlight(0, 0);
		hl.caption = h.caption;
		return hl;
	});
	diagram.notes = notes;

	return diagram;
}
