import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { build3mf, buildModelXml, threeMfFilename, type ExportPart } from './export3mf';

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

  it('writes one base material per part, with its colour', () => {
    const xml = buildModelXml(PARTS);
    expect(xml).toContain('displaycolor="#2F9D8FFF"');
    expect(xml).toContain('displaycolor="#F2681CFF"');
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

  it('escapes characters that would break the XML', () => {
    const xml = buildModelXml([{ ...part('#ffffff', 'a & b <c>'), name: 'a & b <c>' }]);
    expect(xml).toContain('a &amp; b &lt;c&gt;');
    expect(xml).not.toContain('a & b <c>');
  });

  it('expands shorthand hex colours', () => {
    expect(buildModelXml([part('#fff', 'short')])).toContain('displaycolor="#FFFFFFFF"');
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
