"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Minus, Plus, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NonfictionGalaxyData, NonfictionGalaxyPoint } from "@/lib/nonfiction-galaxy-types";
import { EntityMetricGrid } from "@/components/ui/design-primitives";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.5;
const SELECTION_SCALE = 3.4;
const CAMERA_DURATION_MS = 620;
const STANDARD_POINT_RADIUS = 1.25;
const MAJOR_WINNER_POINT_RADIUS = 2;
const DEFAULT_VIEW = { scale: 1, x: 0, y: 0 };
const SUBJECT_COLOR_VARIABLES = [
  "--data-red",
  "--data-blue",
  "--data-gold",
  "--data-green",
  "--data-violet",
  "--data-cyan",
  "--data-olive",
  "--data-rose",
];

type ViewTransform = typeof DEFAULT_VIEW;
type SurfaceSize = { width: number; height: number; dpr: number };
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

export function NonfictionGalaxy({ dataUrl }: { dataUrl: string }) {
  const [data, setData] = useState<NonfictionGalaxyData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(dataUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Galaxy data returned ${response.status}.`);
        return response.json() as Promise<NonfictionGalaxyData>;
      })
      .then(setData)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "The map could not be loaded.");
      });
    return () => controller.abort();
  }, [dataUrl]);

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <Link className="focus-ring inline-flex items-center gap-2 font-[var(--font-mono)] text-xs uppercase tracking-[0.16em]" href="/fun">
          <ArrowLeft size={13} />
          For fun
        </Link>
        <h1 className="mt-6 font-[var(--font-serif)] text-5xl font-light">The Nonfiction Galaxy</h1>
        <p className="mt-5 max-w-xl text-base leading-7 muted">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="galaxy-loading mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8" aria-live="polite">
        <Link className="focus-ring inline-flex items-center gap-2 font-[var(--font-mono)] text-xs uppercase tracking-[0.16em]" href="/fun">
          <ArrowLeft size={13} />
          For fun / 02
        </Link>
        <h1 className="mt-6 font-[var(--font-serif)] text-5xl font-light leading-none sm:text-6xl">The Nonfiction Galaxy</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 muted">
          A map of prize-recognized nonfiction where nearby books use similar language to describe their subjects,
          people, places, and ideas.
        </p>
        <p className="mt-8 font-[var(--font-mono)] text-xs uppercase tracking-[0.16em] muted">Plotting 6,466 books…</p>
        <div className="mt-3 h-[58vh] min-h-[28rem] border hairline bg-[var(--panel)]" />
      </div>
    );
  }

  return <GalaxyExperience data={data} />;
}

function GalaxyExperience({ data }: { data: NonfictionGalaxyData }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const activeIndexRef = useRef<number | null>(null);
  const viewRef = useRef<ViewTransform>(DEFAULT_VIEW);
  const returnViewRef = useRef<ViewTransform>(DEFAULT_VIEW);
  const cameraFrameRef = useRef<number | null>(null);
  const [size, setSize] = useState<SurfaceSize>({ width: 0, height: 0, dpr: 1 });
  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [themeVersion, setThemeVersion] = useState(0);
  const selectedPoint = selectedIndex === null ? undefined : data.points[selectedIndex];
  const activePoint = activeIndex === null ? undefined : data.points[activeIndex];
  const normalizedQuery = normalizeSearch(query);
  const selectedSubjectIndex = subjectFilter === "all" ? null : Number(subjectFilter);

  const matchingIndices = useMemo(() => {
    if (normalizedQuery.length < 2) return null;
    const matches = new Set<number>();
    data.points.forEach((point, index) => {
      const subject = data.subjects[point.subjectIndex]?.name ?? "";
      if (normalizeSearch([point.title, point.author, point.primaryTopic, subject].filter(Boolean).join(" ")).includes(normalizedQuery)) {
        matches.add(index);
      }
    });
    return matches;
  }, [data.points, data.subjects, normalizedQuery]);

  const searchResults = useMemo(() => {
    if (!matchingIndices) return [];
    return [...matchingIndices]
      .filter((index) => selectedSubjectIndex === null || data.points[index].subjectIndex === selectedSubjectIndex)
      .sort((a, b) => compareSearchResults(data.points[a], data.points[b], normalizedQuery))
      .slice(0, 7);
  }, [data.points, matchingIndices, normalizedQuery, selectedSubjectIndex]);

  const nearbyIndices = useMemo(() => {
    if (selectedIndex === null) return [];
    const selected = data.points[selectedIndex];
    return data.points
      .map((point, index) => ({
        index,
        distance: index === selectedIndex ? Number.POSITIVE_INFINITY : Math.hypot(point.x - selected.x, point.y - selected.y),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6)
      .map((entry) => entry.index);
  }, [data.points, selectedIndex]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateSize = () => {
      const rect = viewport.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      setSize({ width: rect.width, height: rect.height, dpr });
      setView((current) => {
        const next = clampView(current, rect.width, rect.height);
        viewRef.current = next;
        return next;
      });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    updateSize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeVersion((version) => version + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;
    canvas.width = Math.max(1, Math.round(size.width * size.dpr));
    canvas.height = Math.max(1, Math.round(size.height * size.dpr));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    drawGalaxy({
      activeIndex,
      canvas,
      data,
      matchingIndices,
      nearbyIndices,
      selectedIndex,
      selectedSubjectIndex,
      size,
      view,
    });
  }, [activeIndex, data, matchingIndices, nearbyIndices, selectedIndex, selectedSubjectIndex, size, themeVersion, view]);

  useEffect(() => {
    if (selectedIndex === null || selectedSubjectIndex === null) return;
    if (data.points[selectedIndex].subjectIndex !== selectedSubjectIndex) clearSelection();
  }, [data.points, selectedIndex, selectedSubjectIndex]);

  useEffect(() => {
    selectActive(null);
  }, [subjectFilter]);

  function selectActive(index: number | null) {
    if (activeIndexRef.current === index) return;
    activeIndexRef.current = index;
    setActiveIndex(index);
  }

  function cancelCameraAnimation() {
    if (cameraFrameRef.current === null) return;
    cancelAnimationFrame(cameraFrameRef.current);
    cameraFrameRef.current = null;
  }

  function animateView(target: ViewTransform) {
    cancelCameraAnimation();
    const nextTarget = clampView(target, size.width, size.height);
    const start = viewRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      viewRef.current = nextTarget;
      setView(nextTarget);
      return;
    }

    const startedAt = performance.now();
    const drawFrame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / CAMERA_DURATION_MS);
      const eased = easeInOutCubic(progress);
      const next = {
        scale: interpolate(start.scale, nextTarget.scale, eased),
        x: interpolate(start.x, nextTarget.x, eased),
        y: interpolate(start.y, nextTarget.y, eased),
      };
      viewRef.current = next;
      setView(next);
      if (progress < 1) cameraFrameRef.current = requestAnimationFrame(drawFrame);
      else cameraFrameRef.current = null;
    };
    cameraFrameRef.current = requestAnimationFrame(drawFrame);
  }

  function zoomTo(requestedScale: number, clientX?: number, clientY?: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    cancelCameraAnimation();
    setView((current) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedScale));
      const pointX = (clientX ?? rect.left + rect.width / 2) - rect.left;
      const pointY = (clientY ?? rect.top + rect.height / 2) - rect.top;
      const ratio = nextScale / current.scale;
      const next = clampView({
        scale: nextScale,
        x: pointX - (pointX - current.x) * ratio,
        y: pointY - (pointY - current.y) * ratio,
      }, rect.width, rect.height);
      viewRef.current = next;
      return next;
    });
  }

  function resetView() {
    setSelectedIndex(null);
    selectActive(null);
    returnViewRef.current = DEFAULT_VIEW;
    animateView(DEFAULT_VIEW);
  }

  function clearSelection() {
    if (selectedIndex === null) return;
    setSelectedIndex(null);
    selectActive(null);
    animateView(returnViewRef.current);
  }

  function focusPoint(index: number) {
    if (!size.width || !size.height) return;
    const point = data.points[index];
    const position = pointPosition(point, size.width, size.height);
    if (selectedIndex === null) returnViewRef.current = viewRef.current;
    const nextScale = Math.max(SELECTION_SCALE, viewRef.current.scale);
    setSelectedIndex(index);
    selectActive(null);
    animateView({
      scale: nextScale,
      x: size.width / 2 - position.x * nextScale,
      y: size.height / 2 - position.y * nextScale,
    });
    setQuery("");
    viewportRef.current?.focus({ preventScroll: true });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) > 3) drag.moved = true;
      setView((current) => {
        const next = clampView({ ...current, x: drag.originX + deltaX, y: drag.originY + deltaY }, size.width, size.height);
        viewRef.current = next;
        return next;
      });
      selectActive(null);
      return;
    }
    if (event.pointerType === "touch") return;
    const index = pointIndexAtClientPosition(event.clientX, event.clientY);
    selectActive(index);
    positionTooltip(event.clientX, event.clientY, tooltipRef.current);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button") || event.button !== 0 || view.scale <= MIN_SCALE) return;
    cancelCameraAnimation();
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
    if ((event.target as HTMLElement).closest("button")) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const index = pointIndexAtClientPosition(event.clientX, event.clientY);
    if (index === null) clearSelection();
    else focusPoint(index);
  }

  function pointIndexAtClientPosition(clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const x = (clientX - rect.left - view.x) / view.scale;
    const y = (clientY - rect.top - view.y) / view.scale;
    const hitRadius = Math.max(4, 8 / Math.sqrt(view.scale));
    let closest: number | null = null;
    let closestDistance = hitRadius;
    data.points.forEach((point, index) => {
      if (selectedSubjectIndex !== null && point.subjectIndex !== selectedSubjectIndex) return;
      if (matchingIndices && !matchingIndices.has(index)) return;
      const position = pointPosition(point, size.width, size.height);
      const distance = Math.hypot(position.x - x, position.y - y);
      if (distance < closestDistance) {
        closest = index;
        closestDistance = distance;
      }
    });
    return closest;
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    cancelCameraAnimation();
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomTo(view.scale * Math.exp(-event.deltaY * 0.012), event.clientX, event.clientY);
      return;
    }
    if (view.scale <= MIN_SCALE) return;
    event.preventDefault();
    setView((current) => clampView({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }, size.width, size.height));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomTo(view.scale * ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomTo(view.scale / ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      resetView();
    } else if (event.key === "Escape") {
      clearSelection();
    } else if (event.key === "Enter" && selectedPoint) {
      event.preventDefault();
      router.push(`/books/${selectedPoint.slug}`);
    }
  }

  const subjectName = selectedPoint ? data.subjects[selectedPoint.subjectIndex]?.name : undefined;

  return (
    <main className="galaxy-page mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <header className="galaxy-page-header grid gap-8 border-b hairline pb-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-end">
        <div>
          <Link className="focus-ring inline-flex items-center gap-2 font-[var(--font-mono)] text-xs uppercase tracking-[0.16em]" href="/fun">
            <ArrowLeft size={13} />
            For fun / 02
          </Link>
          <h1 className="mt-5 max-w-3xl font-[var(--font-serif)] text-5xl font-light leading-[0.98] tracking-[-0.03em] sm:text-6xl">
            The Nonfiction Galaxy
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 muted">
            A map of prize-recognized nonfiction where nearby books use similar language to describe their subjects,
            people, places, and ideas.
          </p>
        </div>
        <EntityMetricGrid
          items={[
            { label: "Books", value: data.count.toLocaleString("en-US") },
            { label: "Dimensions", value: data.dimensions },
            { label: "Projection", value: data.projection.algorithm },
          ]}
        />
      </header>

      <div className="galaxy-layout py-8">
        <section className="galaxy-map-panel" aria-label="Interactive semantic map">
          <div className="galaxy-toolbar filter-toolbar">
            <div className="galaxy-search-wrap">
              <div className="subjects-search subject-detail-search focus-within:border-[var(--ink)]">
                <Search aria-hidden="true" className="muted" size={16} />
                <input
                  aria-label="Find a book in the galaxy"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--muted)]"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a title, author, or idea"
                  type="search"
                  value={query}
                />
              </div>
              {normalizedQuery.length >= 2 ? (
                <div className="galaxy-search-results" role="listbox" aria-label="Matching books">
                  {searchResults.length ? searchResults.map((index) => {
                    const point = data.points[index];
                    return (
                      <button aria-selected="false" className="focus-ring" key={point.bookId} onClick={() => focusPoint(index)} role="option" type="button">
                        <span>{point.title}</span>
                        <small>{[point.author, point.publicationYear].filter(Boolean).join(" · ")}</small>
                      </button>
                    );
                  }) : <p>No matching books in this view.</p>}
                </div>
              ) : null}
            </div>
            <select
              aria-label="Filter the galaxy by subject"
              className="filter-select focus-ring"
              onChange={(event) => setSubjectFilter(event.target.value)}
              value={subjectFilter}
            >
              <option value="all">All subjects</option>
              {data.subjects.map((subject, index) => (
                <option key={subject.name} value={index}>{subject.name} ({subject.count.toLocaleString("en-US")})</option>
              ))}
            </select>
          </div>

          <div
            aria-describedby="galaxy-instructions"
            aria-label={`Semantic map of ${data.count.toLocaleString("en-US")} nonfiction books`}
            className={`galaxy-viewport focus-ring ${view.scale > MIN_SCALE ? "is-zoomed" : ""} ${isPanning ? "is-panning" : ""}`}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            onPointerCancel={finishPointerPan}
            onPointerDown={handlePointerDown}
            onPointerLeave={() => {
              if (!dragRef.current) selectActive(null);
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerPan}
            onWheel={handleWheel}
            ref={viewportRef}
            role="application"
            tabIndex={0}
          >
            <canvas aria-hidden="true" ref={canvasRef} />
            <p className="galaxy-map-key" id="galaxy-instructions">
              <span className="galaxy-desktop-instructions">Hover to identify · click to explore · larger dots are major-prize winners · pinch or ⌘-scroll to zoom</span>
              <span className="galaxy-mobile-instructions">Tap to explore · larger dots are major-prize winners · use +/− to zoom</span>
            </p>
            <div aria-label="Galaxy zoom controls" className="galaxy-controls" role="group">
              <button aria-label="Zoom out" className="focus-ring" disabled={view.scale <= MIN_SCALE} onClick={() => zoomTo(view.scale / ZOOM_STEP)} type="button">
                <Minus aria-hidden="true" size={16} />
              </button>
              <span aria-live="polite" className="galaxy-zoom-readout plain-number">{Math.round(view.scale * 100)}%</span>
              <button aria-label="Zoom in" className="focus-ring" disabled={view.scale >= MAX_SCALE} onClick={() => zoomTo(view.scale * ZOOM_STEP)} type="button">
                <Plus aria-hidden="true" size={16} />
              </button>
              <button aria-label="Reset map" className="focus-ring" disabled={view.scale === MIN_SCALE && selectedIndex === null} onClick={resetView} type="button">
                <RotateCcw aria-hidden="true" size={14} />
              </button>
            </div>
            <div aria-live="polite" className={`galaxy-tooltip ${activePoint ? "is-visible" : ""}`} ref={tooltipRef}>
              {activePoint ? (
                <>
                  <span className="galaxy-tooltip-dot" style={{ backgroundColor: `var(${SUBJECT_COLOR_VARIABLES[activePoint.subjectIndex % SUBJECT_COLOR_VARIABLES.length]})` }} />
                  <div>
                    <p>{activePoint.title}</p>
                    <p className="mt-1 text-xs muted">{activePoint.author}</p>
                    <p className="mt-2 font-[var(--font-mono)] text-[0.6rem] uppercase tracking-[0.1em] muted">
                      {[activePoint.publicationYear, data.subjects[activePoint.subjectIndex]?.name].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="galaxy-rail" aria-label="Map details">
          {selectedPoint ? (
            <div className="galaxy-selection">
              <div className="flex items-start justify-between gap-4">
                <p className="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.15em] muted">Selected book</p>
                <button aria-label="Clear selected book and return to the overview" className="focus-ring galaxy-clear-selection" onClick={clearSelection} type="button">
                  <X size={14} />
                </button>
              </div>
              <div className="galaxy-selection-book">
                {selectedPoint.thumbnailUrl ? <img alt="" src={selectedPoint.thumbnailUrl} /> : null}
                <div className="min-w-0">
                  <h2 className="font-[var(--font-serif)] text-2xl font-light leading-tight">{selectedPoint.title}</h2>
                  <p className="mt-2 text-sm muted">{selectedPoint.author}</p>
                  <p className="mt-4 font-[var(--font-mono)] text-[0.62rem] uppercase leading-5 tracking-[0.1em] muted">
                    {[selectedPoint.publicationYear, subjectName, selectedPoint.primaryTopic].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>
              <Link className="focus-ring galaxy-open-book" href={`/books/${selectedPoint.slug}`}>
                Open book <ArrowUpRight size={14} />
              </Link>

              <div className="galaxy-nearby">
                <h3 className="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.15em] muted">Nearby on the map</h3>
                <div className="mt-3 grid">
                  {nearbyIndices.map((index) => {
                    const point = data.points[index];
                    return (
                      <button className="focus-ring" key={point.bookId} onClick={() => focusPoint(index)} type="button">
                        <span>{point.title}</span>
                        <small>{point.author}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="galaxy-reading-note">
              <p className="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.15em] muted">Reading the map</p>
              <h2 className="mt-4 font-[var(--font-serif)] text-2xl font-light">Ideas form the neighborhoods.</h2>
              <p className="mt-4 text-sm leading-6 muted">
                Each point is a book. Distance reflects similarity in the project’s semantic index; color shows the
                book’s primary subject, and larger points mark winners of a major prize. Select any point to inspect its
                nearest neighbors on this two-dimensional map.
              </p>
            </div>
          )}

          <div className="galaxy-subject-legend">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.15em] muted">Subjects</h3>
              {subjectFilter !== "all" ? <button className="focus-ring text-xs muted" onClick={() => setSubjectFilter("all")} type="button">Show all</button> : null}
            </div>
            <div className="mt-3 grid">
              {data.subjects.map((subject, index) => (
                <button
                  aria-pressed={subjectFilter === String(index)}
                  className="focus-ring galaxy-subject-row"
                  key={subject.name}
                  onClick={() => setSubjectFilter(subjectFilter === String(index) ? "all" : String(index))}
                  type="button"
                >
                  <span className="galaxy-subject-swatch" style={{ backgroundColor: `var(${SUBJECT_COLOR_VARIABLES[index % SUBJECT_COLOR_VARIABLES.length]})` }} />
                  <span>{subject.name}</span>
                  <span className="plain-number muted">{subject.count.toLocaleString("en-US")}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <section className="galaxy-method border-t hairline py-8">
        <p className="font-[var(--font-mono)] text-[0.65rem] uppercase tracking-[0.15em] muted">How it was made</p>
        <p className="mt-3 max-w-4xl text-sm leading-6 muted">
          The existing {data.dimensions}-dimensional book embeddings were reduced to two dimensions with an unsupervised
          UMAP projection using cosine distance. Subject categories are added afterward for color and labels; they do not
          determine placement. Any two-dimensional projection distorts some relationships, so proximity is suggestive rather than definitive.
        </p>
      </section>
    </main>
  );
}

function drawGalaxy({
  activeIndex,
  canvas,
  data,
  matchingIndices,
  nearbyIndices,
  selectedIndex,
  selectedSubjectIndex,
  size,
  view,
}: {
  activeIndex: number | null;
  canvas: HTMLCanvasElement;
  data: NonfictionGalaxyData;
  matchingIndices: Set<number> | null;
  nearbyIndices: number[];
  selectedIndex: number | null;
  selectedSubjectIndex: number | null;
  size: SurfaceSize;
  view: ViewTransform;
}) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const styles = getComputedStyle(document.documentElement);
  const palette = SUBJECT_COLOR_VARIABLES.map((variable) => styles.getPropertyValue(variable).trim());
  const panel = styles.getPropertyValue("--panel").trim();
  const line = styles.getPropertyValue("--line").trim();
  const ink = styles.getPropertyValue("--ink").trim();
  const muted = styles.getPropertyValue("--muted").trim();
  context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  context.clearRect(0, 0, size.width, size.height);
  context.fillStyle = panel;
  context.fillRect(0, 0, size.width, size.height);

  context.save();
  context.translate(view.x, view.y);
  context.scale(view.scale, view.scale);
  context.strokeStyle = line;
  context.lineWidth = 1 / view.scale;
  context.globalAlpha = 0.42;
  for (let index = 1; index < 4; index += 1) {
    const x = (size.width * index) / 4;
    const y = (size.height * index) / 4;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, size.height);
    context.moveTo(0, y);
    context.lineTo(size.width, y);
    context.stroke();
  }
  context.restore();

  const quietPoints: number[] = [];
  const highlightedPoints: number[] = [];
  data.points.forEach((point, index) => {
    const subjectMatches = selectedSubjectIndex === null || point.subjectIndex === selectedSubjectIndex;
    const searchMatches = !matchingIndices || matchingIndices.has(index);
    if (subjectMatches && searchMatches) highlightedPoints.push(index);
    else quietPoints.push(index);
  });
  drawPoints(context, data, quietPoints, palette, size, view, 0.055);
  drawPoints(context, data, highlightedPoints, palette, size, view, matchingIndices || selectedSubjectIndex !== null ? 0.88 : 0.64);
  if (selectedIndex === null) drawSubjectLabels(context, data, selectedSubjectIndex, panel, ink, muted, size, view);
  else drawNearbyBookLabels(context, data, selectedIndex, nearbyIndices, panel, ink, line, size, view);

  const emphasis = selectedIndex ?? activeIndex;
  if (emphasis !== null) {
    const point = data.points[emphasis];
    const position = transformedPointPosition(point, size, view);
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(position.x, position.y, selectedIndex === emphasis ? 6 : 4.5, 0, Math.PI * 2);
    context.fillStyle = palette[point.subjectIndex % palette.length] || ink;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = panel;
    context.stroke();
    context.beginPath();
    context.arc(position.x, position.y, selectedIndex === emphasis ? 8 : 6.5, 0, Math.PI * 2);
    context.lineWidth = 1;
    context.strokeStyle = ink;
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawPoints(
  context: CanvasRenderingContext2D,
  data: NonfictionGalaxyData,
  indices: number[],
  palette: string[],
  size: SurfaceSize,
  view: ViewTransform,
  alpha: number,
) {
  context.globalAlpha = alpha;
  for (const index of indices) {
    const point = data.points[index];
    const position = transformedPointPosition(point, size, view);
    if (position.x < -5 || position.y < -5 || position.x > size.width + 5 || position.y > size.height + 5) continue;
    const radius = point.isMajorWinner ? MAJOR_WINNER_POINT_RADIUS : STANDARD_POINT_RADIUS;
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.fillStyle = palette[point.subjectIndex % palette.length];
    context.fill();
  }
}

function drawSubjectLabels(
  context: CanvasRenderingContext2D,
  data: NonfictionGalaxyData,
  selectedSubjectIndex: number | null,
  panel: string,
  ink: string,
  muted: string,
  size: SurfaceSize,
  view: ViewTransform,
) {
  const candidates = data.subjects
    .map((subject, index) => ({ subject, index }))
    .filter(({ index }) => selectedSubjectIndex === null || selectedSubjectIndex === index)
    .slice(0, view.scale < 1.8 ? 12 : data.subjects.length);
  const boxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (const { subject } of candidates) {
    const position = transformedPointPosition(subject, size, view);
    if (position.x < 55 || position.x > size.width - 55 || position.y < 18 || position.y > size.height - 18) continue;
    const label = subject.name.toUpperCase();
    const width = Math.min(180, context.measureText(label).width + 14);
    const box = { left: position.x - width / 2, right: position.x + width / 2, top: position.y - 10, bottom: position.y + 10 };
    if (boxes.some((other) => boxesOverlap(box, other))) continue;
    boxes.push(box);
    context.globalAlpha = 0.84;
    context.fillStyle = panel;
    context.fillRect(box.left, box.top, width, 20);
    context.strokeStyle = muted;
    context.lineWidth = 0.5;
    context.strokeRect(box.left, box.top, width, 20);
    context.globalAlpha = 0.9;
    context.fillStyle = ink;
    context.fillText(label, position.x, position.y + 0.5, width - 8);
  }
}

function drawNearbyBookLabels(
  context: CanvasRenderingContext2D,
  data: NonfictionGalaxyData,
  selectedIndex: number,
  nearbyIndices: number[],
  panel: string,
  ink: string,
  line: string,
  size: SurfaceSize,
  view: ViewTransform,
) {
  const reveal = Math.min(1, Math.max(0, (view.scale - 2.1) / 0.9));
  if (!reveal) return;
  const selectedPosition = transformedPointPosition(data.points[selectedIndex], size, view);
  const boxes: Array<{ left: number; right: number; top: number; bottom: number }> = [{
    left: selectedPosition.x - 16,
    right: selectedPosition.x + 16,
    top: selectedPosition.y - 16,
    bottom: selectedPosition.y + 16,
  }];
  const labelHeight = 20;
  const maxTextWidth = Math.min(178, Math.max(116, size.width * 0.22));

  for (const index of nearbyIndices) {
    const point = data.points[index];
    const position = transformedPointPosition(point, size, view);
    if (position.x < 8 || position.x > size.width - 8 || position.y < 8 || position.y > size.height - 8) continue;

    context.font = `${point.isMajorWinner ? 600 : 500} 10px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const label = fitCanvasLabel(context, point.title, maxTextWidth);
    const width = Math.ceil(context.measureText(label).width) + 14;
    const placements = [
      { left: position.x + 9, top: position.y - labelHeight / 2 },
      { left: position.x - width - 9, top: position.y - labelHeight / 2 },
      { left: position.x - width / 2, top: position.y - labelHeight - 9 },
      { left: position.x - width / 2, top: position.y + 9 },
    ];
    const placement = placements.find(({ left, top }) => {
      const box = { left, right: left + width, top, bottom: top + labelHeight };
      return box.left >= 7
        && box.right <= size.width - 7
        && box.top >= 7
        && box.bottom <= size.height - 7
        && !boxes.some((other) => boxesOverlap(box, other));
    });
    if (!placement) continue;

    const box = {
      left: placement.left,
      right: placement.left + width,
      top: placement.top,
      bottom: placement.top + labelHeight,
    };
    boxes.push(box);
    context.globalAlpha = 0.92 * reveal;
    context.fillStyle = panel;
    context.fillRect(box.left, box.top, width, labelHeight);
    context.globalAlpha = 0.72 * reveal;
    context.strokeStyle = line;
    context.lineWidth = 1;
    context.strokeRect(box.left + 0.5, box.top + 0.5, width - 1, labelHeight - 1);
    context.globalAlpha = 0.92 * reveal;
    context.fillStyle = ink;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(label, box.left + 7, box.top + labelHeight / 2 + 0.5);
  }
}

