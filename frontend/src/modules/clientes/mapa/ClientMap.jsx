/**
 * Archivo: frontend/src/modules/clientes/mapa/ClientMap.jsx
 * Función: Mapa operativo de abonados y bases centrales con Google Maps.
 */
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { Map, MapPin, Server, Users } from "lucide-react";
import { toast } from "sonner";

const loadGoogleMaps = (apiKey) => new Promise((resolve, reject) => {
  if (window.google?.maps) return resolve(window.google.maps);
  const existing = document.getElementById("google-maps-script");
  if (existing) {
    existing.addEventListener("load", () => resolve(window.google.maps), { once: true });
    existing.addEventListener("error", () => reject(new Error("No se pudo cargar Google Maps.")), { once: true });
    return;
  }
  const script = document.createElement("script");
  script.id = "google-maps-script";
  script.async = true;
  script.defer = true;
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
  script.onload = () => resolve(window.google.maps);
  script.onerror = () => reject(new Error("No se pudo cargar Google Maps."));
  document.head.appendChild(script);
});

const hasCoordinates = (item) => {
  const lat = Number(item.latitude);
  const lng = Number(item.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
};

const safeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char]));

export default function ClientMap() {
  const { API, token } = useAuth();
  const mapRef = useRef(null);
  const [message, setMessage] = useState("Cargando mapa…");
  const [clientTotal, setClientTotal] = useState(0);
  const [baseTotal, setBaseTotal] = useState(0);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      try {
        const [settingsResponse, clientsResponse, routersResponse] = await Promise.all([
          axios.get(`${API}/settings`, { headers }),
          axios.get(`${API}/clients`, { headers }),
          axios.get(`${API}/routers`, { headers }),
        ]);
        const apiKey = settingsResponse.data?.google_maps_api_key?.trim();
        if (!apiKey) {
          setMessage("Configura tu clave de Google Maps en Ajustes → Google.");
          return;
        }

        const clients = (clientsResponse.data || []).filter(hasCoordinates);
        const bases = (routersResponse.data || []).filter(hasCoordinates);
        if (cancelled || !mapRef.current) return;

        const maps = await loadGoogleMaps(apiKey);
        if (cancelled || !mapRef.current) return;

        const firstPoint = clients[0] || bases[0];
        const center = firstPoint
          ? { lat: Number(firstPoint.latitude), lng: Number(firstPoint.longitude) }
          : { lat: -9.19, lng: -75.0152 };
        const pointCount = clients.length + bases.length;
        const map = new maps.Map(mapRef.current, {
          center,
          zoom: pointCount === 1 ? 16 : pointCount ? 12 : 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        const bounds = new maps.LatLngBounds();

        clients.forEach((client) => {
          const position = { lat: Number(client.latitude), lng: Number(client.longitude) };
          const marker = new maps.Marker({ map, position, title: client.full_name || "Cliente" });
          const status = client.status === "active" ? "Activo" : "Suspendido";
          const info = new maps.InfoWindow({
            content: `<div style="min-width:180px;color:#172033"><strong>${safeText(client.full_name || "Cliente")}</strong><br/>${safeText(client.address || "Sin dirección")}<br/><small>${status}</small></div>`,
          });
          marker.addListener("click", () => info.open({ map, anchor: marker }));
          bounds.extend(position);
        });

        bases.forEach((base) => {
          const position = { lat: Number(base.latitude), lng: Number(base.longitude) };
          const isOlt = base.device_type === "olt";
          const marker = new maps.Marker({
            map,
            position,
            title: `Base · ${base.name || (isOlt ? "OLT" : "MikroTik")}`,
            label: { text: "B", color: "#ffffff", fontSize: "12px", fontWeight: "700" },
            icon: {
              path: maps.SymbolPath.CIRCLE,
              fillColor: isOlt ? "#8b5cf6" : "#06b6d4",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
              scale: 13,
            },
            zIndex: 10,
          });
          const kind = isOlt ? "OLT" : "MikroTik";
          const info = new maps.InfoWindow({
            content: `<div style="min-width:180px;color:#172033"><strong>Base · ${safeText(base.name || kind)}</strong><br/>${safeText(base.location || kind)}</div>`,
          });
          marker.addListener("click", () => info.open({ map, anchor: marker }));
          bounds.extend(position);
        });

        if (pointCount > 1) map.fitBounds(bounds, 48);
        setClientTotal(clients.length);
        setBaseTotal(bases.length);
        setMessage(pointCount ? "" : "No hay clientes ni bases con coordenadas registradas.");
      } catch {
        if (!cancelled) {
          setMessage("No se pudo cargar Google Maps. Revisa la clave, la API habilitada y las restricciones del dominio.");
          toast.error("No se pudo cargar el mapa de clientes.");
        }
      }
    };
    setup();
    return () => { cancelled = true; };
  }, [API, token]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-100"><Map className="text-cyan-400" /> Mapa de clientes</h2>
          <p className="mt-1 text-xs text-slate-400">Ubicaciones de clientes y bases centrales para instalaciones, soporte y visitas.</p>
        </div>
        <div className="flex gap-2">
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wide text-cyan-300">Clientes</p>
            <p className="text-xl font-black text-white">{clientTotal}</p>
          </div>
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wide text-violet-300">Bases</p>
            <p className="text-xl font-black text-white">{baseTotal}</p>
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
        <div ref={mapRef} className="h-[560px] w-full bg-slate-950" />
        {message && <div className="border-t border-slate-800 p-5 text-center">
          <MapPin className="mx-auto h-6 w-6 text-cyan-400" />
          <p className="mt-2 text-sm font-semibold text-slate-200">{message}</p>
          <p className="mt-1 text-xs text-slate-500">Cada cliente o base aparecerá cuando tenga latitud y longitud guardadas.</p>
        </div>}
      </section>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-2"><Users className="h-4 w-4" /> Haz clic en un marcador de cliente para ver su información.</span>
        <span className="flex items-center gap-2"><Server className="h-4 w-4 text-violet-400" /> Las bases se muestran con el icono circular «B»: celeste para MikroTik y violeta para OLT.</span>
      </div>
    </div>
  );
}
