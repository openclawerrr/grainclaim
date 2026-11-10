/**
 * Builds sample-data/reference/outlines-preview.html: every outline in
 * nearby-outlines.geojson over satellite imagery, to check by eye that the
 * outlines sit on real fields. Pure: plain data in, one HTML page out.
 *
 * The outlines are inside the page, so it opens with a double-click and
 * needs no local server. It does need the internet, for the map library and
 * the imagery. Esri World Imagery is licensed for on-screen use with credit,
 * which is why it is here and not on the printed map.
 */
import { centerOfMass } from "@turf/turf";
import { acresOf, type CsbFeature, type LonLat, type NearbyOutlines } from "./outlines";

/**
 * MapLibre 5, not the app's version 6. Version 6 starts its worker from a
 * separate file, which a browser refuses for a page opened from disk; version
 * 5's single script carries its worker inside it, so a double-click works.
 */
const MAPLIBRE = "https://unpkg.com/maplibre-gl@5.6.0/dist";
const ESRI_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_CREDIT = "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/** What the preview knows about Dave's fields that the outlines file leaves out. */
export interface FieldLabel {
  id: string;
  name: string;
  /** The acres the database measures from the outline, which the FSA map prints. */
  expected_acres: number;
}

export interface PreviewInput {
  outlines: NearbyOutlines;
  fields: readonly FieldLabel[];
  bins: readonly { name: string; location: LonLat }[];
  /** Every polygon in the CSB clip, to show faintly on request. */
  clip: readonly CsbFeature[];
}

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
const twoPlaces = (n: number) => n.toFixed(2);

/** One label per outline: its name or CSB id, and its acres. */
export function previewLabels({ outlines, fields }: Pick<PreviewInput, "outlines" | "fields">) {
  return outlines.features.map((outline) => {
    const at = centerOfMass({ type: "Feature", properties: {}, geometry: outline.geometry }).geometry.coordinates;
    const measured = acresOf(outline.geometry);
    if (outline.properties.source === "sample") {
      const field = fields.find((f) => f.id === outline.id);
      if (!field) throw new Error(`Outline ${outline.id} is marked sample but is not a field in farm.geojson.`);
      return {
        id: outline.id,
        source: outline.properties.source,
        at: at as LonLat,
        title: field.name,
        detail: `${twoPlaces(field.expected_acres)} ac in the database (${twoPlaces(measured)} measured here)`,
      };
    }
    return {
      id: outline.id,
      source: outline.properties.source,
      at: at as LonLat,
      title: `CSB ${outline.id}`,
      detail: `${twoPlaces(measured)} ac, ${outline.properties.crop.toLowerCase()}`,
    };
  });
}

