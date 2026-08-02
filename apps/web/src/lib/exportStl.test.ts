import { describe, expect, it } from 'vitest';
import { stlFilename } from './exportStl';

describe('stlFilename', () => {
  it('slugifies a project name', () => {
    expect(stlFilename('Woman In Bathtub')).toBe('woman-in-bathtub.stl');
  });

  it('collapses punctuation and trims separators', () => {
    expect(stlFilename('  my sign!! (v2) ')).toBe('my-sign-v2.stl');
    expect(stlFilename('a___b')).toBe('a-b.stl');
  });

  it('keeps the original extension out of the slug', () => {
    expect(stlFilename('test-sign.svg')).toBe('test-sign-svg.stl');
  });

  it('falls back when a name slugifies to nothing', () => {
    expect(stlFilename('***')).toBe('sign.stl');
    expect(stlFilename('')).toBe('sign.stl');
  });
});
