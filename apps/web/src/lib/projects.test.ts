import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '@sign-mesh-maker/shared';
import { SAFE_DOC_BUDGET, FIRESTORE_DOC_LIMIT, estimateProjectSize } from './projects';

const config: ProjectConfig = {
  widthMm: 120,
  baseMm: 2,
  layerMm: 0.4,
  layers: [
    { originalColor: '#2f9d8f', assignedColor: '#2f9d8f' },
    { originalColor: '#f2681c', assignedColor: '#2f9d8f' },
  ],
};

describe('estimateProjectSize', () => {
  it('counts the payload fields', () => {
    const size = estimateProjectSize({
      svg: '<svg></svg>',
      thumbnailDataUrl: 'data:image/jpeg;base64,AAAA',
      config,
      name: 'Sign',
    });

    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(500);
  });

  it('grows with the SVG, which is the field that actually gets large', () => {
    const small = estimateProjectSize({ svg: 'a', thumbnailDataUrl: '', config, name: 'x' });
    const large = estimateProjectSize({
      svg: 'a'.repeat(50_000),
      thumbnailDataUrl: '',
      config,
      name: 'x',
    });

    expect(large - small).toBeGreaterThanOrEqual(49_999);
  });

  it('counts multi-byte characters by their encoded length', () => {
    // A name in non-Latin script costs more than its character count, and
    // Firestore's limit is in bytes.
    const ascii = estimateProjectSize({ svg: '', thumbnailDataUrl: '', config, name: 'aaa' });
    const emoji = estimateProjectSize({ svg: '', thumbnailDataUrl: '', config, name: '🚀' });

    expect(emoji).toBeGreaterThan(ascii);
  });
});

describe('document budget', () => {
  it('leaves headroom under Firestore’s hard limit', () => {
    /*
     * The estimate counts payload strings only — not field names, the document
     * path, index entries or timestamps. Saving right up to the limit would be
     * rejected by the server with an error the user cannot act on.
     */
    expect(SAFE_DOC_BUDGET).toBeLessThan(FIRESTORE_DOC_LIMIT);
    expect(FIRESTORE_DOC_LIMIT - SAFE_DOC_BUDGET).toBeGreaterThan(100_000);
  });

  it('accepts a realistic project and rejects an unreasonable one', () => {
    const realistic = estimateProjectSize({
      svg: '<svg>'.padEnd(80_000, 'x'),
      thumbnailDataUrl: 'data:image/jpeg;base64,'.padEnd(24_000, 'A'),
      config,
      name: 'Bathtub sign',
    });
    expect(realistic).toBeLessThan(SAFE_DOC_BUDGET);

    const enormous = estimateProjectSize({
      svg: 'x'.repeat(1_200_000),
      thumbnailDataUrl: '',
      config,
      name: 'Too much',
    });
    expect(enormous).toBeGreaterThan(SAFE_DOC_BUDGET);
  });
});
