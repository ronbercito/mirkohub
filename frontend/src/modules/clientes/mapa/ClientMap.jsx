/**
 * Archivo: frontend/src/modules/clientes/mapa/ClientMap.jsx
 * Función: Mapa operativo de abonados, cajas NAP y bases centrales con Google Maps.
 */
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { Box, Map, MapPin, Server, Users } from "lucide-react";
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

const markerIcon = (maps, svg) => ({
  url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
  scaledSize: new maps.Size(52, 48),
  anchor: new maps.Point(26, 46),
});

const userIcon = (maps) => markerIcon(maps, `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="48" viewBox="0 0 52 48">
  <path d="M26 46c7-8 15-16 15-27a15 15 0 1 0-30 0c0 11 8 19 15 27Z" fill="#22c55e" stroke="#fff" stroke-width="2"/>
  <circle cx="26" cy="15" r="5" fill="#fff"/><path d="M17 29c1-5 4-8 9-8s8 3 9 8" fill="#fff"/>
</svg>`);

const napIcon = (maps) => markerIcon(maps, `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="48" viewBox="0 0 52 48">
  <path d="M26 46c7-8 15-16 15-27a15 15 0 1 0-30 0c0 11 8 19 15 27Z" fill="#f59e0b" stroke="#fff" stroke-width="2"/>
  <rect x="16" y="11" width="20" height="15" rx="2.5" fill="#0f172a" stroke="#fff" stroke-width="1.4"/>
  <circle cx="21" cy="16" r="1.4" fill="#f59e0b"/><circle cx="26" cy="16" r="1.4" fill="#f59e0b"/><circle cx="31" cy="16" r="1.4" fill="#f59e0b"/>
  <path d="M20 21h12" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
</svg>`);

const equipmentIcon = (maps, type) => {
  const isOlt = type === "olt";
  const color = isOlt ? "#8b5cf6" : "#06b6d4";
  const label = isOlt ? "VSOL" : "CCR";
  return markerIcon(maps, `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="46" viewBox="0 0 58 46">
    <path d="M29 44c7-8 16-15 16-26a16 16 0 1 0-32 0c0 11 9 18 16 26Z" fill="${color}" stroke="#fff" stroke-width="2"/>
    <rect x="17" y="11" width="24" height="14" rx="3" fill="#0f172a" stroke="#fff" stroke-width="1.4"/>
    <path d="M20 15h4m2 0h4m2 0h4M20 20h17" stroke="${color}" stroke-width="1.7" stroke-linecap="round"/>
    <text x="29" y="34" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#fff">${label}</text>
  </svg>`);
};

