import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { CropRect } from '@sign-mesh-maker/shared';
import { cn } from '../lib/cn';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

interface CropOverlayProps {
  /** Crop as fractions of the artwork box, measured from its top-left. */
  value: CropRect;
  onChange: (next: CropRect) => void;
  /**
   * Hold the crop square in the box's own space. The box already carries the
   * artwork's aspect, so no ratio needs passing in.
   */
  lockAspect: boolean;
  className?: string;
}

/** Smallest crop that still leaves something to print. */
const MIN_SIZE = 0.04;
/** Arrow-key step, as a fraction of the artwork. Shift moves ten times as far. */
const KEY_STEP = 0.01;

const HANDLES: { id: Handle; label: string; style: string; cursor: string }[] = [
  { id: 'nw', label: 'top left', style: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { id: 'ne', label: 'top right', style: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'sw', label: 'bottom left', style: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'se', label: 'bottom right', style: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { id: 'n', label: 'top', style: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { id: 's', label: 'bottom', style: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { id: 'w', label: 'left', style: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { id: 'e', label: 'right', style: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Draggable crop window over the artwork (requirements §5.3).
 *
 * Works in fractions of the artwork box rather than pixels, so the same crop
 * survives the panel being resized and is what gets stored.
 *
 * Pointer capture rather than window listeners: a drag that leaves the element
 * — which is most drags, since the edges are the point — keeps delivering
 * events to the handle that started it, and releasing outside still ends the
 * gesture cleanly.
 */
export function CropOverlay({ value, onChange, lockAspect, className }: CropOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    handle: Handle | 'move';
    startX: number;
    startY: number;
    start: CropRect;
  } | null>(null);

  const begin = useCallback(
    (handle: Handle | 'move') => (event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      dragRef.current = {
        handle,
        startX: event.clientX,
        startY: event.clientY,
        start: { ...value },
      };
    },
    [value],
  );

  const move = useCallback(
    (event: ReactPointerEvent) => {
      const drag = dragRef.current;
      const host = hostRef.current;
      if (!drag || !host) return;

      const box = host.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;

      const dx = (event.clientX - drag.startX) / box.width;
      const dy = (event.clientY - drag.startY) / box.height;
      const start = drag.start;

      if (drag.handle === 'move') {
        onChange({
          ...start,
          x: clamp01(Math.min(start.x + dx, 1 - start.width)),
          y: clamp01(Math.min(start.y + dy, 1 - start.height)),
        });
        return;
      }

      let { x, y, width, height } = start;
      const handle = drag.handle;

      if (handle.includes('w')) {
        const nextX = clamp01(Math.min(start.x + dx, start.x + start.width - MIN_SIZE));
        width = start.x + start.width - nextX;
        x = nextX;
      }
      if (handle.includes('e')) {
        width = Math.min(1 - start.x, Math.max(MIN_SIZE, start.width + dx));
      }
      if (handle.includes('n')) {
        const nextY = clamp01(Math.min(start.y + dy, start.y + start.height - MIN_SIZE));
        height = start.y + start.height - nextY;
        y = nextY;
      }
      if (handle.includes('s')) {
        height = Math.min(1 - start.y, Math.max(MIN_SIZE, start.height + dy));
      }

      if (lockAspect) {
        /*
         * Aspect is in artwork units, and the crop is in fractions of a box
         * that is itself that aspect — so within this space the ratio to hold
         * is 1:1, and the driving edge is whichever the pointer moved.
         */
        const horizontal = handle === 'w' || handle === 'e' || handle.length === 2;
        if (horizontal) {
          height = Math.min(1 - y, width);
        } else {
          width = Math.min(1 - x, height);
        }
      }

      onChange({ x, y, width, height });
    },
    [onChange, lockAspect],
  );

  /**
   * Keyboard equivalent of dragging.
   *
   * The handles were pointer-only, which meant cropping could not be done from
   * a keyboard at all — arrow keys now nudge whichever edge the handle owns,
   * and Shift moves in larger steps for crossing the artwork quickly.
   */
  const nudge = useCallback(
    (handle: Handle | 'move', event: ReactKeyboardEvent) => {
      const step = (event.shiftKey ? KEY_STEP * 10 : KEY_STEP);
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      if (dx === 0 && dy === 0) return;

      event.preventDefault();
      /*
       * A handle sits inside the window, which listens for the same keys to
       * move the crop. Without this the resize is applied and then immediately
       * overwritten by the parent acting on the value it captured before it.
       */
      event.stopPropagation();
      let { x, y, width, height } = value;

      if (handle === 'move') {
        onChange({
          ...value,
          x: clamp01(Math.min(Math.max(0, x + dx), 1 - width)),
          y: clamp01(Math.min(Math.max(0, y + dy), 1 - height)),
        });
        return;
      }

      if (handle.includes('w')) {
        const nextX = clamp01(Math.min(Math.max(0, x + dx), x + width - MIN_SIZE));
        width = x + width - nextX;
        x = nextX;
      }
      if (handle.includes('e')) width = Math.min(1 - x, Math.max(MIN_SIZE, width + dx));
      if (handle.includes('n')) {
        const nextY = clamp01(Math.min(Math.max(0, y + dy), y + height - MIN_SIZE));
        height = y + height - nextY;
        y = nextY;
      }
      if (handle.includes('s')) height = Math.min(1 - y, Math.max(MIN_SIZE, height + dy));

      if (lockAspect) {
        const horizontal = handle === 'w' || handle === 'e' || handle.length === 2;
        if (horizontal) height = Math.min(1 - y, width);
        else width = Math.min(1 - x, height);
      }

      onChange({ x, y, width, height });
    },
    [value, onChange, lockAspect],
  );

  const end = useCallback((event: ReactPointerEvent) => {
    const target = event.target as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }, []);

  const style = {
    left: `${value.x * 100}%`,
    top: `${value.y * 100}%`,
    width: `${value.width * 100}%`,
    height: `${value.height * 100}%`,
  };

  return (
    <div ref={hostRef} className={cn('absolute inset-0', className)} aria-hidden={false}>
      {/*
        Four panels around the window rather than one overlay with a hole
        punched through it. A blend mode would depend on how the parent stacking
        context resolves, which is a lot of fragility for a rectangle.
      */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 bg-mat/75"
        style={{ height: `${value.y * 100}%` }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 bg-mat/75"
        style={{ height: `${(1 - value.y - value.height) * 100}%` }}
      />
      <div
        className="pointer-events-none absolute left-0 bg-mat/75"
        style={{
          top: `${value.y * 100}%`,
          height: `${value.height * 100}%`,
          width: `${value.x * 100}%`,
        }}
      />
      <div
        className="pointer-events-none absolute right-0 bg-mat/75"
        style={{
          top: `${value.y * 100}%`,
          height: `${value.height * 100}%`,
          width: `${(1 - value.x - value.width) * 100}%`,
        }}
      />

      <div
        role="group"
        aria-label="Crop window"
        tabIndex={0}
        // Focusable so the window can be repositioned without a pointer.
        onKeyDown={(e) => nudge('move', e)}
        className="absolute cursor-move touch-none border border-signal focus-visible:outline-2"
        style={style}
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="pointer-events-none absolute inset-0 opacity-40">
          <div className="absolute left-1/3 top-0 h-full w-px bg-signal" />
          <div className="absolute left-2/3 top-0 h-full w-px bg-signal" />
          <div className="absolute left-0 top-1/3 h-px w-full bg-signal" />
          <div className="absolute left-0 top-2/3 h-px w-full bg-signal" />
        </div>

        {HANDLES.map((handle) => (
          <span
            key={handle.id}
            role="slider"
            tabIndex={0}
            aria-label={`Resize crop ${handle.label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(
              (handle.id === 'n' || handle.id === 's' ? value.height : value.width) * 100,
            )}
            aria-valuetext={`${Math.round(value.width * 100)}% wide, ${Math.round(
              value.height * 100,
            )}% tall`}
            onKeyDown={(e) => nudge(handle.id, e)}
            className={cn(
              'absolute size-2.5 touch-none border border-mat bg-signal',
              handle.style,
            )}
            style={{ cursor: handle.cursor }}
            onPointerDown={begin(handle.id)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      </div>
    </div>
  );
}
