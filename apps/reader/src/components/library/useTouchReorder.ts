import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface TouchReorderOptions {
  /** Row ids in display order; the dragged id moves within this list. */
  ids: readonly string[];
  /** Fires with (draggedId, targetId) — the same contract as a desktop drop. */
  onReorder: (draggedId: string, targetId: string) => void;
  /** Disable the gesture below this many rows (nothing to reorder). */
  enabled?: boolean;
}

const HOLD_MS = 300;
/** Movement (px) before the hold fires that cancels it — that is a scroll. */
const CANCEL_RADIUS = 10;
/** Distance from the viewport edge where auto-scroll kicks in. */
const EDGE_ZONE = 56;
const EDGE_SPEED = 9;

/**
 * Touch reorder for rows with a grip handle (ADR-0025). Grip-only: a
 * long-press on the grip lifts the row; the row follows the finger while the
 * rows between its slot and the hover slot shift over, and release commits
 * the same (draggedId, targetId) contract as a desktop drop. Touch pointers
 * only — mouse rows keep HTML5 drag-and-drop.
 *
 * Rows keep their DOM slots during the drag; shifts are direct transforms
 * (no React state per move) computed against the slot grid captured at lift
 * time, so the moving rows never feed back into the hover math. Cleared on
 * release, where the caller re-renders in the committed order.
 */
export const useTouchReorder = ({ ids, onReorder, enabled = true }: TouchReorderOptions) => {
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startY: number;
    slotTops: number[];
    rowHeight: number;
    index: number;
    hoverIndex: number;
    lastClientY: number;
  } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const idsRef = useRef(ids);
  const reorderRef = useRef(onReorder);
  idsRef.current = ids;
  reorderRef.current = onReorder;

  const [liftedId, setLiftedId] = useState<string | null>(null);

  const clearHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const stopScroll = useCallback(() => {
    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    }
  }, []);

  /** Shift the rows between the dragged slot and the hover slot. */
  const applyTransforms = useCallback((hoverIndex: number, liftDeltaY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const shift = (hoverIndex - drag.index) * drag.rowHeight;
    for (const [id, row] of rowRefs.current) {
      const index = idsRef.current.indexOf(id);
      if (index === -1) continue;
      if (id === drag.id) {
        row.style.transform = `translateY(${liftDeltaY}px)`;
      } else if (
        (hoverIndex > drag.index && index > drag.index && index <= hoverIndex) ||
        (hoverIndex < drag.index && index >= hoverIndex && index < drag.index)
      ) {
        row.style.transform = `translateY(${-shift}px)`;
      } else {
        row.style.transform = '';
      }
    }
  }, []);

  /** Viewport-edge auto-scroll; the transforms track the new scroll offset. */
  const autoScroll = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta =
      drag.lastClientY > window.innerHeight - EDGE_ZONE
        ? EDGE_SPEED
        : drag.lastClientY < EDGE_ZONE
          ? -EDGE_SPEED
          : 0;
    if (delta) {
      window.scrollBy(0, delta);
      applyTransforms(drag.hoverIndex, drag.lastClientY - drag.startY);
    }
    scrollFrame.current = window.requestAnimationFrame(autoScroll);
  }, [applyTransforms]);

  const endDrag = useCallback(
    (commit: boolean) => {
      clearHold();
      stopScroll();
      document.removeEventListener('touchmove', preventTouchMove);
      const drag = dragRef.current;
      if (drag) {
        const targetId = idsRef.current[drag.hoverIndex];
        if (commit && targetId && targetId !== drag.id) {
          reorderRef.current(drag.id, targetId);
        }
      }
      dragRef.current = null;
      setLiftedId(null);
    },
    [clearHold, stopScroll],
  );

  const onGripPointerDown = useCallback(
    (id: string, event: ReactPointerEvent) => {
      if (!enabled || event.pointerType !== 'touch') return;
      const row = rowRefs.current.get(id);
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const index = idsRef.current.indexOf(id);
      dragRef.current = {
        id,
        pointerId: event.pointerId,
        startY: event.clientY,
        slotTops: [...rowRefs.current.values()].map((item) => item.getBoundingClientRect().top),
        rowHeight: rect.height,
        index,
        hoverIndex: index,
        lastClientY: event.clientY,
      };
      clearHold();
      holdTimer.current = window.setTimeout(() => {
        const drag = dragRef.current;
        if (!drag) return;
        // After the hold the pointer belongs to the drag: capture it on the
        // grip (moves keep flowing here) and stop the page from scrolling.
        try {
          event.currentTarget.setPointerCapture(drag.pointerId);
        } catch {
          // A stale pointer; the next move cancels instead.
        }
        navigator.vibrate?.(10);
        document.addEventListener('touchmove', preventTouchMove, { passive: false });
        setLiftedId(drag.id);
        stopScroll();
        scrollFrame.current = window.requestAnimationFrame(autoScroll);
      }, HOLD_MS);
    },
    [autoScroll, clearHold, enabled, stopScroll],
  );

  const onGripPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.lastClientY = event.clientY;
      if (liftedId === null) {
        // Still holding: movement beyond the radius is a scroll, not a drag.
        if (Math.abs(event.clientY - drag.startY) > CANCEL_RADIUS) endDrag(false);
        return;
      }
      // The hovered slot comes from the finger's offset over the slot grid
      // captured at lift — not from the dragged row's current rect, which
      // only moves as a *result* of this math.
      const dragSlotCenter = (drag.slotTops[drag.index] ?? 0) + drag.rowHeight / 2;
      const currentCenter = dragSlotCenter + (event.clientY - drag.startY);
      const firstSlotCenter = (drag.slotTops[0] ?? 0) + drag.rowHeight / 2;
      const hover = Math.max(
        0,
        Math.min(
          idsRef.current.length - 1,
          Math.round((currentCenter - firstSlotCenter) / drag.rowHeight),
        ),
      );
      drag.hoverIndex = hover;
      applyTransforms(hover, event.clientY - drag.startY);
    },
    [applyTransforms, endDrag, liftedId],
  );

  const onGripPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      endDrag(liftedId !== null);
    },
    [endDrag, liftedId],
  );

  // Losing the pointer (incoming call, gesture confusion) must not wedge the
  // list in drag mode; likewise, unmounting cleans the document listeners.
  const onGripPointerCancel = useCallback(() => endDrag(false), [endDrag]);
  useEffect(() => () => endDrag(false), [endDrag]);

  const setRowRef = useCallback(
    (id: string) => (row: HTMLElement | null) => {
      if (row) rowRefs.current.set(id, row);
      else rowRefs.current.delete(id);
    },
    [],
  );

  return {
    liftedId,
    setRowRef,
    onGripPointerDown,
    onGripPointerMove,
    onGripPointerUp,
    onGripPointerCancel,
  };
};

/** While lifted, the finger must move rows, not the page. */
function preventTouchMove(event: TouchEvent): void {
  event.preventDefault();
}
