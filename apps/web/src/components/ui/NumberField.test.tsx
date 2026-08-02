import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberField } from './NumberField';

/** Mirrors real usage: the value round-trips through parent state. */
function Harness({
  initial = 120,
  onValue,
  ...rest
}: {
  initial?: number;
  onValue?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumberField
      label="Width"
      unit="mm"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      {...rest}
    />
  );
}

describe('NumberField', () => {
  /*
   * Regression: binding the number straight to a controlled input meant an
   * unparseable value fell back to the previous number, so the re-render undid
   * the deletion. Backspace appeared to do nothing and typing could only
   * append — "120" became "1205" instead of "5".
   */
  it('lets the field be cleared', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;

    await user.clear(input);
    expect(input.value).toBe('');
  });

  it('backspaces digits one at a time instead of reverting', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;

    await user.click(input);
    await user.keyboard('{End}{Backspace}');
    expect(input.value).toBe('12');
    await user.keyboard('{Backspace}');
    expect(input.value).toBe('1');
  });

  it('replaces rather than appends when retyping a cleared field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;

    await user.clear(input);
    await user.type(input, '85');
    expect(input.value).toBe('85');
  });

  it('accepts a decimal below the minimum while typing', async () => {
    const user = userEvent.setup();
    render(<Harness initial={1} min={0.1} step={0.1} />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;

    await user.clear(input);
    // Clamping per keystroke would rewrite "0." before ".4" could be typed.
    await user.type(input, '0.4');
    expect(input.value).toBe('0.4');
  });

  it('clamps to the minimum on blur, not mid-keystroke', async () => {
    const user = userEvent.setup();
    render(<Harness initial={10} min={5} />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;

    await user.clear(input);
    await user.type(input, '2');
    expect(input.value).toBe('2');
    await user.tab();
    expect(input.value).toBe('5');
  });

  it('restores the last valid value when left empty', async () => {
    const user = userEvent.setup();
    render(<Harness initial={42} />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;

    await user.clear(input);
    await user.tab();
    expect(input.value).toBe('42');
  });

  describe('steppers', () => {
    it('increments and decrements by the step', async () => {
      const user = userEvent.setup();
      render(<Harness initial={80} step={5} />);
      const input = screen.getByLabelText('Width') as HTMLInputElement;

      await user.click(screen.getByLabelText('Increase Width'));
      expect(input.value).toBe('85');
      await user.click(screen.getByLabelText('Decrease Width'));
      await user.click(screen.getByLabelText('Decrease Width'));
      expect(input.value).toBe('75');
    });

    it('rounds to the precision implied by the step', async () => {
      const user = userEvent.setup();
      render(<Harness initial={0.4} step={0.2} min={0.1} />);
      const input = screen.getByLabelText('Width') as HTMLInputElement;

      // 0.4 + 0.2 is 0.6000000000000001 in binary floating point.
      await user.click(screen.getByLabelText('Increase Width'));
      expect(input.value).toBe('0.6');
    });

    it('does not step past the bounds', async () => {
      const user = userEvent.setup();
      render(<Harness initial={2} min={1} max={3} step={1} />);
      const input = screen.getByLabelText('Width') as HTMLInputElement;

      await user.click(screen.getByLabelText('Increase Width'));
      expect(input.value).toBe('3');
      expect(screen.getByLabelText('Increase Width')).toBeDisabled();

      await user.click(screen.getByLabelText('Decrease Width'));
      await user.click(screen.getByLabelText('Decrease Width'));
      expect(input.value).toBe('1');
      expect(screen.getByLabelText('Decrease Width')).toBeDisabled();
    });
  });

  it('reports each committed value to the parent', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={10} onValue={onValue} />);
    const input = screen.getByLabelText('Width') as HTMLInputElement;

    await user.clear(input);
    await user.type(input, '7');
    expect(onValue).toHaveBeenLastCalledWith(7);
  });

  it('follows the value when it changes from outside', async () => {
    function External() {
      const [value, setValue] = useState(10);
      return (
        <>
          <NumberField label="Width" value={value} onChange={setValue} />
          <button onClick={() => setValue(99)}>preset</button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<External />);

    await user.click(screen.getByText('preset'));
    expect((screen.getByLabelText('Width') as HTMLInputElement).value).toBe('99');
  });
});
