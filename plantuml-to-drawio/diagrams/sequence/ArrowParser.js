/**
 * ArrowParser.js - Parses PlantUML arrow syntax from sequence diagrams
 *
 * Converts arrow strings like "->", "-->", "->>", "o->o", etc. into
 * structured ArrowConfig objects compatible with draw.io representation.
 *
 * @module ArrowParser
 */

import {
  ArrowHead,
  ArrowBody,
  ArrowPart,
  ArrowDecoration,
  ArrowConfig
} from './SequenceModel.js';

/**
 * Parse a PlantUML arrow string into an ArrowConfig.
 *
 * PlantUML arrow syntax:
 * [left_decoration] [left_dressing] body [right_dressing] [right_decoration] [style]
 *
 * Decorations: o (circle), x (cross)
 * Dressings: <, <<, >, >>, /, //, \, \\
 * Body: - (solid) or -- (dotted, 2+ dashes)
 * Style: [#color], [dashed], [bold], [hidden], [dotted]
 *
 * @param {string} arrowStr - The arrow portion, e.g. "->", "-->", "->>", "o->", "<->", "-[#red]>"
 * @returns {ArrowConfig} Parsed arrow configuration
 *
 * @example
 * parseArrow("->")        // head1=NONE, head2=NORMAL, body=NORMAL
 * parseArrow("-->")       // head1=NONE, head2=NORMAL, body=DOTTED
 * parseArrow("o->o")      // head1=NONE (with CIRCLE decor), head2=NORMAL (with CIRCLE decor), body=NORMAL
 * parseArrow("<->")       // head1=NORMAL, head2=NORMAL, body=NORMAL (bidirectional)
 * parseArrow("-[#red]>")  // head2=NORMAL, body=NORMAL, color=#red
 */
export function parseArrow(arrowStr) {
  // Start with defaults
  const config = new ArrowConfig();

  if (!arrowStr || typeof arrowStr !== 'string') {
    return config;
  }

  const arrow = arrowStr.trim();
  if (arrow.length === 0) {
    return config;
  }

  // Extract style modifiers (e.g., [#red], [dashed])
  const styleMatch = arrow.match(/\[([^\]]+)\]/);
  const styleInfo = styleMatch ? parseStyle(styleMatch[1]) : {};

  // Remove style modifiers for further parsing
  const arrowWithoutStyle = arrow.replace(/\[[^\]]+\]/g, '');

  // Parse the arrow structure
  const parsed = parseArrowStructure(arrowWithoutStyle);

  // Build the config
  config.head1 = parsed.head1;
  config.head2 = parsed.head2;
  config.body = parsed.body;
  config.part = parsed.part;
  config.decoration1 = parsed.decoration1 || ArrowDecoration.NONE;
  config.decoration2 = parsed.decoration2 || ArrowDecoration.NONE;

  // Apply style modifiers
  if (styleInfo.color) {
    config.color = styleInfo.color;
  }
  if (styleInfo.lineStyle) {
    config.lineStyle = styleInfo.lineStyle;
    // Override body style if dotted/dashed is explicitly specified
    if (styleInfo.lineStyle === 'dashed' || styleInfo.lineStyle === 'dotted') {
      config.body = ArrowBody.DOTTED;
    }
  }

  return config;
}

/**
 * Parse the arrow structure (without style modifiers).
 * Returns an object with head1, head2, body, part, direction, decoration1, decoration2.
 *
 * @private
 * @param {string} arrowStr - Arrow string without style modifiers
 * @returns {Object} Parsed arrow structure
 */
