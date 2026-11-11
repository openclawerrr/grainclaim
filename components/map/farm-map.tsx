"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Marker } from "maplibre-gl";
import { addBinAction, type AddBinState } from "@/app/bins/actions";
import { confirmFieldsAction, readFsaMapAction, type ConfirmFieldsState, type ReadFsaMapState } from "@/app/fields/actions";
import { Button } from "@/components/ui/button";
import { MAX_BIN_NAME_LENGTH, typedNumber, type SavedBin } from "@/lib/bins/add-bin";
import type { MapField } from "@/lib/db/farm-map";
import { formatAcres, formatDecimal, formatWholeBushels } from "@/lib/format";
import { boundsOf, outlineCenter, type LonLat } from "@/lib/map/geometry";
import { binCapacityBushels, binSizeProblem } from "@/lib/rules/bin-capacity";
import { listOf } from "@/lib/rules/document-checks";
import { cn } from "@/lib/utils";
import { ChooseFsaMap, fsaNumbers, ReviewProposedFields } from "./fields-from-fsa-map";

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
const NOT_READ: ReadFsaMapState = { status: "idle" };
const NOT_CONFIRMED: ConfirmFieldsState = { status: "idle" };
/** The room the panel of proposed fields takes at the map's left edge, in pixels, so the outlines are shown beside it. */
const REVIEW_PANEL_ROOM = 424;
const NO_OUTLINES = { type: "FeatureCollection" as const, features: [] };

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
 * bins marked, and the two things the farmer does here (docs/spec.md Part 11,
 * docs/design.md).
 *
 * Adding fields: he clicks "Add fields from FSA map", chooses the photo of
 * his FSA map and clicks roughly where his farm is. The fields read from the
 * map come back paired with outlines, drawn dashed with their FSA numbers and
 * acres. He names them in the panel beside the map and confirms; only then
 * are they fields, drawn solid.
 *
 * Adding a bin: he clicks "Add a bin", clicks the spot where it stands, and
 * enters its diameter and eave height in the panel. Both are required and
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

  // Fields from the FSA map.
  const [read, submitRead, reading] = useActionState(readFsaMapAction, NOT_READ);
  const [confirmed, submitConfirm, confirming] = useActionState(confirmFieldsAction, NOT_CONFIRMED);
  /** The last answers from the server the farmer has moved on from. */
  const [seenRead, setSeenRead] = useState<ReadFsaMapState>(NOT_READ);
  const [seenConfirm, setSeenConfirm] = useState<ConfirmFieldsState>(NOT_CONFIRMED);
  const [addingFields, setAddingFields] = useState(false);
  const [farmSpot, setFarmSpot] = useState<LonLat | null>(null);
  /** The proposed outline he last clicked, numbered so clicking the same one twice counts twice. */
  const [picked, setPicked] = useState<{ key: string; at: number } | null>(null);

  const container = useRef<HTMLDivElement>(null);
  const lib = useRef<MapLibre | null>(null);
  const map = useRef<MapLibreMap | null>(null);

  // A bin that was just saved ends the adding, and shows until the farmer starts another.
  const justSaved = state.status === "saved" && state !== seen ? state.bin : null;
  const adding = placing && !justSaved;

  // Fields that were just saved end the adding, and are named until the farmer starts something else.
  const fieldsSaved = confirmed.status === "saved" && confirmed !== seenConfirm ? confirmed : null;
  const fieldsOpen = addingFields && !fieldsSaved;
  const readAnswer = read !== seenRead ? read : NOT_READ;
  /** The fields his map would add, waiting for him to confirm. */
  const proposed = fieldsOpen && readAnswer.status === "ready" ? readAnswer : null;
  const choosingFsaMap = fieldsOpen && !proposed;
  const readProblems = choosingFsaMap && readAnswer.status === "problem" ? readAnswer.messages : null;
  const confirmProblem = proposed && confirmed.status === "problem" && confirmed !== seenConfirm ? confirmed : null;
  // The saved fields show at once; the list from the server catches up a moment later.
  const shownFields = useMemo(() => {
    const added = fieldsSaved?.fields.filter((field) => !fields.some((have) => have.id === field.id)) ?? [];
    return added.length > 0 ? [...fields, ...added] : fields;
  }, [fields, fieldsSaved]);

  /** What a click on the map means right now. */
  const picking = adding ? "bin" : choosingFsaMap && !reading ? "farm" : null;
  const pin = adding ? spot : choosingFsaMap ? farmSpot : null;
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
          // Outlines proposed from the FSA map: dashed, because they aren't fields until the farmer confirms them.
          created.addSource("proposals", { type: "geojson", data: NO_OUTLINES });
          created.addLayer({
            id: "proposals-fill",
            type: "fill",
            source: "proposals",
            paint: { "fill-color": designColor("--green-100"), "fill-opacity": 0.4 },
          });
          created.addLayer({
            id: "proposals-line",
            type: "line",
            source: "proposals",
            paint: { "line-color": designColor("--card"), "line-width": 2.5, "line-dasharray": [3, 2] },
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
      features: shownFields.map((field) => ({
        type: "Feature",
        id: field.id,
        properties: { name: field.name },
        geometry: { type: "Polygon", coordinates: field.outline },
      })),
    });
    const labels = shownFields.map((field) =>
      new lib.current!.Marker({
        element: labelElement(LABEL, field.name, field.acres === null ? null : `${field.acres.toFixed(2)} ac`),
      })
        .setLngLat(outlineCenter(field.outline[0]))
        .addTo(map.current!),
    );
    return () => labels.forEach((label) => label.remove());
  }, [ready, shownFields]);

  // Proposed fields: dashed outlines, each with its FSA numbers and the acres the FSA map prints. The map moves
  // to show them all beside the panel. A click on one puts the cursor in its name.
  useEffect(() => {
    if (!ready || !map.current || !lib.current) return;
    const current = map.current;
    const source = current.getSource<GeoJSONSource>("proposals");
    const outlines = proposed?.proposal.fields ?? [];
    source?.setData({
      type: "FeatureCollection",
      features: outlines.map((field) => ({
        type: "Feature",
        properties: { key: field.key },
        geometry: { type: "Polygon", coordinates: field.outline },
      })),
    });
    if (outlines.length === 0) return;

    const labels = outlines.map((field) =>
      new lib.current!.Marker({ element: labelElement(LABEL, fsaNumbers(field), `${formatAcres(field.fsaMapAcres)} ac`) })
        .setLngLat(outlineCenter(field.outline[0]))
        .addTo(current),
    );
    const bounds = boundsOf(outlines.flatMap((field) => field.outline[0]));
    if (bounds) {
      // Beside the panel when the map is wide enough, and never more room than the map can spare.
      const left = Math.min(REVIEW_PANEL_ROOM, current.getContainer().clientWidth * 0.6);
      current.fitBounds(bounds, { padding: { top: 72, right: 48, bottom: 72, left }, maxZoom: FARM_ZOOM, duration: 700 });
    }
    const onClick = (event: MapMouseEvent & { features?: { properties?: { key?: unknown } }[] }) => {
      const key = event.features?.[0]?.properties?.key;
      if (typeof key === "string") setPicked({ key, at: event.originalEvent.timeStamp });
    };
    const pointer = () => (current.getCanvas().style.cursor = "pointer");
    const noPointer = () => (current.getCanvas().style.cursor = "");
    current.on("click", "proposals-fill", onClick);
    current.on("mouseenter", "proposals-fill", pointer);
    current.on("mouseleave", "proposals-fill", noPointer);
    return () => {
      labels.forEach((label) => label.remove());
      current.off("click", "proposals-fill", onClick);
      current.off("mouseenter", "proposals-fill", pointer);
      current.off("mouseleave", "proposals-fill", noPointer);
      current.getCanvas().style.cursor = "";
      source?.setData(NO_OUTLINES);
    };
  }, [ready, proposed]);

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

  // While a bin is being added, a click on the map is where it stands; while an FSA map is being added, it is
  // roughly where the farm is. Clicking again moves it.
  useEffect(() => {
    if (!ready || !map.current || !picking) return;
    const current = map.current;
    const onClick = (event: MapMouseEvent) => {
      const at: LonLat = [event.lngLat.lng, event.lngLat.lat];
      if (picking === "bin") setSpot(at);
      else setFarmSpot(at);
    };
    current.on("click", onClick);
    current.getCanvas().style.cursor = "crosshair";
    return () => {
      current.off("click", onClick);
      current.getCanvas().style.cursor = "";
    };
  }, [ready, picking]);

  // The pin at the chosen spot.
  useEffect(() => {
    if (!ready || !map.current || !lib.current || !pin) return;
    const marker: Marker = new lib.current.Marker({ element: spotElement() }).setLngLat(pin).addTo(map.current);
    return () => void marker.remove();
  }, [ready, pin]);

  /** Puts away whatever the fields panel last showed. */
  function leaveFields() {
    setSeenRead(read);
    setSeenConfirm(confirmed);
    setPicked(null);
  }

  function startFields() {
    leaveFields();
    setSeen(state);
    setPlacing(false);
    setFarmSpot(null);
    setAddingFields(true);
  }

  function stopFields() {
    leaveFields();
    setFarmSpot(null);
    setAddingFields(false);
  }

  function startAdding() {
    leaveFields();
    setAddingFields(false);
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

      <div className={cn("absolute top-4 left-4 flex max-h-[calc(100%-2rem)] flex-col gap-3", proposed ? "w-96" : "w-80")}>
        {!adding && !fieldsOpen ? (
          <div className="flex w-max gap-3">
            <Button
              variant="outline"
              onClick={startFields}
              disabled={!ready}
              className="h-12 rounded-xl bg-card px-5 text-base font-semibold shadow-card"
            >
              Add fields from FSA map
            </Button>
            <Button
              variant="outline"
              onClick={startAdding}
              disabled={!ready}
              className="h-12 rounded-xl bg-card px-5 text-base font-semibold shadow-card"
            >
              Add a bin
            </Button>
          </div>
        ) : null}

        {fieldsSaved ? (
          <div role="status" className="flex flex-col gap-1 rounded-xl bg-green-100 px-4 py-3 text-base text-ink shadow-card ring-1 ring-line">
            <p className="font-semibold">
              {fieldsSaved.fields.length === 0
                ? "No fields were added."
                : `${listOf(fieldsSaved.fields.map((field) => field.name))} ${fieldsSaved.fields.length === 1 ? "is" : "are"} on your map.`}
            </p>
            {fieldsSaved.skipped.map((sentence) => (
              <p key={sentence}>{sentence}</p>
            ))}
          </div>
        ) : null}

        {choosingFsaMap ? (
          <ChooseFsaMap
            submit={submitRead}
            reading={reading}
            spot={farmSpot}
            problems={readProblems}
            onCancel={stopFields}
          />
        ) : null}

        {proposed ? (
          <ReviewProposedFields
            key={proposed.documentId}
            answer={proposed}
            submit={submitConfirm}
            confirming={confirming}
            problem={confirmProblem}
            picked={picked}
            onStartOver={leaveFields}
            onCancel={stopFields}
          />
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
