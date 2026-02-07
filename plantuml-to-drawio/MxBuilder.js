/**
 * MxBuilder.js
 * Utilities for generating draw.io (mxGraph) XML from PlantUML diagrams.
 * This module provides pure functions to construct mxGraph XML elements.
 */

/**
 * Escapes special XML characters in strings for safe use in XML attributes and text content.
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for XML
 */
export function xmlEscape(str) {
  if (typeof str !== 'string') {
    return str;
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Converts a style object into a draw.io style string.
 * @param {Object} styleMap - Object with style properties (e.g., { shape: 'mxgraph.flowchart.process', strokeColor: '#333' })
 * @returns {string} Draw.io style string like "shape=mxgraph.flowchart.process;strokeColor=#333;"
 */
export function buildStyle(styleMap) {
  if (!styleMap || typeof styleMap !== 'object') {
    return '';
  }
  return Object.entries(styleMap)
    .map(([key, value]) => `${key}=${value}`)
    .join(';') + (Object.keys(styleMap).length > 0 ? ';' : '');
}

/**
 * Generates an mxCell XML element.
 * @param {Object} options - Configuration object
 * @param {string} options.id - Unique cell identifier (required)
 * @param {string} [options.value] - Cell label text
 * @param {string} [options.style] - Draw.io style string
 * @param {boolean} [options.vertex=false] - Whether this is a vertex (node)
 * @param {boolean} [options.edge=false] - Whether this is an edge (connection)
 * @param {string} [options.parent="1"] - Parent cell ID
 * @param {string} [options.source] - Source cell ID (for edges)
 * @param {string} [options.target] - Target cell ID (for edges)
 * @param {Object} [options.geometry] - Geometry configuration
 * @param {number} [options.geometry.x] - X coordinate
 * @param {number} [options.geometry.y] - Y coordinate
 * @param {number} [options.geometry.width] - Width
 * @param {number} [options.geometry.height] - Height
 * @param {boolean} [options.geometry.relative] - Whether geometry is relative (for edges)
 * @param {Object} [options.sourcePoint] - Source point {x,y} for freestanding edges
 * @param {Object} [options.targetPoint] - Target point {x,y} for freestanding edges
 * @param {Array<{x: number, y: number}>} [options.waypoints] - Intermediate waypoints for edge routing
 * @returns {string} XML string for the mxCell element
 */
export function buildCell({
  id,
  value = '',
  style = '',
  vertex = false,
  edge = false,
  parent = '1',
  source = undefined,
  target = undefined,
  geometry = undefined,
  sourcePoint = undefined,
  targetPoint = undefined,
  waypoints = undefined,
}) {
  if (!id) {
    throw new Error('Cell id is required');
  }

  const escapedValue = xmlEscape(value);
  const escapedStyle = xmlEscape(style);

  // Build attributes
  const attrs = [
    `id="${id}"`,
  ];

  if (escapedValue) {
    attrs.push(`value="${escapedValue}"`);
  }

  if (escapedStyle) {
    attrs.push(`style="${escapedStyle}"`);
  }

  if (vertex) {
    attrs.push('vertex="1"');
  }

  if (edge) {
    attrs.push('edge="1"');
  }

  if (parent) {
    attrs.push(`parent="${parent}"`);
  }

  if (source) {
    attrs.push(`source="${xmlEscape(source)}"`);
  }

  if (target) {
    attrs.push(`target="${xmlEscape(target)}"`);
  }

  // Build geometry element
  let geometryXml = '';

  if (edge && (sourcePoint || targetPoint)) {
    // Freestanding edge: use sourcePoint/targetPoint with optional waypoints
    const innerParts = [];

    if (sourcePoint) {
      innerParts.push(`    <mxPoint x="${sourcePoint.x}" y="${sourcePoint.y}" as="sourcePoint"/>`);
    }
    if (targetPoint) {
      innerParts.push(`    <mxPoint x="${targetPoint.x}" y="${targetPoint.y}" as="targetPoint"/>`);
    }
    if (waypoints && waypoints.length > 0) {
      const wpXml = waypoints
        .map((p) => `      <mxPoint x="${p.x}" y="${p.y}"/>`)
        .join('\n');
      innerParts.push(`    <Array as="points">\n${wpXml}\n    </Array>`);
    }

    geometryXml = `
    <mxGeometry relative="1" as="geometry">
${innerParts.join('\n')}
    </mxGeometry>`;
  } else if (geometry) {
    // Vertex geometry
    const geoAttrs = [];
    if (geometry.x !== undefined) geoAttrs.push(`x="${geometry.x}"`);
    if (geometry.y !== undefined) geoAttrs.push(`y="${geometry.y}"`);
    if (geometry.width !== undefined) geoAttrs.push(`width="${geometry.width}"`);
    if (geometry.height !== undefined) geoAttrs.push(`height="${geometry.height}"`);
    if (geometry.relative) geoAttrs.push('relative="1"');

    geometryXml = `
    <mxGeometry ${geoAttrs.join(' ')} as="geometry"/>`;
  }

  return `<mxCell ${attrs.join(' ')}>${geometryXml}
</mxCell>`;
}

/**
 * Builds the UserObject group cell that stores the PlantUML source.
 * The UserObject wraps ONLY the group's own mxCell. Child cells are
 * emitted as siblings in the XML tree, referencing this group's id
 * via their parent attribute.
 *
 * @param {Object} options - Configuration object
 * @param {string} options.id - Group cell identifier
 * @param {string} options.plantUml - Original PlantUML source code
 * @param {string} options.children - XML string of child cells (emitted as siblings)
 * @param {number} [options.width=100] - Group bounding box width
 * @param {number} [options.height=100] - Group bounding box height
 * @returns {string} XML string: the UserObject element followed by child cells
 */
export function buildUserObject({
  id,
  plantUml,
  children,
  width = 100,
  height = 100,
}) {
  if (!id) {
    throw new Error('UserObject id is required');
  }
  if (!plantUml) {
    throw new Error('UserObject plantUml is required');
  }

  // Escape newlines in PlantUML for XML attribute
  const escapedPlantUml = xmlEscape(plantUml);

  // UserObject wraps only the group cell definition.
  // Children are siblings that reference this id as parent.
  return `<UserObject label="" plantUml="${escapedPlantUml}" id="${id}">
  <mxCell style="group;editable=0;connectable=0;" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="${width}" height="${height}" as="geometry"/>
  </mxCell>
</UserObject>
${children}`;
}

/**
 * Wraps cells in the complete draw.io document structure.
 * @param {string} cells - XML string of all mxCell elements
 * @returns {string} Complete mxfile XML document
 */
export function buildDocument(cells) {
  return `<mxfile>
  <diagram name="PlantUML Import">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

/**
 * Creates an ID generator function that produces sequential IDs with a given prefix.
 * @param {string} [prefix="puml"] - Prefix for generated IDs
 * @returns {function} Function that generates sequential IDs like "puml-1", "puml-2", etc.
 */
export function createIdGenerator(prefix = 'puml') {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

/**
 * Helper function to create a geometry object with the standard properties.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} width - Element width
 * @param {number} height - Element height
 * @returns {Object} Geometry object with x, y, width, height properties
 */
export function geom(x, y, width, height) {
  return { x, y, width, height };
}

// ── Color utilities ───────────────────────────────────────────────────────

/**
 * Map of common CSS/PlantUML named colors to hex values.
 * PlantUML uses CSS color names (case-insensitive) with a '#' prefix.
 */
const NAMED_COLORS = {
	aliceblue: '#F0F8FF', antiquewhite: '#FAEBD7', aqua: '#00FFFF',
	aquamarine: '#7FFFD4', azure: '#F0FFFF', beige: '#F5F5DC',
	bisque: '#FFE4C4', black: '#000000', blanchedalmond: '#FFEBCD',
	blue: '#0000FF', blueviolet: '#8A2BE2', brown: '#A52A2A',
	burlywood: '#DEB887', cadetblue: '#5F9EA0', chartreuse: '#7FFF00',
	chocolate: '#D2691E', coral: '#FF7F50', cornflowerblue: '#6495ED',
	cornsilk: '#FFF8DC', crimson: '#DC143C', cyan: '#00FFFF',
	darkblue: '#00008B', darkcyan: '#008B8B', darkgoldenrod: '#B8860B',
	darkgray: '#A9A9A9', darkgreen: '#006400', darkgrey: '#A9A9A9',
	darkkhaki: '#BDB76B', darkmagenta: '#8B008B', darkolivegreen: '#556B2F',
	darkorange: '#FF8C00', darkorchid: '#9932CC', darkred: '#8B0000',
	darksalmon: '#E9967A', darkseagreen: '#8FBC8F', darkslateblue: '#483D8B',
	darkslategray: '#2F4F4F', darkslategrey: '#2F4F4F', darkturquoise: '#00CED1',
	darkviolet: '#9400D3', deeppink: '#FF1493', deepskyblue: '#00BFFF',
	dimgray: '#696969', dimgrey: '#696969', dodgerblue: '#1E90FF',
	firebrick: '#B22222', floralwhite: '#FFFAF0', forestgreen: '#228B22',
	fuchsia: '#FF00FF', gainsboro: '#DCDCDC', ghostwhite: '#F8F8FF',
	gold: '#FFD700', goldenrod: '#DAA520', gray: '#808080',
	green: '#008000', greenyellow: '#ADFF2F', grey: '#808080',
	honeydew: '#F0FFF0', hotpink: '#FF69B4', indianred: '#CD5C5C',
	indigo: '#4B0082', ivory: '#FFFFF0', khaki: '#F0E68C',
	lavender: '#E6E6FA', lavenderblush: '#FFF0F5', lawngreen: '#7CFC00',
	lemonchiffon: '#FFFACD', lightblue: '#ADD8E6', lightcoral: '#F08080',
	lightcyan: '#E0FFFF', lightgoldenrodyellow: '#FAFAD2', lightgray: '#D3D3D3',
	lightgreen: '#90EE90', lightgrey: '#D3D3D3', lightpink: '#FFB6C1',
	lightsalmon: '#FFA07A', lightseagreen: '#20B2AA', lightskyblue: '#87CEFA',
	lightslategray: '#778899', lightslategrey: '#778899', lightsteelblue: '#B0C4DE',
	lightyellow: '#FFFFE0', lime: '#00FF00', limegreen: '#32CD32',
	linen: '#FAF0E6', magenta: '#FF00FF', maroon: '#800000',
	mediumaquamarine: '#66CDAA', mediumblue: '#0000CD', mediumorchid: '#BA55D3',
	mediumpurple: '#9370DB', mediumseagreen: '#3CB371', mediumslateblue: '#7B68EE',
	mediumspringgreen: '#00FA9A', mediumturquoise: '#48D1CC', mediumvioletred: '#C71585',
	midnightblue: '#191970', mintcream: '#F5FFFA', mistyrose: '#FFE4E1',
	moccasin: '#FFE4B5', navajowhite: '#FFDEAD', navy: '#000080',
	oldlace: '#FDF5E6', olive: '#808000', olivedrab: '#6B8E23',
	orange: '#FFA500', orangered: '#FF4500', orchid: '#DA70D6',
	palegoldenrod: '#EEE8AA', palegreen: '#98FB98', paleturquoise: '#AFEEEE',
	palevioletred: '#DB7093', papayawhip: '#FFEFD5', peachpuff: '#FFDAB9',
	peru: '#CD853F', pink: '#FFC0CB', plum: '#DDA0DD',
	powderblue: '#B0E0E6', purple: '#800080', rebeccapurple: '#663399',
	red: '#FF0000', rosybrown: '#BC8F8F', royalblue: '#4169E1',
	saddlebrown: '#8B4513', salmon: '#FA8072', sandybrown: '#F4A460',
	seagreen: '#2E8B57', seashell: '#FFF5EE', sienna: '#A0522D',
	silver: '#C0C0C0', skyblue: '#87CEEB', slateblue: '#6A5ACD',
	slategray: '#708090', slategrey: '#708090', snow: '#FFFAFA',
	springgreen: '#00FF7F', steelblue: '#4682B4', tan: '#D2B48C',
	teal: '#008080', thistle: '#D8BFD8', tomato: '#FF6347',
	turquoise: '#40E0D0', violet: '#EE82EE', wheat: '#F5DEB3',
	white: '#FFFFFF', whitesmoke: '#F5F5F5', yellow: '#FFFF00',
	yellowgreen: '#9ACD32'
};

/**
 * Normalize a PlantUML color to a hex value that draw.io understands.
 * PlantUML accepts:  #LightBlue, #red, #FF0000, #AABBCC
 * draw.io requires:  #FF0000, #AABBCC (hex only)
 *
 * @param {string} color - Color string, typically with '#' prefix
 * @returns {string} Hex color string (e.g. '#ADD8E6')
 */
export function normalizeColor(color) {
	if (!color) return color;

	// Strip leading '#' for lookup
	const raw = color.startsWith('#') ? color.slice(1) : color;

	// If it's already a valid hex color (3, 6, or 8 hex digits), return as-is
	if (/^[0-9A-Fa-f]{3}$|^[0-9A-Fa-f]{6}$|^[0-9A-Fa-f]{8}$/.test(raw)) {
		return '#' + raw.toUpperCase();
	}

	// Look up named color (case-insensitive)
	const hex = NAMED_COLORS[raw.toLowerCase()];
	if (hex) return hex;

	// Unknown — return as-is (let draw.io try to handle it)
	return color;
}