export default function ClientMap() {
  const { API, token } = useAuth();
  const mapRef = useRef(null);
  const [message, setMessage] = useState("Cargando mapa…");
  const [clientTotal, setClientTotal] = useState(0);
  const [napTotal, setNapTotal] = useState(0);
  const [baseTotal, setBaseTotal] = useState(0);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      try {
        const [settingsResponse, clientsResponse, routersResponse, napsResponse] = await Promise.all([
          axios.get(`${API}/settings`, { headers }),
          axios.get(`${API}/clients`, { headers }),
          axios.get(`${API}/routers`, { headers }),
          axios.get(`${API}/nap-boxes`, { headers }),
        ]);
        const apiKey = settingsResponse.data?.google_maps_api_key?.trim();
        if (!apiKey) {
          setMessage("Configura tu clave de Google Maps en Ajustes → Google.");
          return;
        }

        const clients = (clientsResponse.data || []).filter(hasCoordinates);
        const bases = (routersResponse.data || []).filter(hasCoordinates);
        const naps = (napsResponse.data || []).filter(hasCoordinates);
        if (cancelled || !mapRef.current) return;

        const maps = await loadGoogleMaps(apiKey);
        if (cancelled || !mapRef.current) return;

        const firstPoint = clients[0] || naps[0] || bases[0];
        const pointCount = clients.length + naps.length + bases.length;
        const center = firstPoint ? { lat: Number(firstPoint.latitude), lng: Number(firstPoint.longitude) } : { lat: -9.19, lng: -75.0152 };
        const map = new maps.Map(mapRef.current, {
          center, zoom: pointCount === 1 ? 16 : pointCount ? 12 : 5,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
        });
        const bounds = new maps.LatLngBounds();
        const napPositions = new Map();

        naps.forEach((nap) => {
          const position = { lat: Number(nap.latitude), lng: Number(nap.longitude) };
          napPositions.set(nap.id, position);
          const marker = new maps.Marker({ map, position, title: `NAP · ${nap.name || "Caja NAP"}`, icon: napIcon(maps), zIndex: 8 });
          const info = new maps.InfoWindow({
            content: `<div style="min-width:180px;color:#172033"><strong>NAP · ${safeText(nap.name || "Caja NAP")}</strong><br/>${safeText(nap.location || "Sin ubicación")}<br/><small>${Number(nap.used_ports || 0)} de ${Number(nap.ports || 0)} puertos usados</small></div>`,
          });
          marker.addListener("click", () => info.open({ map, anchor: marker }));
          bounds.extend(position);
        });

        clients.forEach((client) => {
          const position = { lat: Number(client.latitude), lng: Number(client.longitude) };
          const marker = new maps.Marker({ map, position, title: client.full_name || "Cliente", icon: userIcon(maps), zIndex: 6 });
          const status = client.status === "active" ? "Activo" : "Suspendido";
          const info = new maps.InfoWindow({
            content: `<div style="min-width:180px;color:#172033"><strong>${safeText(client.full_name || "Cliente")}</strong><br/>${safeText(client.address || "Sin dirección")}<br/><small>${status}${client.nap_box ? ` · NAP: ${safeText(client.nap_box)}` : ""}</small></div>`,
          });
          marker.addListener("click", () => info.open({ map, anchor: marker }));
          const napPosition = client.nap_box_id ? napPositions.get(client.nap_box_id) : null;
          if (napPosition) {
            new maps.Polyline({
              map, path: [position, napPosition], geodesic: true,
              strokeColor: "#38bdf8", strokeOpacity: 0.8, strokeWeight: 2, zIndex: 2,
            });
          }
          bounds.extend(position);
        });

        bases.forEach((base) => {
          const position = { lat: Number(base.latitude), lng: Number(base.longitude) };
          const isOlt = base.device_type === "olt";
          const marker = new maps.Marker({
            map, position, title: `Base · ${base.name || (isOlt ? "OLT" : "MikroTik")}`,
            icon: equipmentIcon(maps, base.device_type), zIndex: 10,
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
        setNapTotal(naps.length);
        setBaseTotal(bases.length);
        setMessage(pointCount ? "" : "No hay clientes, NAP ni bases con coordenadas registradas.");
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
          <p className="mt-1 text-xs text-slate-400">Clientes, Cajas NAP y bases centrales para instalaciones, soporte y visitas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Counter label="Clientes" value={clientTotal} className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300" />
          <Counter label="NAP" value={napTotal} className="border-amber-500/30 bg-amber-500/10 text-amber-300" />
          <Counter label="Bases" value={baseTotal} className="border-violet-500/30 bg-violet-500/10 text-violet-300" />
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
        <div ref={mapRef} className="h-[560px] w-full bg-slate-950" />
        {message && <div className="border-t border-slate-800 p-5 text-center">
          <MapPin className="mx-auto h-6 w-6 text-cyan-400" />
          <p className="mt-2 text-sm font-semibold text-slate-200">{message}</p>
          <p className="mt-1 text-xs text-slate-500">Cada elemento aparecerá cuando tenga latitud y longitud guardadas.</p>
        </div>}
      </section>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-2"><Users className="h-4 w-4 text-emerald-400" /> Cliente: usuario verde.</span>
        <span className="flex items-center gap-2"><Box className="h-4 w-4 text-amber-400" /> NAP: caja naranja.</span>
        <span className="flex items-center gap-2"><Server className="h-4 w-4 text-violet-400" /> Base: CCR celeste u OLT VSOL violeta.</span>
        <span className="flex items-center gap-2 text-cyan-300">— Línea celeste: cliente conectado a su Caja NAP.</span>
      </div>
    </div>
  );
}

const Counter = ({ label, value, className }) => <div className={`rounded-xl border px-4 py-2 text-center ${className}`}><p className="text-[10px] font-bold uppercase tracking-wide">{label}</p><p className="text-xl font-black text-white">{value}</p></div>;
