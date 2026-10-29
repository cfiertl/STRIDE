// @ts-nocheck
"use client";

import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export default function RouteMap({ latlng }) {
  if (!latlng || latlng.length < 2) return null;

  // bounds from the track, so the map frames the whole route
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [la, ln] of latlng) {
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln; if (ln > maxLng) maxLng = ln;
  }
  const bounds = [[minLat, minLng], [maxLat, maxLng]];

  return (
    <MapContainer bounds={bounds} boundsOptions={{ padding: [20, 20] }} scrollWheelZoom={false} style={{ height: 280, width: "100%", borderRadius: 12 }}>
      {/* OSM's own tiles: no key. CARTO's basemaps started serving an "API KEY
          REQUIRED" image in place of every tile. Desaturated so the route line
          stays the loudest thing on the map, as it was on CARTO's light style. */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
        className="route-tiles"
      />
      <Polyline positions={latlng} pathOptions={{ color: "var(--accent)", weight: 3, opacity: 0.9 }} />
    </MapContainer>
  );
}