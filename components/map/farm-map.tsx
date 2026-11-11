"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useActionState, useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Marker } from "maplibre-gl";
import { addBinAction, type AddBinState } from "@/app/bins/actions";
import { Button } from "@/components/ui/button";
import { MAX_BIN_NAME_LENGTH, typedNumber, type SavedBin } from "@/lib/bins/add-bin";
import type { MapField } from "@/lib/db/farm-map";
import { formatDecimal, formatWholeBushels } from "@/lib/format";
import { boundsOf, outlineCenter, type LonLat } from "@/lib/map/geometry";
import { binCapacityBushels, binSizeProblem } from "@/lib/rules/bin-capacity";
import { cn } from "@/lib/utils";

type MapLibre = typeof import("maplibre-gl");

/** Esri World Imagery: free to show on screen with this credit, and needs no key. */
const IMAGERY_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const IMAGERY_CREDIT = "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/** Shown when the farm has nothing on the map yet: the lower 48 states. */
const WHOLE_COUNTRY = { center: [-96, 39.5] as LonLat, zoom: 3.6 };
/** Close enough to see fields whole. */
const FARM_ZOOM = 16.5;
/** Close enough to tell one bin from the next. */
const FARMSTEAD_ZOOM = 18;

const IDLE: AddBinState = { status: "idle" };

/** A color from docs/design.md, read from the page so no hex value lives in a screen. */
const designColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function labelElement(className: string, title: string, detail: string | null): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  const strong = document.createElement("span");
  strong.className = "font-semibold text-ink";
  strong.textContent = title;
  el.append(strong);
  if (detail) {
    const rest = document.createElement("span");
    rest.className = "text-ink-muted tabular-nums";
    rest.textContent = detail;
    el.append(rest);
  }
  return el;
}

const LABEL = "pointer-events-none flex items-baseline gap-1.5 whitespace-nowrap rounded-md bg-card/95 px-2 py-0.5 text-xs shadow-card";

function binElement(bin: SavedBin, labelAbove: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = cn("pointer-events-none flex items-center gap-1", labelAbove ? "flex-col-reverse" : "flex-col");
  const dot = document.createElement("span");
  dot.className = "size-4 rounded-full border-2 border-white bg-green-700 shadow-card";
  el.append(dot, labelElement(LABEL, bin.name, `${formatWholeBushels(bin.capacityBu)} bu`));
  return el;
}

function spotElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "pointer-events-none size-5 rounded-full border-2 border-white bg-yellow-400 shadow-card";
  return el;
}

/**
 * The farm map: satellite imagery with the farm's fields outlined and its
 * bins marked, and the one thing the farmer does here, adding a bin
 * (docs/spec.md Part 11, docs/design.md).
 *
 * He clicks "Add a bin", clicks the spot where it stands, and enters its
 * diameter and eave height in the panel beside the map. Both are required and
 * neither has a default. The capacity shows as he types; the saved figure is
 * the one the database calculates.
 */
