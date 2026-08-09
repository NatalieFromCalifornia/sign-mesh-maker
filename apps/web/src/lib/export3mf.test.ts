import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  build3mf,
  buildModelSettings,
  buildModelXml,
  buildProjectSettings,
  threeMfFilename,
  type ExportPart,
} from './export3mf';

/** One unit triangle, offset so parts can be told apart. */
function part(color: string, name: string, shift = 0): ExportPart {
  return {
    color,
    name,
    positions: new Float32Array([
      shift, 0, 0,
      shift + 1, 0, 0,
      shift, 1, 2,
    ]),
  };
}

const PARTS = [part('#2f9d8f', 'teal'), part('#f2681c', 'orange', 5)];

describe('build3mf', () => {
  it('produces an OPC package with the three files a 3MF needs', () => {
    const files = unzipSync(build3mf(PARTS));

    expect(Object.keys(files).sort()).toEqual([
      '3D/3dmodel.model',
      'Metadata/model_settings.config',
      'Metadata/project_settings.config',
      '[Content_Types].xml',
      '_rels/.rels',
    ]);
  });

  it('declares the model content type and relationship', () => {
    const files = unzipSync(build3mf(PARTS));

    expect(strFromU8(files['[Content_Types].xml'])).toContain(
      '3dmanufacturing-3dmodel+xml',
    );
    expect(strFromU8(files['_rels/.rels'])).toContain('/3D/3dmodel.model');
  });

  it('compresses a realistically sized model', () => {
    /*
     * Measured on a real-sized mesh: for a two-triangle toy the zip's own file
     * headers cost more than deflate saves, so a tiny fixture would prove the
     * opposite of what matters.
     */
    const many: ExportPart = {
      color: '#2f9d8f',
      name: 'many',
      positions: new Float32Array(
        Array.from({ length: 3000 * 3 }, (_, i) => (i % 97) * 0.37),
      ),
    };

    const raw = buildModelXml([many]).length;
    expect(build3mf([many]).byteLength).toBeLessThan(raw / 2);
  });
});