function parseArrowStructure(arrowStr) {
  const result = {
    head1: ArrowHead.NONE,
    head2: ArrowHead.NONE,
    body: ArrowBody.NORMAL,
    part: ArrowPart.FULL,
    direction: 'normal',
    decoration1: null,
    decoration2: null
  };

  if (arrowStr.length === 0) {
    return result;
  }

  let leftIdx = 0;
  let rightIdx = arrowStr.length - 1;

  // Extract left decoration (o or x)
  if (arrowStr[leftIdx] === 'o') {
    result.decoration1 = ArrowDecoration.CIRCLE;
    leftIdx++;
  } else if (arrowStr[leftIdx] === 'x') {
    result.head1 = ArrowHead.CROSSX;
    leftIdx++;
  }

  // Extract right decoration (o or x)
  if (arrowStr[rightIdx] === 'o') {
    result.decoration2 = ArrowDecoration.CIRCLE;
    rightIdx--;
  } else if (arrowStr[rightIdx] === 'x') {
    result.head2 = ArrowHead.CROSSX;
    rightIdx--;
  }

  // Now extract left dressing, body, and right dressing
  // The remaining string should be: [left_dressing] body [right_dressing]
  // where body is one or more dashes, and dressings are <, <<, >, >>, /, //, \, \\

  let bodyStart = leftIdx;
  let bodyEnd = rightIdx;

  // Parse left dressing
  const leftDressing = extractLeftDressing(arrowStr, leftIdx);
  if (leftDressing.length > 0) {
    bodyStart = leftIdx + leftDressing.length;
  }

  // Parse right dressing
  const rightDressing = extractRightDressing(arrowStr, rightIdx);
  if (rightDressing.length > 0) {
    bodyEnd = rightIdx - rightDressing.length;
  }

  // Extract body (dashes between left and right dressings)
  const body = arrowStr.substring(bodyStart, bodyEnd + 1);

  // Determine if body is dotted (2+ dashes)
  const dashCount = (body.match(/-/g) || []).length;
  if (dashCount >= 2) {
    result.body = ArrowBody.DOTTED;
  } else {
    result.body = ArrowBody.NORMAL;
  }

  // Determine direction and arrowheads based on dressings
  const hasLeftDir = isDirectionChar(leftDressing);
  const hasRightDir = isDirectionChar(rightDressing);

  if (hasRightDir && !hasLeftDir) {
    // Normal direction: left to right
    result.direction = 'normal';
    // Only set head from dressing if not already set by decoration (e.g. x)
    if (result.head2 === ArrowHead.NONE) {
      result.head2 = getHeadTypeFromDressing(rightDressing);
    }
    result.part = getPartFromDressing(rightDressing, true);
  } else if (hasLeftDir && !hasRightDir) {
    // Reverse direction: right to left
    result.direction = 'reverse';
    if (result.head1 === ArrowHead.NONE) {
      result.head1 = getHeadTypeFromDressing(leftDressing);
    }
    result.part = getPartFromDressing(leftDressing, false);
  } else if (hasLeftDir && hasRightDir) {
    // Bidirectional
    result.direction = 'bidirectional';
    if (result.head1 === ArrowHead.NONE) {
      result.head1 = getHeadTypeFromDressing(leftDressing);
    }
    if (result.head2 === ArrowHead.NONE) {
      result.head2 = getHeadTypeFromDressing(rightDressing);
    }
    result.part = getPartFromDressing(rightDressing, true);
  }

  return result;
}

/**
 * Extract the left dressing portion from the arrow string.
 * Left dressings are: <, <<, /, //, \, \\
 *
 * @private
 * @param {string} arrowStr - The arrow string
 * @param {number} startIdx - Starting index to search from
 * @returns {string} The left dressing (empty string if none found)
 */
function extractLeftDressing(arrowStr, startIdx) {
  if (startIdx >= arrowStr.length) {
    return '';
  }

  const char = arrowStr[startIdx];

  // Check for double-character dressings first
  if (startIdx + 1 < arrowStr.length) {
    const twoChar = arrowStr.substring(startIdx, startIdx + 2);
    if (['<<', '//', '\\\\'].includes(twoChar)) {
      return twoChar;
    }
  }

  // Single character dressings
  if (['<', '/', '\\'].includes(char)) {
    return char;
  }

  return '';
}

/**
 * Extract the right dressing portion from the arrow string.
 * Right dressings are: >, >>, /, //, \, \\
 *
 * @private
 * @param {string} arrowStr - The arrow string
 * @param {number} endIdx - Ending index to search from (inclusive)
 * @returns {string} The right dressing (empty string if none found)
 */
function extractRightDressing(arrowStr, endIdx) {
  if (endIdx < 0) {
    return '';
  }

  const char = arrowStr[endIdx];

  // Check for double-character dressings first
  if (endIdx - 1 >= 0) {
    const twoChar = arrowStr.substring(endIdx - 1, endIdx + 1);
    if (['>>', '//', '\\\\'].includes(twoChar)) {
      return twoChar;
    }
  }

  // Single character dressings
  if (['>', '/', '\\'].includes(char)) {
    return char;
  }

  return '';
}

/**
 * Check if a dressing string contains direction characters.
 * Direction characters are: <, >, /, \
 *
 * @private
 * @param {string} dressing - The dressing string
 * @returns {boolean} True if contains direction characters
 */