export function renderPreview(input: PreviewInput): string {
  const chosen = new Set(input.outlines.features.map((f) => f.id));
  const data = {
    outlines: { type: "FeatureCollection", features: input.outlines.features },
    labels: previewLabels(input),
    bins: input.bins,
    others: {
      type: "FeatureCollection",
      features: input.clip
        .filter((c) => !chosen.has(c.properties.id))
        .map((c) => ({ type: "Feature", properties: c.properties, geometry: c.geometry })),
    },
  };
  // "<" is escaped so nothing in the data can end the script block.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const counts = {
    sample: input.outlines.features.filter((f) => f.properties.source === "sample").length,
    csb: input.outlines.features.filter((f) => f.properties.source === "public_csb").length,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Outlines preview (SAMPLE)</title>
<link rel="stylesheet" href="${MAPLIBRE}/maplibre-gl.css">
<style>
  html, body { margin: 0; height: 100%; font-family: -apple-system, "Segoe UI", Arial, sans-serif; }
  #map { position: absolute; inset: 0; }
  #panel { position: absolute; top: 12px; left: 12px; z-index: 2; max-width: 330px; padding: 12px 14px;
    background: rgba(255, 255, 255, 0.94); border-radius: 8px; font-size: 13px; line-height: 1.4; color: #1a1a1a;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35); }
  #panel h1 { margin: 0 0 6px; font-size: 15px; }
  #panel p { margin: 0 0 8px; }
  #panel ul { margin: 0 0 8px; padding: 0; list-style: none; }
  #panel li { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
  .swatch { flex: none; width: 22px; height: 12px; border: 3px solid; box-sizing: border-box; }
  .swatch.sample { border-color: #ffd60a; background: rgba(255, 214, 10, 0.25); }
  .swatch.csb { border-color: #4cc9f0; background: rgba(76, 201, 240, 0.25); }
  .swatch.other { border: 2px dashed #ffffff; background: #777; }
  .swatch.bin { width: 12px; border-radius: 50%; border-color: #fff; background: #e63946; }
  #panel label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  #status { color: #b00020; }
  .outline-label { padding: 3px 6px; border-radius: 4px; background: rgba(0, 0, 0, 0.72); color: #fff;
    font-size: 12px; line-height: 1.3; text-align: center; white-space: nowrap; pointer-events: none; }
  .outline-label b { display: block; font-size: 13px; }
  .outline-label.sample b { color: #ffd60a; }
  .outline-label.public_csb b { color: #8ee3ff; }
  .bin-label { padding: 1px 5px; border-radius: 4px; background: #e63946; color: #fff; font-size: 11px;
    white-space: nowrap; pointer-events: none; }
</style>
</head>
<body>
<div id="map"></div>
<div id="panel">
  <h1>Outlines near Dave's Farm (SAMPLE)</h1>
  <p>Every outline in <code>sample-data/nearby-outlines.geojson</code>, over Esri World Imagery.</p>
  <ul>
    <li><span class="swatch sample"></span>Dave's made-up fields (${counts.sample}), from <code>farm.geojson</code></li>
    <li><span class="swatch csb"></span>Neighbors (${counts.csb}): real outlines from USDA Crop Sequence Boundaries</li>
    <li><span class="swatch bin"></span>Bins 3 and 4 (the farmstead), from <code>farm.json</code></li>
    <li><span class="swatch other"></span>Other real outlines in the clip, not in the file</li>
  </ul>
  <label><input type="checkbox" id="others"> Show the other real outlines</label>
  <p id="status"></p>
</div>
<script type="application/json" id="data">${json}</script>
<script src="${MAPLIBRE}/maplibre-gl.js"></script>
<script>
  const status = document.getElementById("status");
  try {
    const data = JSON.parse(document.getElementById("data").textContent);

    const map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {
          imagery: { type: "raster", tiles: ["${ESRI_TILES}"], tileSize: 256, maxzoom: 19, attribution: ${JSON.stringify(esc(ESRI_CREDIT))} },
        },
        layers: [{ id: "imagery", type: "raster", source: "imagery" }],
      },
      center: [-93.407, 42.09],
      zoom: 14,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");

    map.on("load", () => {
      map.addSource("others", { type: "geojson", data: data.others });
      map.addLayer({ id: "others-line", type: "line", source: "others", layout: { visibility: "none" },
        paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [2, 2] } });

      map.addSource("outlines", { type: "geojson", data: data.outlines });
      const color = ["match", ["get", "source"], "sample", "#ffd60a", "#4cc9f0"];
      map.addLayer({ id: "outlines-fill", type: "fill", source: "outlines", paint: { "fill-color": color, "fill-opacity": 0.18 } });
      map.addLayer({ id: "outlines-line", type: "line", source: "outlines", paint: { "line-color": color, "line-width": 3 } });

      for (const label of data.labels) {
        const el = document.createElement("div");
        el.className = "outline-label " + label.source;
        const title = document.createElement("b");
        title.textContent = label.title;
        el.append(title, label.detail);
        new maplibregl.Marker({ element: el }).setLngLat(label.at).addTo(map);
      }
      // The bins stand side by side, so their labels go above and below to stay readable.
      data.bins.forEach((bin, i) => {
        const el = document.createElement("div");
        el.className = "bin-label";
        el.textContent = bin.name;
        new maplibregl.Marker({ element: el, anchor: i % 2 === 0 ? "bottom" : "top" }).setLngLat(bin.location).addTo(map);
      });

      const bounds = new maplibregl.LngLatBounds();
      for (const feature of data.outlines.features) {
        for (const point of feature.geometry.coordinates[0]) bounds.extend(point);
      }
      map.fitBounds(bounds, { padding: 60, duration: 0 });

      document.getElementById("others").addEventListener("change", (event) => {
        map.setLayoutProperty("others-line", "visibility", event.target.checked ? "visible" : "none");
      });
    });
  } catch (error) {
    status.textContent = "The map couldn't load. This page needs the internet for the map library and the imagery. " + error;
  }
</script>
</body>
</html>
`;
}
