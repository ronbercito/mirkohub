/**
 * Archivo: frontend/src/modules/clientes/mapa/ClientMap.jsx
 * Función: Mapa operativo de abonados con Google Maps y marcadores de las
 *          coordenadas registradas para planificación de instalaciones y visitas.
 * Trabaja con: backend/app/routers/clientes/router.py, ajustes (/api/settings).
 */
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { Map, MapPin, Users } from "lucide-react";
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

export default function ClientMap() {
  const { API, token } = useAuth();
  const mapRef = useRef(null);
  const [message, setMessage] = useState("Cargando mapa…");
  const [total, setTotal] = useState(0);
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      try {
        const [settingsResponse, clientsResponse] = await Promise.all([
          axios.get(`${API}/settings`, { headers }),
          axios.get(`${API}/clients`, { headers }),
        ]);
        const apiKey = settingsResponse.data?.google_maps_api_key?.trim();
        if (!apiKey) {
          setMessage("Configura tu clave de Google Maps en Ajustes → Google.");
          return;
        }

        const clients = (clientsResponse.data || []).filter((client) => {
          const lat = Number(client.latitude);
          const lng = Number(client.longitude);
          return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
        });
        if (cancelled || !mapRef.current) return;

        const maps = await loadGoogleMaps(apiKey);
        if (cancelled || !mapRef.current) return;

        const center = clients.length
          ? { lat: Number(clients[0].latitude), lng: Number(clients[0].longitude) }
          : { lat: -9.19, lng: -75.0152 };
        const map = new maps.Map(mapRef.current, {
          center,
          zoom: clients.length === 1 ? 16 : clients.length ? 12 : 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        const bounds = new maps.LatLngBounds();

        clients.forEach((client) => {
          const position = { lat: Number(client.latitude), lng: Number(client.longitude) };
          const marker = new maps.Marker({
            map,
            position,
            title: client.full_name || "Cliente",
          });
          const info = new maps.InfoWindow({
            content: `<div style="min-width:180px;color:#172033"><strong>${client.full_name || "Cliente"}</strong><br/>${client.address || "Sin dirección"}<br/><small>${client.status === "active" ? "Activo" : "Suspendido"}</small></div>`,
          });
          marker.addListener("click", () => info.open({ map, anchor: marker }));
          bounds.extend(position);
        });

        if (clients.length > 1) map.fitBounds(bounds, 48);
        setTotal(clients.length);
        setMessage(clients.length ? "" : "No hay clientes con coordenadas registradas.");
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
          <p className="mt-1 text-xs text-slate-400">Ubicaciones registradas para instalaciones, soporte y visitas.</p>
        </div>
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wide text-cyan-300">Clientes ubicados</p>
          <p className="text-xl font-black text-white">{total}</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
        <div ref={mapRef} className="h-[560px] w-full bg-slate-950" />
        {message && <div className="border-t border-slate-800 p-5 text-center">
          <MapPin className="mx-auto h-6 w-6 text-cyan-400" />
          <p className="mt-2 text-sm font-semibold text-slate-200">{message}</p>
          <p className="mt-1 text-xs text-slate-500">Cada cliente aparecerá cuando tenga latitud y longitud guardadas en su ficha.</p>
        </div>}
      </section>

      <div className="flex items-center gap-2 text-xs text-slate-500"><Users className="h-4 w-4" /> Haz clic en un marcador para ver el nombre, dirección y estado del cliente.</div>
    </div>
  );
}
