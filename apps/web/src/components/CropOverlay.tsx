import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { CropRect } from '@sign-mesh-maker/shared';
import { cn } from '../lib/cn';

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

interface CropOverlayProps {
  /** Crop as fractions of the artwork box, measured from its top-left. */
  value: CropRect;
  onChange: (next: CropRect) => void;
  /** Artwork aspect (w/h), used when the crop is locked to it. */
  aspect: number;
  lockAspect: boolean;
  className?: string;
}

/** Smallest crop that still leaves something to print. */
const MIN_SIZE = 0.04;

const HANDLES: { id: Handle; style: string; cursor: string }[] = [
  { id: 'nw', style: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'nwse-resize' },
  { id: 'ne', style: 'right-0 top-0 translate-x-1/2 -translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'sw', style: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'nesw-resize' },
  { id: 'se', style: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2', cursor: 'nwse-resize' },
  { id: 'n', style: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2', cursor: 'ns-resize' },
  { id: 's', style: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2', cursor: 'ns-resize' },
  { id: 'w', style: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { id: 'e', style: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2', cursor: 'ew-resize' },
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
export function CropOverlay({
  value,
  onChange,
  aspect,
  lockAspect,
  className,
}: CropOverlayProps) {
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
        className="absolute cursor-move touch-none border border-signal"
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
            tabIndex={-1}
            aria-label={`Resize crop ${handle.id}`}
            aria-valuenow={Math.round(value.width * 100)}
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
