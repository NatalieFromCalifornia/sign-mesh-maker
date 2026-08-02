import { useCallback, useRef, useState, type DragEvent } from 'react';
import { cn } from '../lib/cn';

/** Requirements §5.1 caps uploads at 20 MB. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

interface DropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function Dropzone({ onFile, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) take(event.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'rounded-panel border border-dashed transition-colors',
        dragging ? 'border-signal bg-bench' : 'border-rule bg-bench/40',
      )}
    >
      <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          Drop artwork here
        </p>
        <p className="max-w-sm text-sm leading-relaxed text-graphite">
          SVG only, up to 20 MB. Each fill color becomes a printed layer, so the
          artwork needs flat filled shapes rather than strokes or text.
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'h-10 whitespace-nowrap rounded-[3px] bg-signal px-4 font-mono text-xs uppercase tracking-[0.1em] text-mat',
            'transition-colors hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          Choose a file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".svg,image/svg+xml"
          className="sr-only"
          onChange={(e) => {
            take(e.target.files);
            // Allow re-selecting the same file after a reset.
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
