"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CoverSpectrumData, CoverSpectrumLayout } from "@/lib/cover-spectrum-types";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.5;
const DEFAULT_VIEW = { scale: 1, x: 0, y: 0 };

type ViewTransform = typeof DEFAULT_VIEW;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export function ChromaticIndex({ data }: { data: CoverSpectrumData }) {
  const router = useRouter();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const activeBookIndexRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [layoutName, setLayoutName] = useState<"desktop" | "mobile">("desktop");
  const [activeBookIndex, setActiveBookIndex] = useState<number | null>(null);
  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
  const [isPanning, setIsPanning] = useState(false);
  const layout = data.layouts[layoutName];
  const activeBook = activeBookIndex === null ? undefined : data.books[activeBookIndex];
  const activeCell = useMemo(
    () => activeBookIndex === null ? -1 : layout.order.indexOf(activeBookIndex),
    [activeBookIndex, layout.order],
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const updateLayout = () => setLayoutName(media.matches ? "mobile" : "desktop");
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    setView(DEFAULT_VIEW);
    activeBookIndexRef.current = null;
    setActiveBookIndex(null);
  }, [layoutName]);

  useEffect(() => {
    const handleResize = () => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      setView((current) => clampView(current, rect.width, rect.height));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function selectBook(bookIndex: number | null) {
    if (activeBookIndexRef.current === bookIndex) return;
    activeBookIndexRef.current = bookIndex;
    setActiveBookIndex(bookIndex);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) > 3) drag.moved = true;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        setView((current) => clampView({ ...current, x: drag.originX + deltaX, y: drag.originY + deltaY }, rect.width, rect.height));
      }
      selectBook(null);
      return;
    }
    if (event.pointerType === "touch") return;
    const bookIndex = bookIndexAtPoint(event.clientX, event.clientY, layout, viewportRef.current, view);
    selectBook(bookIndex);
    positionTooltip(event.clientX, event.clientY, tooltipRef.current);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || view.scale <= MIN_SCALE) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  }

  function finishPointerPan(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const bookIndex = bookIndexAtPoint(event.clientX, event.clientY, layout, viewportRef.current, view);
    if (bookIndex === null) return;
    router.push(`/books/${data.books[bookIndex].slug}`);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.012);
      zoomTo(view.scale * factor, event.clientX, event.clientY);
      return;
    }
    setView((current) => clampView({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }, rect.width, rect.height));
  }

  function zoomTo(requestedScale: number, clientX?: number, clientY?: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((current) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale));
      const pointX = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const pointY = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const scaleRatio = nextScale / current.scale;
      return clampView({
        scale: nextScale,
        x: pointX - (pointX - current.x) * scaleRatio,
        y: pointY - (pointY - current.y) * scaleRatio,
      }, rect.width, rect.height);
    });
  }

  function resetView() {
    setView(DEFAULT_VIEW);
    selectBook(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(view.scale * ZOOM_STEP);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomTo(view.scale / ZOOM_STEP);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      resetView();
      return;
    }
    const firstCell = layout.order.findIndex((bookIndex) => bookIndex >= 0);
    const currentCell = activeCell >= 0 ? activeCell : firstCell;
    let nextCell = currentCell;
    if (event.key === "ArrowLeft") nextCell -= 1;
    else if (event.key === "ArrowRight") nextCell += 1;
    else if (event.key === "ArrowUp") nextCell -= layout.columns;
    else if (event.key === "ArrowDown") nextCell += layout.columns;
    else if (event.key === "Enter" && activeBook) {
      event.preventDefault();
      router.push(`/books/${activeBook.slug}`);
      return;
    } else if (event.key === "Escape") {
      selectBook(null);
      return;
    } else {
      return;
    }

    event.preventDefault();
    nextCell = nearestOccupiedCell(nextCell, currentCell, layout);
    const nextBookIndex = layout.order[nextCell];
    if (nextBookIndex >= 0) {
      selectBook(nextBookIndex);
      positionTooltipAtCell(nextCell, layout, viewportRef.current, tooltipRef.current, view);
    }
  }

  const highlightStyle = activeCell < 0 ? undefined : {
    left: `${((activeCell % layout.columns) / layout.columns) * 100}%`,
    top: `${(Math.floor(activeCell / layout.columns) / layout.rows) * 100}%`,
    width: `${100 / layout.columns}%`,
    height: `${100 / layout.rows}%`,
  };

  const canvasStyle = {
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
  };

  return (
    <section className="chromatic-index" aria-labelledby="chromatic-index-title">
      <div
        aria-describedby="chromatic-index-instructions"
        aria-label={`Interactive spectrum of ${data.count} book covers`}
        className={`chromatic-index-viewport focus-ring ${view.scale > MIN_SCALE ? "is-zoomed" : ""} ${isPanning ? "is-panning" : ""}`}
        onBlur={() => selectBook(null)}
        onClick={handleClick}
        onFocus={() => {
          const firstCell = layout.order.findIndex((bookIndex) => bookIndex >= 0);
          const firstBookIndex = firstCell >= 0 ? layout.order[firstCell] : null;
          selectBook(firstBookIndex);
          if (firstCell >= 0) positionTooltipAtCell(firstCell, layout, viewportRef.current, tooltipRef.current, view);
        }}
        onKeyDown={handleKeyDown}
        onPointerCancel={finishPointerPan}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          if (!dragRef.current) selectBook(null);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerPan}
        onWheel={handleWheel}
        ref={viewportRef}
        role="application"
        tabIndex={0}
      >
        <div className="chromatic-index-canvas" style={canvasStyle}>
          <picture className="chromatic-index-picture" aria-hidden="true">
            <source media="(max-width: 639px)" srcSet={data.layouts.mobile.imageUrl} />
            <img alt="" draggable={false} src={data.layouts.desktop.imageUrl} />
          </picture>
          {highlightStyle ? <span aria-hidden="true" className="chromatic-index-highlight" style={highlightStyle} /> : null}
        </div>
      </div>

      <div className="chromatic-index-intro">
        <Link className="focus-ring inline-flex items-center gap-2 font-[var(--font-mono)] text-[0.64rem] uppercase tracking-[0.16em]" href="/fun">
          <ArrowLeft size={12} />
          For fun / 01
        </Link>
        <h1 className="mt-3 font-[var(--font-serif)] text-3xl font-light leading-none sm:text-4xl" id="chromatic-index-title">
          The Chromatic Index
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-6">
          <span className="plain-number">{data.count.toLocaleString("en-US")}</span> covers arranged by hue from left to right and brightness from top to bottom.
        </p>
      </div>

      <p className="chromatic-index-legend" id="chromatic-index-instructions">
        <span className="chromatic-index-desktop-instructions">Pinch to zoom · two-finger scroll or drag to pan · click to open</span>
        <span className="chromatic-index-mobile-instructions">Pinch or use +/− to zoom · drag to pan · tap to open</span>
      </p>

      <div aria-label="Chromatic Index zoom controls" className="chromatic-index-controls" role="group">
        <button
          aria-label="Zoom out"
          className="focus-ring"
          disabled={view.scale <= MIN_SCALE}
          onClick={() => zoomTo(view.scale / ZOOM_STEP)}
          type="button"
        >
          <Minus aria-hidden="true" size={16} />
        </button>
        <span aria-live="polite" className="chromatic-index-zoom-readout plain-number">
          {Math.round(view.scale * 100)}%
        </span>
        <button
          aria-label="Zoom in"
          className="focus-ring"
          disabled={view.scale >= MAX_SCALE}
          onClick={() => zoomTo(view.scale * ZOOM_STEP)}
          type="button"
        >
          <Plus aria-hidden="true" size={16} />
        </button>
        <button aria-label="Reset zoom" className="focus-ring" disabled={view.scale === MIN_SCALE} onClick={resetView} type="button">
          <RotateCcw aria-hidden="true" size={14} />
        </button>
      </div>

      <div aria-live="polite" className={`chromatic-index-tooltip ${activeBook ? "is-visible" : ""}`} ref={tooltipRef}>
        {activeBook ? (
          <>
            <img alt="" src={activeBook.thumbnailUrl} />
            <div className="min-w-0">
              <p className="font-medium leading-5">{activeBook.title}</p>
              <p className="mt-1 text-xs muted">{activeBook.author}</p>
              <p className="mt-3 font-[var(--font-mono)] text-[0.62rem] uppercase leading-4 tracking-[0.1em] muted">
                {[activeBook.publicationYear, activeBook.primarySubject].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-1 font-[var(--font-mono)] text-[0.62rem] uppercase leading-4 tracking-[0.1em] muted">
                <span className="plain-number">{activeBook.wins}</span> wins · <span className="plain-number">{activeBook.lists}</span> lists · score <span className="plain-number">{activeBook.score}</span>
              </p>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function bookIndexAtPoint(
  clientX: number,
  clientY: number,
  layout: CoverSpectrumLayout,
  viewport: HTMLDivElement | null,
  view: ViewTransform,
) {
  if (!viewport) return null;
  const rect = viewport.getBoundingClientRect();
  const canvasX = (clientX - rect.left - view.x) / view.scale;
  const canvasY = (clientY - rect.top - view.y) / view.scale;
  if (canvasX < 0 || canvasX >= rect.width || canvasY < 0 || canvasY >= rect.height) return null;
  const column = Math.min(layout.columns - 1, Math.max(0, Math.floor((canvasX / rect.width) * layout.columns)));
  const row = Math.min(layout.rows - 1, Math.max(0, Math.floor((canvasY / rect.height) * layout.rows)));
  const bookIndex = layout.order[row * layout.columns + column];
  return bookIndex >= 0 ? bookIndex : null;
}

function nearestOccupiedCell(nextCell: number, currentCell: number, layout: CoverSpectrumLayout) {
  const direction = nextCell >= currentCell ? 1 : -1;
  let candidate = Math.min(layout.order.length - 1, Math.max(0, nextCell));
  while (layout.order[candidate] < 0 && candidate > 0 && candidate < layout.order.length - 1) candidate += direction;
  return Math.min(layout.order.length - 1, Math.max(0, candidate));
}

function positionTooltip(clientX: number, clientY: number, tooltip: HTMLDivElement | null) {
  if (!tooltip) return;
  const tooltipWidth = 320;
  const tooltipHeight = 156;
  const left = Math.max(12, Math.min(clientX + 18, window.innerWidth - tooltipWidth - 12));
  const top = Math.max(12, Math.min(clientY + 18, window.innerHeight - tooltipHeight - 12));
  tooltip.style.transform = `translate3d(${left}px, ${top}px, 0)`;
}

function positionTooltipAtCell(
  cell: number,
  layout: CoverSpectrumLayout,
  surface: HTMLDivElement | null,
  tooltip: HTMLDivElement | null,
  view: ViewTransform,
) {
  if (!surface) return;
  const rect = surface.getBoundingClientRect();
  const column = cell % layout.columns;
  const row = Math.floor(cell / layout.columns);
  positionTooltip(
    rect.left + view.x + ((column + 0.5) / layout.columns) * rect.width * view.scale,
    rect.top + view.y + ((row + 0.5) / layout.rows) * rect.height * view.scale,
    tooltip,
  );
}

function clampView(view: ViewTransform, width: number, height: number): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  const minX = width - width * scale;
  const minY = height - height * scale;
  return {
    scale,
    x: Math.min(0, Math.max(minX, view.x)),
    y: Math.min(0, Math.max(minY, view.y)),
  };
}