describe('buildModelXml', () => {
  it('declares millimetres, so a slicer does not guess the scale', () => {
    expect(buildModelXml(PARTS)).toContain('unit="millimeter"');
  });

  /*
   * A colorgroup from the Materials extension, not core basematerials. Slicers
   * read the former; a file carrying only the latter opened uniformly grey and
   * then took whatever the filament slots were already set to.
   */
  it('carries colour in a materials-extension colorgroup', () => {
    const xml = buildModelXml(PARTS);
    expect(xml).toContain('xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"');
    expect(xml).toContain('<m:colorgroup id="1">');
    expect(xml).toContain('<m:color color="#2F9D8FFF"/>');
    expect(xml).toContain('<m:color color="#F2681CFF"/>');
    expect(xml).not.toContain('<basematerials');
  });

  it('gives every part an object bound to its material', () => {
    const xml = buildModelXml(PARTS);
    expect(xml.match(/<object id="\d+" type="model" pid="1"/g)).toHaveLength(2);
    expect(xml).toContain('pindex="0"');
    expect(xml).toContain('pindex="1"');
  });

  it('assembles the parts into one build item', () => {
    /*
     * The whole point over per-colour STL: the sign arrives as one thing whose
     * parts are already in the right places, rather than several that must be
     * re-associated on import.
     */
    const xml = buildModelXml(PARTS);
    expect(xml.match(/<item objectid="\d+"\/>/g)).toHaveLength(1);
    expect(xml.match(/<component objectid="\d+"\/>/g)).toHaveLength(2);
  });

  it('emits one triangle per three vertices, in order', () => {
    const xml = buildModelXml([part('#ffffff', 'one')]);
    expect(xml).toContain('<triangle v1="0" v2="1" v3="2"/>');
  });

  it('shifts the model into the positive octant', () => {
    // 3MF expects the build volume in positive coordinates, and the mesh is
    // centred on the origin for the preview.
    const centred: ExportPart = {
      color: '#ffffff',
      name: 'centred',
      positions: new Float32Array([-10, -4, 0, 10, -4, 0, 0, 4, 3]),
    };

    const coords = [...buildModelXml([centred]).matchAll(/(?:x|y|z)="(-?[\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(Math.min(...coords)).toBeGreaterThanOrEqual(0);
  });

  it('preserves relative placement between parts after the shift', () => {
    const xml = buildModelXml(PARTS);
    const xs = [...xml.matchAll(/<vertex x="(-?[\d.]+)"/g)].map((m) => Number(m[1]));

    // The second part sits 5mm along from the first; that gap must survive.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6, 3);
  });

  it('keeps user-supplied text out of the model entirely', () => {
    // Names live in model_settings.config now, so the model carries only
    // colours and numbers and has nothing a layer name could break.
    const xml = buildModelXml([{ ...part('#ffffff', 'x'), name: 'a & b <c>' }]);
    expect(xml).not.toContain('a & b <c>');
    expect(xml).not.toContain('a &amp; b');
  });

  it('expands shorthand hex colours', () => {
    expect(buildModelXml([part('#fff', 'short')])).toContain('<m:color color="#FFFFFFFF"/>');
  });
});

describe('threeMfFilename', () => {
  it('swaps an stl extension for 3mf', () => {
    expect(threeMfFilename('woman-in-bathtub.stl')).toBe('woman-in-bathtub.3mf');
  });

  it('appends when there is no stl extension', () => {
    expect(threeMfFilename('sign')).toBe('sign.3mf');
  });
});

describe('buildModelSettings', () => {
  /*
   * Core basematerials alone opened as one uniform grey solid: a slicer takes
   * colour from the filament, not the mesh, so each part has to name a slot.
   */
  it('binds each part to its own 1-based filament slot', () => {
    const config = buildModelSettings(PARTS);
    expect(config).toContain('<metadata key="extruder" value="1"/>');
    expect(config).toContain('<metadata key="extruder" value="2"/>');
    expect(config.match(/subtype="normal_part"/g)).toHaveLength(2);
  });

  it('gives every layer its own slot, however many there are', () => {
    /*
     * Previously clamped to an assumed printer capacity, which threw away
     * colours the slicer was perfectly willing to hold — Orca lets filaments
     * be added freely, and the filament list written alongside declares
     * exactly this many.
     */
    const ten = Array.from({ length: 10 }, (_, i) => part('#ffffff', `p${i}`, i));
    const assigned = [...buildModelSettings(ten).matchAll(/key="extruder" value="(\d+)"/g)].map(
      (m) => Number(m[1]),
    );

    expect(assigned).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });



  it('uses part ids that match the components in the model', () => {
    // The two files line up by construction, or the assignments attach to
    // nothing.
    const model = buildModelXml(PARTS);
    const config = buildModelSettings(PARTS);

    const componentIds = [...model.matchAll(/<component objectid="(\d+)"\/>/g)].map((m) => m[1]);
    const partIds = [...config.matchAll(/<part id="(\d+)"/g)].map((m) => m[1]);
    expect(partIds).toEqual(componentIds);
  });

  it('nests the parts under the assembly object', () => {
    const model = buildModelXml(PARTS);
    const config = buildModelSettings(PARTS);

    const assemblyId = model.match(/<item objectid="(\d+)"\/>/)![1];
    expect(config).toContain(`<object id="${assemblyId}">`);
  });

  it('escapes part names', () => {
    expect(buildModelSettings([{ ...part('#ffffff', 'x'), name: 'a & b' }])).toContain('a &amp; b');
  });
});

describe('content types', () => {
  it('declares the config extension so the package stays valid', () => {
    const files = unzipSync(build3mf(PARTS));
    expect(strFromU8(files['[Content_Types].xml'])).toContain('Extension="config"');
  });
});

describe('buildProjectSettings', () => {
  /*
   * Slot colours are read from here. Without it the parts land on slots that
   * keep whatever colours were already configured, which is how a ten-colour
   * sign arrived wearing somebody else's palette.
   */
  it('declares one filament per layer, carrying its colour', () => {
    const settings = JSON.parse(buildProjectSettings(PARTS));

    expect(settings.filament_colour).toEqual(['#2F9D8F', '#F2681C']);
    expect(settings.filament_type).toEqual(['PLA', 'PLA']);
  });

  it('keeps the arrays the same length, whatever the layer count', () => {
    const ten = Array.from({ length: 10 }, (_, i) => part('#2f9d8f', `p${i}`, i));
    const settings = JSON.parse(buildProjectSettings(ten));

    expect(settings.filament_colour).toHaveLength(10);
    expect(settings.filament_type).toHaveLength(10);
  });

  it('writes six-digit hex, not the eight-digit form the mesh uses', () => {
    const settings = JSON.parse(buildProjectSettings([part('#fff', 'short')]));
    expect(settings.filament_colour).toEqual(['#FFFFFF']);
  });

  it('carries only filament settings, so it cannot override a printer profile', () => {
    // A fuller config would start dictating machine settings that belong to
    // whoever opens the file.
    expect(Object.keys(JSON.parse(buildProjectSettings(PARTS))).sort()).toEqual([
      'filament_colour',
      'filament_type',
    ]);
  });
});

/**
 * 3MF describes a surface through vertex indices, and a slicer reads the
 * topology it is given rather than inferring one.
 *
 * Writing three fresh vertices per triangle declares a mesh in which no two
 * triangles are joined — every edge belongs to one face, which is every edge
 * non-manifold, and the model has to be repaired before it will slice. STL
 * never showed it, because STL is a soup of loose triangles by definition and
 * anything reading one welds by position.
 */
describe('indexed geometry', () => {
  /** A closed box, so a correct writer must produce a closed surface. */
  function box(): ExportPart {
    const corners = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ];
    const faces = [
      [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
      [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    ];
    const positions: number[] = [];
    for (const face of faces) for (const c of face) positions.push(...corners[c]);
    return { color: '#2f9d8f', name: 'box', positions: new Float32Array(positions) };
  }

  const meshOf = (xml: string) => {
    const vertices = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)];
    const triangles = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map(
      (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
    );
    return { vertices, triangles };
  };

  it('shares one vertex between every triangle that meets there', () => {
    const { vertices, triangles } = meshOf(buildModelXml([box()]));

    // Eight corners, not thirty-six loose ones.
    expect(vertices).toHaveLength(8);
    expect(triangles).toHaveLength(12);

    const distinct = new Set(vertices.map((v) => `${v[1]},${v[2]},${v[3]}`));
    expect(distinct.size).toBe(vertices.length);
  });

  it('declares a closed surface, with every edge shared by two faces', () => {
    const { triangles } = meshOf(buildModelXml([box()]));

    const edges = new Map<string, number>();
    for (const [a, b, c] of triangles) {
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const key = x < y ? `${x}|${y}` : `${y}|${x}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }

    const unshared = [...edges.values()].filter((n) => n !== 2);
    expect(unshared).toHaveLength(0);
  });

  it('drops a triangle whose corners round onto each other', () => {
    // Two corners a nanometre apart land on one vertex, leaving no triangle.
    const sliver: ExportPart = {
      color: '#ffffff',
      name: 'sliver',
      positions: new Float32Array([0, 0, 0, 1e-6, 0, 0, 0, 1, 0]),
    };

    expect(meshOf(buildModelXml([sliver])).triangles).toHaveLength(0);
  });
});
