import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Window = { start: number; end: number };
const full = { start: 0, end: 1 };

function bounded(start: number, width: number): Window {
  const size = Math.min(1, width);
  const left = Math.max(0, Math.min(1 - size, start));
  return { start: left, end: left + size };
}

export function useChartZoom(count: number, resetKey: string) {
  const [window, setWindow] = useState<Window>(full);
  const current = useRef(window);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const priceRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const minimum = Math.min(1, 9 / Math.max(1, count - 1));
  const commit = (next: Window) => { current.current = next; setWindow(next); };
  const reset = () => { pointers.current.clear(); commit(full); };
  useEffect(reset, [resetKey]);

  const zoom = (factor: number, anchor = 0.5) => {
    const previous = current.current;
    const width = previous.end - previous.start;
    const nextWidth = Math.max(minimum, Math.min(1, width * factor));
    commit(bounded(previous.start + anchor * (width - nextWidth), nextWidth));
  };

  // Recharts reserves 30px on the left and 8px on the right for its axes.
  const geometry = (element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left + 30, width: Math.max(1, rect.width - 38) };
  };

  useEffect(() => {
    const elements = [priceRef.current, macdRef.current].filter((node): node is HTMLDivElement => !!node);
    const wheel = (event: WheelEvent) => {
      if (count < 2) return;
      event.preventDefault();
      const plot = geometry(event.currentTarget as HTMLDivElement);
      const anchor = Math.max(0, Math.min(1, (event.clientX - plot.left) / plot.width));
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1);
      zoom(Math.exp(Math.max(-1, Math.min(1, delta * 0.003))), anchor);
    };
    elements.forEach(element => element.addEventListener('wheel', wheel, { passive: false }));
    return () => elements.forEach(element => element.removeEventListener('wheel', wheel));
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (count < 2 || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const before = [...pointers.current.values()];
    const previousPoint = pointers.current.get(event.pointerId);
    if (!previousPoint) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.current.values()];
    const plot = geometry(event.currentTarget);
    const previous = current.current;
    const width = previous.end - previous.start;
    if (before.length === 2) {
      const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const oldCenter = (before[0].x + before[1].x) / 2;
      const newCenter = (after[0].x + after[1].x) / 2;
      const nextWidth = Math.max(minimum, Math.min(1, width * distance(before) / Math.max(1, distance(after))));
      const anchor = (oldCenter - plot.left) / plot.width;
      commit(bounded(previous.start + anchor * width - (newCenter - plot.left) / plot.width * nextWidth, nextWidth));
    } else if (before.length === 1) {
      commit(bounded(previous.start - (event.clientX - previousPoint.x) / plot.width * width, width));
    }
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => { pointers.current.delete(event.pointerId); };
  return {
    priceRef, macdRef, window, zoom, reset,
    canZoomIn: count > 10 && window.end - window.start > minimum + 0.0001,
    canZoomOut: window.end - window.start < 0.9999,
    handlers: { onPointerDown, onPointerMove, onPointerUp: release, onPointerCancel: release, onLostPointerCapture: release, onDoubleClick: reset },
    first: Math.floor(window.start * Math.max(0, count - 1)),
    last: Math.min(count, Math.ceil(window.end * Math.max(0, count - 1)) + 1),
  };
}
