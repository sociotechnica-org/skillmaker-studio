/** Stateful mechanics for the next shell, isolated as hooks. */
import { useCallback, useRef, useState } from "react";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const loadStoredWidth = (key: string, fallback: number): number => {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export type PanelResize = {
  /** Current panel width in px. */
  readonly width: number;
  /** True while the user is dragging this panel's border. */
  readonly dragging: boolean;
  /** Attach to the drag-handle's onMouseDown. */
  readonly onDragStart: (e: React.MouseEvent) => void;
};

/**
 * A draggable, localStorage-persisted panel width.
 * `side` decides how mouse X maps to width: a "left" panel grows rightward
 * (width = clientX), a "right" panel grows leftward (width = innerWidth - clientX).
 */
export function usePanelResize(
  side: "left" | "right",
  storageKey: string,
  fallback: number,
  min: number,
  max: number,
): PanelResize {
  const [width, setWidth] = useState(() => loadStoredWidth(storageKey, fallback));
  const [dragging, setDragging] = useState(false);
  const latest = useRef(width);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const move = (ev: MouseEvent) => {
        const raw = side === "left" ? ev.clientX : window.innerWidth - ev.clientX;
        const w = clamp(raw, min, max);
        latest.current = w;
        setWidth(w);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        setDragging(false);
        try {
          window.localStorage.setItem(storageKey, String(latest.current));
        } catch {
          // persistence is best-effort
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [side, storageKey, min, max],
  );

  return { width, dragging, onDragStart };
}
