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
