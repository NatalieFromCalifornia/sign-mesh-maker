import { describe, expect, it } from 'vitest';
import { artworkToSvg } from './thumbnail';
import { parseSvgLayers } from './svgLayers';
import { HEX_SIGN_SVG } from '../test/fixtures';

describe('artworkToSvg', () => {
  const parsed = () => parseSvgLayers(HEX_SIGN_SVG);

  it('emits standalone SVG with one group per layer', () => {
    const svg = artworkToSvg(parsed(), []);

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.match(/<g /g)).toHaveLength(3);
  });

  it('uses the assigned colours, not the originals', () => {
    // The thumbnail has to show what will print — including recolours and
    // merges — rather than the file as uploaded.
    const svg = artworkToSvg(parsed(), ['#ff0000', '#ff0000', '#00ff00']);

    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).not.toContain('#2f9d8f');
  });

  it('falls back to a layer’s own colour when none is assigned', () => {
    const svg = artworkToSvg(parsed(), ['#ff0000']);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill="#f2681c"');
  });

  it('sets a viewBox covering the artwork in SVG orientation', () => {
    const svg = artworkToSvg(parsed(), []);
    const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(' ').map(Number);

    expect(viewBox).toBeDefined();
    expect(viewBox![2]).toBeCloseTo(200, 3);
    expect(viewBox![3]).toBeCloseTo(100, 3);
  });

  it('produces markup a parser accepts back', () => {
    // Round-tripping is what makes the thumbnail trustworthy as a preview.
    const reparsed = parseSvgLayers(artworkToSvg(parsed(), []));
    expect(reparsed.layers).toHaveLength(3);
    expect(reparsed.width).toBeCloseTo(200, 2);
  });
});
