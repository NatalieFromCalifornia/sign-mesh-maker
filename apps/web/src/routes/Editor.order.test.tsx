import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CAPTION_ON_PANEL_SVG, HEX_SIGN_SVG } from '../test/fixtures';

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

async function uploadArtwork(markup: string = HEX_SIGN_SVG) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Editor />
    </MemoryRouter>,
  );

  const file = new File([markup], 'sign.svg', { type: 'image/svg+xml' });
  // jsdom's File does not implement Blob.text(), which the upload path reads
  // the markup through.
  Object.defineProperty(file, 'text', { value: async () => markup });

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

describe('flat preview', () => {
  /*
   * The preview paints groups in order, so a region ordered under something
   * that covers it is simply painted over. Reported after a merge: the mesh
   * showed the caption engraved into its panel while the preview beside it
   * showed the panel blank, and one of the two was lying.
   */
  it('shows a buried region through the hole opened for it', async () => {
    const user = await uploadArtwork(CAPTION_ON_PANEL_SVG);

    const solid = (fill: string) => {
      const group = [...document.querySelectorAll('svg[role=img] g')].find(
        (g) => g.getAttribute('fill') === fill,
      )!;
      // One subpath is a solid tile; a second is the hole cut through it.
      return Math.max(
        ...[...group.querySelectorAll('path')].map(
          (path) => (path.getAttribute('d')?.match(/M/g) ?? []).length,
        ),
      );
    };

    // The panel starts solid, with the caption painted on top of it.
    expect(solid('#ad130f')).toBe(1);

    // Merging the caption into the background drops it underneath the panel.
    await user.click(screen.getByLabelText('Select layer #ffffff'));
    await user.click(screen.getByLabelText('Select layer #2f9d8f'));
    await user.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(rowColors()).toHaveLength(2));

    // The panel now carries a hole, so the caption under it reads through.
    expect(solid('#ad130f')).toBe(2);
  });
});

describe('layer actions', () => {
  /*
   * These sat in the panel header, which right-aligns its actions, so Reset
   * appearing shoved Merge sideways — the button moved out from under the
   * cursor exactly when a layer had just been selected.
   *
   * jsdom has no layout, so the position cannot be measured here. What can be
   * pinned is the two things that make it stable: Merge is always rendered, so
   * the row never changes height, and it comes first, so Reset extends the row
   * away from it instead of pushing it.
   */
  const merge = () => screen.getByRole('button', { name: 'Merge' });
  const reset = () => screen.queryByRole('button', { name: 'Reset' });

  it('keeps Merge in place when Reset appears', async () => {
    const user = await uploadArtwork();

    expect(merge()).toBeInTheDocument();
    expect(reset()).toBeNull();

    const before = merge();
    await user.click(moveButton('#2f9d8f', 'up'));

    // Reset appears at the far end of the row, behind Merge, so the corner
    // Merge is pinned to does not move.
    expect(reset()).toBeInTheDocument();
    expect(merge()).toBe(before);
    expect(
      merge().compareDocumentPosition(reset()!) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it('explains what Merge needs, next to Merge', async () => {
    const user = await uploadArtwork();

    // The count is always rendered, so the row never changes height.
    const hint = () => screen.getByText(/select two or more|\d+ selected/i);
    expect(hint()).toHaveTextContent(/select two or more/i);

    // One is not enough, so the instruction stands rather than reporting a
    // count and leaving the disabled button unexplained.
    await user.click(screen.getByLabelText('Select layer #2f9d8f'));
    expect(hint()).toHaveTextContent(/select two or more/i);
    expect(merge()).toBeDisabled();

    await user.click(screen.getByLabelText('Select layer #f2681c'));
    expect(hint()).toHaveTextContent(/2 selected/i);
    expect(merge()).toBeEnabled();
  });

  it('puts the actions below the layer list', async () => {
    await uploadArtwork();
    const list = screen.getAllByRole('list')[0];

    expect(
      list.compareDocumentPosition(merge()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
