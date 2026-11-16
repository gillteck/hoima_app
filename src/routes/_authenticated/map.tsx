import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Card, Badge } from "@/components/primitives";
import { lazy, Suspense, useEffect, useState } from "react";
import { Radio, BatteryMedium, Crosshair } from "lucide-react";

export const Route = createFileRoute("/_authenticated/map")({
  head: () => pageHead("Live Map", "View live officer and device locations across Hoima City collection areas."),
  ssr: false,
  component: MapPage,
});

const MapView = lazy(() => import("@/components/live-map"));

function minutesAgo(ts?: string | null) {
  if (!ts) return null;
  return (Date.now() - new Date(ts).getTime()) / 60000;
}

function signalLabel(ts?: string | null, online?: string) {
  const m = minutesAgo(ts);
  if (m == null) return { text: "No signal", tone: "neutral" as const };
  if (m < 5 && online === "online") return { text: "Live", tone: "success" as const };
  if (m < 30) return { text: `${Math.round(m)}m ago`, tone: "warning" as const };
  if (m < 1440) return { text: `${Math.round(m / 60)}h ago`, tone: "danger" as const };
  return { text: "Stale", tone: "neutral" as const };
}

function MapPage() {
  const [focus, setFocus] = useState<[number, number] | null>(null);

  const { data, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["map-data"],
    refetchInterval: 15000,
    queryFn: async () => {
      const [{ data: businesses }, { data: devices }] = await Promise.all([
        supabase.from("businesses").select("id, business_name, gps_lat, gps_lng, category").not("gps_lat", "is", null).limit(500),
        supabase
          .from("pos_devices")
          .select("id, serial_number, current_lat, current_lng, online_status, last_seen, battery_level, cash_balance, officers(full_name)")
          .not("current_lat", "is", null)
          .limit(200),
      ]);
      return { businesses: businesses || [], devices: devices || [] };
    },
  });

  // Live updates whenever a device pushes a new position
  useEffect(() => {
    const channel = supabase
      .channel("live-device-locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "pos_devices" }, () => {
        refetch();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch]);

  const devices = data?.devices || [];
  const liveCount = devices.filter((d) => {
    const m = minutesAgo(d.last_seen);
    return d.online_status === "online" && m != null && m < 5;
  }).length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Live Field Map"
        description="Real-time officer positions, device signal and cash held in the field."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="success">{liveCount} live</Badge>
            <Badge tone="info">{devices.length} devices located</Badge>
            <span className="text-xs text-zinc-400">
              updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—"}
            </span>
          </div>
        }
      />

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-black/5 flex items-center gap-2 text-sm font-semibold">
            <Radio className="size-4 text-brand" /> Officers in the field
          </div>
          <div className="max-h-[calc(100vh-300px)] overflow-y-auto divide-y divide-black/5">
            {devices.length === 0 && (
              <p className="p-4 text-sm text-zinc-500">No device has reported a location yet.</p>
            )}
            {devices.map((d) => {
              const sig = signalLabel(d.last_seen, d.online_status);
              return (
                <button
                  key={d.id}
                  onClick={() => d.current_lat && setFocus([d.current_lat!, d.current_lng!])}
                  className="w-full text-left px-4 py-3 hover:bg-zinc-50 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {(d.officers as { full_name?: string } | null)?.full_name || "Unassigned"}
                    </span>
                    <Badge tone={sig.tone}>{sig.text}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
                    <span className="font-mono truncate">{d.serial_number}</span>
                    {d.battery_level != null && (
                      <span className="inline-flex items-center gap-1">
                        <BatteryMedium className="size-3" />
                        {d.battery_level}%
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Crosshair className="size-3" />
                      UGX {Number(d.cash_balance || 0).toLocaleString()}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="h-[calc(100vh-260px)] min-h-[500px] w-full">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-zinc-500">Loading map…</div>}>
              <MapView businesses={data?.businesses || []} devices={devices} focus={focus} />
            </Suspense>
          </div>
        </Card>
      </div>
    </div>
  );
}