export function FarmMap({ bins, fields, nextBinName }: { bins: SavedBin[]; fields: MapField[]; nextBinName: string }) {
  const [state, submit, pending] = useActionState(addBinAction, IDLE);
  /** The last answer from the server the farmer has moved on from. */
  const [seen, setSeen] = useState<AddBinState>(IDLE);
  const [placing, setPlacing] = useState(false);
  const [spot, setSpot] = useState<LonLat | null>(null);
  const [mapProblem, setMapProblem] = useState(false);
  const [ready, setReady] = useState(false);

  const container = useRef<HTMLDivElement>(null);
  const lib = useRef<MapLibre | null>(null);
  const map = useRef<MapLibreMap | null>(null);

  // A bin that was just saved ends the adding, and shows until the farmer starts another.
  const justSaved = state.status === "saved" && state !== seen ? state.bin : null;
  const adding = placing && !justSaved;
  const pin = adding ? spot : null;
  const problem = state.status === "problem" && state !== seen ? state : null;
  // The saved bin shows at once; the list from the server catches up a moment later.
  const shownBins = justSaved && !bins.some((bin) => bin.id === justSaved.id) ? [...bins, justSaved] : bins;

  // What the map opens on: decided once, from what the farm has when the screen loads.
  const opening = useRef({ bins, fields });

  useEffect(() => {
    let closed = false;
    let created: MapLibreMap | null = null;

    void (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (closed || !container.current) return;
        // MapLibre draws on a worker thread and can't find its worker script once bundled; this points it there.
        maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

        const farm = opening.current;
        const bounds = boundsOf([
          ...farm.bins.map((bin) => [bin.longitude, bin.latitude]),
          ...farm.fields.flatMap((field) => field.outline[0]),
        ]);
        created = new maplibre.Map({
          container: container.current,
          style: {
            version: 8,
            sources: {
              imagery: { type: "raster", tiles: [IMAGERY_TILES], tileSize: 256, maxzoom: 19, attribution: IMAGERY_CREDIT },
            },
            layers: [{ id: "imagery", type: "raster", source: "imagery" }],
          },
          ...(bounds ? { bounds, fitBoundsOptions: { padding: 72, maxZoom: FARM_ZOOM } } : WHOLE_COUNTRY),
          maxZoom: 20,
          // Tilting and turning the map only makes a spot harder to click.
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        created.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        created.addControl(new maplibre.ScaleControl({ unit: "imperial" }), "bottom-left");
        created.on("load", () => {
          if (closed || !created) return;
          created.addSource("fields", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          created.addLayer({
            id: "fields-fill",
            type: "fill",
            source: "fields",
            paint: { "fill-color": designColor("--green-100"), "fill-opacity": 0.22 },
          });
          created.addLayer({
            id: "fields-line",
            type: "line",
            source: "fields",
            paint: { "line-color": designColor("--green-500"), "line-width": 2.5 },
          });
          lib.current = maplibre;
          map.current = created;
          setReady(true);
        });
      } catch (error) {
        console.error("The farm map couldn't start:", error);
        if (!closed) setMapProblem(true);
      }
    })();

    return () => {
      closed = true;
      created?.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  // Fields: translucent outlines, each with its name and acres.
  useEffect(() => {
    if (!ready || !map.current || !lib.current) return;
    const source = map.current.getSource<GeoJSONSource>("fields");
    source?.setData({
      type: "FeatureCollection",
      features: fields.map((field) => ({
        type: "Feature",
        id: field.id,
        properties: { name: field.name },
        geometry: { type: "Polygon", coordinates: field.outline },
      })),
    });
    const labels = fields.map((field) =>
      new lib.current!.Marker({
        element: labelElement(LABEL, field.name, field.acres === null ? null : `${field.acres.toFixed(2)} ac`),
      })
        .setLngLat(outlineCenter(field.outline[0]))
        .addTo(map.current!),
    );
    return () => labels.forEach((label) => label.remove());
  }, [ready, fields]);

  // Bins: a dot at each one, with its name and capacity. Going north to south, labels take turns above and
  // below their dots, so two bins standing side by side never have their labels between them.
  useEffect(() => {
    if (!ready || !map.current || !lib.current) return;
    const northToSouth = [...shownBins].sort((a, b) => b.latitude - a.latitude || a.longitude - b.longitude);
    const markers = northToSouth.map((bin, i) => {
      const labelAbove = i % 2 === 0;
      return new lib.current!.Marker({
        element: binElement(bin, labelAbove),
        anchor: labelAbove ? "bottom" : "top",
        // Half the dot, so the dot's middle sits on the bin.
        offset: [0, labelAbove ? 8 : -8],
      })
        .setLngLat([bin.longitude, bin.latitude])
        .addTo(map.current!);
    });
    return () => markers.forEach((marker) => marker.remove());
    // The bins are compared by what they show, so a new list with the same bins doesn't redraw them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shownBins.map((bin) => `${bin.id}:${bin.name}:${bin.capacityBu}`).join("|")]);

  // While a bin is being added, a click on the map is where it stands. Clicking again moves it.
  useEffect(() => {
    if (!ready || !map.current || !adding) return;
    const current = map.current;
    const onClick = (event: MapMouseEvent) => setSpot([event.lngLat.lng, event.lngLat.lat]);
    current.on("click", onClick);
    current.getCanvas().style.cursor = "crosshair";
    return () => {
      current.off("click", onClick);
      current.getCanvas().style.cursor = "";
    };
  }, [ready, adding]);

  // The pin at the chosen spot.
  useEffect(() => {
    if (!ready || !map.current || !lib.current || !pin) return;
    const marker: Marker = new lib.current.Marker({ element: spotElement() }).setLngLat(pin).addTo(map.current);
    return () => void marker.remove();
  }, [ready, pin]);

  function startAdding() {
    setSeen(state);
    setSpot(null);
    setPlacing(true);
    // A new bin usually stands beside the others, so go there if the map is zoomed out.
    const current = map.current;
    const farmstead = boundsOf(shownBins.map((bin) => [bin.longitude, bin.latitude]));
    if (current && farmstead && current.getZoom() < FARMSTEAD_ZOOM - 0.5) {
      current.fitBounds(farmstead, { padding: 160, maxZoom: FARMSTEAD_ZOOM, duration: 700 });
    }
  }

  function stopAdding() {
    setSeen(state);
    setSpot(null);
    setPlacing(false);
  }

  return (
    <div className="relative min-h-[32rem] flex-1">
      {/* MapLibre makes its own element position: relative, so the element that fills the panel is this one around it. */}
      <div className="absolute inset-0">
        <div ref={container} className="size-full" aria-label="Satellite map of your farm" role="application" />
      </div>

      {mapProblem ? (
        <p className="absolute inset-0 flex items-center justify-center bg-green-100 p-6 text-center text-base text-ink">
          The map can&apos;t be shown right now. Check the internet connection and reload the page.
        </p>
      ) : null}

      <div className="absolute top-4 left-4 flex w-80 flex-col gap-3">
        {!adding ? (
          <Button
            variant="outline"
            onClick={startAdding}
            disabled={!ready}
            className="h-12 self-start rounded-xl bg-card px-5 text-base font-semibold shadow-card"
          >
            Add a bin
          </Button>
        ) : null}

        {justSaved ? (
          <p role="status" className="rounded-xl bg-green-100 px-4 py-3 text-base text-ink shadow-card ring-1 ring-line">
            <span className="font-semibold">{justSaved.name} added.</span> It holds about{" "}
            {formatWholeBushels(justSaved.capacityBu)} bushels.
          </p>
        ) : null}

        {adding && !spot ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-line">
            <p role="status" className="text-base font-semibold text-ink">
              Click the spot where the bin stands.
            </p>
            <Button variant="outline" onClick={stopAdding} className="h-11 self-start rounded-xl bg-card px-4 text-base">
              Cancel
            </Button>
          </div>
        ) : null}

        {adding && spot ? (
          <BinForm
            spot={spot}
            suggestedName={nextBinName}
            submit={submit}
            pending={pending}
            problem={problem}
            onCancel={stopAdding}
          />
        ) : null}
      </div>
    </div>
  );
}

const INPUT =
  "h-12 w-full rounded-xl border border-line bg-card px-3 text-base text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-yellow-400 aria-invalid:bg-yellow-100";

/**
 * The panel beside the map: the bin's name and its two sizes. The name starts
 * as the next number and is selected, so typing replaces it. Enter saves.
 */
function BinForm({
  spot,
  suggestedName,
  submit,
  pending,
  problem,
  onCancel,
}: {
  spot: LonLat;
  suggestedName: string;
  submit: (formData: FormData) => void;
  pending: boolean;
  problem: Extract<AddBinState, { status: "problem" }> | null;
  onCancel: () => void;
}) {
  const [name, setName] = useState(suggestedName);
  const [diameter, setDiameter] = useState("");
  const [eaveHeight, setEaveHeight] = useState("");
  const nameBox = useRef<HTMLInputElement>(null);

  // The panel opens ready to type in: the offered name is selected.
  useEffect(() => {
    nameBox.current?.focus();
    nameBox.current?.select();
  }, []);

  const [diameterFt, eaveHeightFt] = [typedNumber(diameter), typedNumber(eaveHeight)];
  const sizesAreRight =
    diameterFt !== null &&
    eaveHeightFt !== null &&
    binSizeProblem("diameter", diameterFt) === null &&
    binSizeProblem("eave_height", eaveHeightFt) === null;
  const capacity = sizesAreRight ? binCapacityBushels(diameterFt, eaveHeightFt) : null;

  return (
    <form
      action={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      className="flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-card ring-1 ring-line"
    >
      <h2 className="text-lg font-semibold text-ink">New bin</h2>
      <input type="hidden" name="longitude" value={spot[0]} />
      <input type="hidden" name="latitude" value={spot[1]} />

      <label className="flex flex-col gap-1 text-sm font-medium text-ink">
        Name
        <input
          ref={nameBox}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_BIN_NAME_LENGTH}
          autoComplete="off"
          aria-invalid={problem?.field === "name" || undefined}
          className={INPUT}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Diameter (ft)
          <input
            name="diameter_ft"
            value={diameter}
            onChange={(event) => setDiameter(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={problem?.field === "diameter" || undefined}
            className={cn(INPUT, "tabular-nums")}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Eave height (ft)
          <input
            name="eave_height_ft"
            value={eaveHeight}
            onChange={(event) => setEaveHeight(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={problem?.field === "eave_height" || undefined}
            className={cn(INPUT, "tabular-nums")}
          />
        </label>
      </div>

      <p className="text-base text-ink" aria-live="polite">
        {capacity === null ? (
          <span className="text-ink-muted">Its capacity shows here once both sizes are in.</span>
        ) : (
          <>
            Holds about{" "}
            <span className="font-heading text-2xl font-semibold tabular-nums">{formatWholeBushels(capacity)}</span> bu
            <span className="sr-only">
              , from {formatDecimal(diameterFt!)} feet across and {formatDecimal(eaveHeightFt!)} feet to the eave
            </span>
          </>
        )}
      </p>

      {problem ? (
        <p role="alert" className="rounded-xl bg-yellow-100 px-4 py-3 text-base text-ink">
          {problem.message}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={pending} className="h-12 flex-1 rounded-xl text-base font-semibold">
          {pending ? "Saving…" : "Save bin"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending} className="h-12 rounded-xl bg-card px-4 text-base">
          Cancel
        </Button>
      </div>
      <p className="text-sm text-ink-muted">Click the map again to move the spot.</p>
    </form>
  );
}