function transformedPointPosition(point: { x: number; y: number }, size: SurfaceSize, view: ViewTransform) {
  const position = pointPosition(point, size.width, size.height);
  return { x: position.x * view.scale + view.x, y: position.y * view.scale + view.y };
}

function pointPosition(point: { x: number; y: number }, width: number, height: number) {
  const padding = Math.min(72, Math.max(30, Math.min(width, height) * 0.065));
  const extent = Math.max(1, Math.min(width, height) - padding * 2);
  const left = (width - extent) / 2;
  const top = (height - extent) / 2;
  return {
    x: left + point.x * extent,
    y: top + point.y * extent,
  };
}

function compareSearchResults(a: NonfictionGalaxyPoint, b: NonfictionGalaxyPoint, query: string) {
  const titleA = normalizeSearch(a.title);
  const titleB = normalizeSearch(b.title);
  const prefixA = titleA.startsWith(query) ? 1 : 0;
  const prefixB = titleB.startsWith(query) ? 1 : 0;
  return prefixB - prefixA || b.recognitionScore - a.recognitionScore || a.title.localeCompare(b.title);
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fitCanvasLabel(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let low = 1;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${value.slice(0, middle).trimEnd()}…`).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low).trimEnd()}…`;
}

function boxesOverlap(a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) {
  return a.left < b.right + 6 && a.right + 6 > b.left && a.top < b.bottom + 4 && a.bottom + 4 > b.top;
}

function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function positionTooltip(clientX: number, clientY: number, tooltip: HTMLDivElement | null) {
  if (!tooltip) return;
  const width = 300;
  const height = 112;
  const left = Math.max(12, Math.min(clientX + 16, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(clientY + 16, window.innerHeight - height - 12));
  tooltip.style.transform = `translate3d(${left}px, ${top}px, 0)`;
}

function clampView(view: ViewTransform, width: number, height: number): ViewTransform {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  return {
    scale,
    x: Math.min(0, Math.max(width - width * scale, view.x)),
    y: Math.min(0, Math.max(height - height * scale, view.y)),
  };
}