function isDirectionChar(dressing) {
  return /[<>\/\\]/.test(dressing);
}

/**
 * Get the ArrowHead type from a dressing string.
 * Single char (> or <) → NORMAL
 * Double char (>> or <<) → ASYNC
 * / or // → NORMAL (used with direction)
 * \ or \\ → NORMAL (used with direction)
 *
 * @private
 * @param {string} dressing - The dressing string
 * @returns {ArrowHead} The arrow head type
 */
function getHeadTypeFromDressing(dressing) {
  if (!dressing || dressing.length === 0) {
    return ArrowHead.NONE;
  }

  // Double-character dressings → ASYNC
  if (dressing.length >= 2 && (dressing === '<<' || dressing === '>>')) {
    return ArrowHead.ASYNC;
  }

  // Single character dressings or slashes → NORMAL
  if (dressing === '<' || dressing === '>' || dressing === '/' || dressing === '\\') {
    return ArrowHead.NORMAL;
  }

  // Double slashes → NORMAL
  if (dressing === '//' || dressing === '\\\\') {
    return ArrowHead.NORMAL;
  }

  return ArrowHead.NONE;
}

/**
 * Determine the arrow part from a dressing string.
 * / or // on right (isRight=true) → BOTTOM_PART
 * \ or \\ on right (isRight=true) → TOP_PART
 * \ or \\ on left (isRight=false) → BOTTOM_PART
 * / or // on left (isRight=false) → TOP_PART
 *
 * @private
 * @param {string} dressing - The dressing string
 * @param {boolean} isRight - True if this is the right dressing, false if left
 * @returns {ArrowPart} The arrow part type
 */
function getPartFromDressing(dressing, isRight) {
  if (!dressing || !isDirectionChar(dressing)) {
    return ArrowPart.FULL;
  }

  const hasSlash = dressing.includes('/');
  const hasBackslash = dressing.includes('\\');

  if (isRight) {
    // Right side
    if (hasBackslash) {
      return ArrowPart.TOP_PART;
    } else if (hasSlash) {
      return ArrowPart.BOTTOM_PART;
    }
  } else {
    // Left side
    if (hasBackslash) {
      return ArrowPart.BOTTOM_PART;
    } else if (hasSlash) {
      return ArrowPart.TOP_PART;
    }
  }

  return ArrowPart.FULL;
}

/**
 * Parse style modifiers from the [style] portion of an arrow.
 * Supported formats: [#color], [dashed], [bold], [hidden], [dotted]
 *
 * @param {string} styleStr - The style string without brackets, e.g. "#red" or "dashed"
 * @returns {Object} Object with color and lineStyle properties
 *
 * @example
 * parseStyle("#red")         // { color: '#red', lineStyle: null }
 * parseStyle("dashed")       // { color: null, lineStyle: 'dashed' }
 * parseStyle("#FF0000bold")  // { color: '#FF0000', lineStyle: 'bold' }
 */
export function parseStyle(styleStr) {
  const result = {
    color: null,
    lineStyle: null
  };

  if (!styleStr || typeof styleStr !== 'string') {
    return result;
  }

  const style = styleStr.trim();

  // Extract color (starts with #)
  const colorMatch = style.match(/#[0-9A-Fa-f]{3,6}|#\w+/);
  if (colorMatch) {
    result.color = colorMatch[0];
  }

  // Extract line style
  if (style.includes('dashed')) {
    result.lineStyle = 'dashed';
  } else if (style.includes('dotted')) {
    result.lineStyle = 'dotted';
  } else if (style.includes('bold')) {
    result.lineStyle = 'bold';
  }
  // Note: 'hidden' could be handled separately if needed

  return result;
}

/**
 * Validate and normalize an arrow string.
 * Returns true if the arrow string appears to be valid PlantUML syntax.
 *
 * @param {string} arrowStr - The arrow string to validate
 * @returns {boolean} True if valid
 *
 * @example
 * isValidArrowString("->")   // true
 * isValidArrowString("foo")  // false
 */
export function isValidArrowString(arrowStr) {
  if (!arrowStr || typeof arrowStr !== 'string') {
    return false;
  }

  // Must contain at least one dash
  if (!arrowStr.includes('-')) {
    return false;
  }

  // Remove style modifiers
  const arrowWithoutStyle = arrowStr.replace(/\[[^\]]+\]/g, '');

  // Check for valid characters only
  const validChars = /^[ox<>\/\\-]+$/;
  return validChars.test(arrowWithoutStyle);
}
