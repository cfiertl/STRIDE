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
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO'
      />
      <Polyline positions={latlng} pathOptions={{ color: "var(--ink)", weight: 2, opacity: 0.85 }} />
    </MapContainer>
  );
}