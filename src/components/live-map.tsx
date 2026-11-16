import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useMemo } from "react";

// Fix leaflet default icon paths for bundlers
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

type Business = { id: string; business_name: string; gps_lat: number | null; gps_lng: number | null; category: string | null };
type Device = {
  id: string;
  serial_number: string;
  current_lat: number | null;
  current_lng: number | null;
  online_status: string;
  last_seen?: string | null;
  battery_level?: number | null;
  cash_balance?: number | null;
  officers?: { full_name?: string } | null;
};

function freshness(lastSeen?: string | null) {
  if (!lastSeen) return { label: "no signal", color: "#a1a1aa" };
  const mins = (Date.now() - new Date(lastSeen).getTime()) / 60000;
  if (mins < 5) return { label: "live", color: "#059669" };
  if (mins < 30) return { label: `${Math.round(mins)}m ago`, color: "#d97706" };
  if (mins < 60 * 24) return { label: `${Math.round(mins / 60)}h ago`, color: "#dc2626" };
  return { label: "stale", color: "#a1a1aa" };
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 16, { duration: 0.8 });
  }, [target, map]);
  return null;
}

export default function LiveMap({
  businesses,
  devices,
  focus,
}: {
  businesses: Business[];
  devices: Device[];
  focus?: [number, number] | null;
}) {
  const center: [number, number] = useMemo(() => {
    const pts = [
      ...businesses.filter((b) => b.gps_lat && b.gps_lng).map((b) => [b.gps_lat!, b.gps_lng!] as [number, number]),
      ...devices.filter((d) => d.current_lat && d.current_lng).map((d) => [d.current_lat!, d.current_lng!] as [number, number]),
    ];
    if (pts.length === 0) return [1.4324, 31.3527]; // Hoima City default
    const avgLat = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const avgLng = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return [avgLat, avgLng];
  }, [businesses, devices]);

  return (
    <MapContainer center={center} zoom={13} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
      <TileLayer attribution="© OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FlyTo target={focus ?? null} />
      {businesses.filter((b) => b.gps_lat && b.gps_lng).map((b) => (
        <Marker key={b.id} position={[b.gps_lat!, b.gps_lng!]}>
          <Popup>
            <b>{b.business_name}</b>
            <br />
            {b.category}
          </Popup>
        </Marker>
      ))}
      {devices.filter((d) => d.current_lat && d.current_lng).map((d) => {
        const f = freshness(d.last_seen);
        const live = f.label === "live" && d.online_status === "online";
        return (
          <CircleMarker
            key={d.id}
            center={[d.current_lat!, d.current_lng!]}
            radius={live ? 11 : 8}
            pathOptions={{ color: f.color, fillColor: f.color, fillOpacity: live ? 0.75 : 0.4, weight: live ? 3 : 1.5 }}
          >
            <Popup>
              <b>{d.officers?.full_name || "Unassigned"}</b>
              <br />
              {d.serial_number}
              <br />
              Signal: {f.label}
              {d.battery_level != null && (
                <>
                  <br />
                  Battery: {d.battery_level}%
                </>
              )}
              {d.cash_balance != null && (
                <>
                  <br />
                  Cash held: UGX {Number(d.cash_balance).toLocaleString()}
                </>
              )}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
