import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HEX_SIGN_SVG } from '../test/fixtures';

/*
 * The reordering permutation is covered in svgLayers.test.ts. What this file
 * covers is the wiring around it — that the rows follow the print order, that
 * heights are reassigned by position, and that focus survives a move so a
 * layer can be walked up the stack. None of that needs a real browser, so it
 * belongs here rather than in Playwright.
 */

// The viewer wants a WebGL context, which jsdom has no way to provide, and the
// layer list does not depend on it.
vi.mock('../components/Viewer', () => ({
  Viewer: () => null,
}));

// Firestore is not reachable, and none of this touches persistence.
vi.mock('../lib/projects', () => ({
  MAX_PROJECT_NAME: 200,
  ProjectTooLargeError: class extends Error {},
  describeFirestoreError: (_c: unknown, action: string) => `${action} failed.`,
  loadProject: vi.fn(),
  saveProject: vi.fn(),
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

const { Editor } = await import('./Editor');

/** Layer rows as displayed: top of the printed stack first. */
function rowColors(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.textContent?.match(/#[0-9a-f]{6}/i)?.[0])
    .filter((c): c is string => Boolean(c));
}

function rowHeights(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((li) => li.textContent?.match(/[\d.]+ mm/)?.[0])
    .filter((h): h is string => Boolean(h));
}

const moveButton = (color: string, direction: 'up' | 'down') =>
  screen.getByRole('button', { name: `Move layer ${color} ${direction} the stack` });

async function uploadArtwork() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Editor />
    </MemoryRouter>,
  );

  const file = new File([HEX_SIGN_SVG], 'sign.svg', { type: 'image/svg+xml' });
  // jsdom's File does not implement Blob.text(), which the upload path reads
  // the markup through.
  Object.defineProperty(file, 'text', { value: async () => HEX_SIGN_SVG });

  await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, file);

  await waitFor(() => expect(rowColors()).toHaveLength(3));
  return user;
}

describe('layer order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /*
   * Tallest first, so the list reads the way the sign is stacked and the up
   * arrow moves a row upward. Listing lowest-first made "up" move a row down
   * the screen.
   */
  it('lists layers top of the stack first', async () => {
    await uploadArtwork();
    expect(rowColors()).toEqual(['#ffffff', '#f2681c', '#2f9d8f']);
    expect(rowHeights()).toEqual(['2.80 mm', '2.40 mm', '2.00 mm']);
  });

  it('moves a layer up the stack and reassigns the heights by position', async () => {
    const user = await uploadArtwork();

    await user.click(moveButton('#2f9d8f', 'up'));

    // It was the bottom row; up moves it one position toward the top.
    expect(rowColors()).toEqual(['#ffffff', '#2f9d8f', '#f2681c']);
    // Height follows position, not the layer — the two simply swap.
    expect(rowHeights()).toEqual(['2.80 mm', '2.40 mm', '2.00 mm']);
  });

  it('moves a layer back down again', async () => {
    const user = await uploadArtwork();

    await user.click(moveButton('#2f9d8f', 'up'));
    await user.click(moveButton('#2f9d8f', 'down'));

    expect(rowColors()).toEqual(['#ffffff', '#f2681c', '#2f9d8f']);
  });

  /*
   * The row is keyed by colour so React moves the existing node instead of
   * rewriting every row. Without that, focus lands back at the body and a
   * keyboard user has to re-find the control after every single step.
   */
  it('keeps focus on the moved layer so it can be walked up the stack', async () => {
    const user = await uploadArtwork();

    const up = moveButton('#2f9d8f', 'up');
    up.focus();
    await user.keyboard('{Enter}');

    expect(document.activeElement).toBe(moveButton('#2f9d8f', 'up'));

    await user.keyboard('{Enter}');
    expect(rowColors()).toEqual(['#2f9d8f', '#ffffff', '#f2681c']);
  });

  /*
   * Disabled rather than absent: a control that disappears at the ends reflows
   * every row beneath it mid-move, which is how reorder lists usually go wrong.
   */
  it('disables the ends of the stack rather than hiding the control', async () => {
    await uploadArtwork();

    // #2f9d8f is the bottom of the stack, #ffffff the top.
    expect(moveButton('#2f9d8f', 'down')).toBeDisabled();
    expect(moveButton('#ffffff', 'up')).toBeDisabled();
    expect(moveButton('#2f9d8f', 'up')).toBeEnabled();
    expect(moveButton('#ffffff', 'down')).toBeEnabled();
  });

  it('moves a merged group as one layer', async () => {
    const user = await uploadArtwork();

    await user.click(screen.getByLabelText('Select layer #2f9d8f'));
    await user.click(screen.getByLabelText('Select layer #f2681c'));
    await user.click(screen.getByRole('button', { name: 'Merge' }));

    await waitFor(() => expect(rowColors()).toHaveLength(2));
    // The merged pair sits at the bottom of the stack; #ffffff is above it.
    const shown = rowColors();
    const merged = shown[shown.length - 1];

    await user.click(moveButton(merged, 'up'));

    // The merge survives the move: still two rows, still carrying both layers.
    expect(rowColors()).toEqual([merged, '#ffffff']);
    expect(screen.getByText('2 merged')).toBeInTheDocument();
  });

  it('restores document order on reset', async () => {
    const user = await uploadArtwork();

    await user.click(moveButton('#2f9d8f', 'up'));
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(rowColors()).toEqual(['#ffffff', '#f2681c', '#2f9d8f']);
  });
});
