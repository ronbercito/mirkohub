/**
 * Archivo: frontend/src/modules/red/components/EquipmentMapModal.jsx
 * Función: Muestra un mini mapa de Google Maps centrado en un router u OLT.
 * Trabaja con: modules/red/Network.jsx y /api/settings.
 */
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { MapPin, X } from "lucide-react";

const loadMaps = (apiKey) => new Promise((resolve, reject) => {
  if (window.google?.maps) return resolve(window.google.maps);
  const existing = document.getElementById("google-maps-script");
  if (existing) {
    existing.addEventListener("load", () => resolve(window.google.maps), { once: true });
    existing.addEventListener("error", () => reject(new Error("No se pudo cargar el mapa.")), { once: true });
    return;
  }
  const script = document.createElement("script");
  script.id = "google-maps-script";
  script.async = true;
  script.defer = true;
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
  script.onload = () => resolve(window.google.maps);
  script.onerror = () => reject(new Error("No se pudo cargar el mapa."));
  document.head.appendChild(script);
});

export default function EquipmentMapModal({ router, onClose }) {
  const { API, token } = useAuth();
  const mapRef = useRef(null);
  const [message, setMessage] = useState("Cargando mapa…");
  const lat = Number(router.latitude);
  const lng = Number(router.longitude);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  useEffect(() => {
    if (!hasCoordinates) {
      setMessage("Este equipo todavía no tiene coordenadas. Edita el equipo y registra su latitud y longitud.");
      return;
    }
    let cancelled = false;
    const start = async () => {
      try {
        const settings = await axios.get(`${API}/settings`, { headers: { Authorization: `Bearer ${token}` } });
        const key = settings.data?.google_maps_api_key?.trim();
        if (!key) {
          setMessage("Configura la clave de Google Maps en Ajustes → Google.");
          return;
        }
        const maps = await loadMaps(key);
        if (cancelled || !mapRef.current) return;
        const position = { lat, lng };
        const map = new maps.Map(mapRef.current, { center: position, zoom: 17, mapTypeControl: false, streetViewControl: false });
        const marker = new maps.Marker({ map, position, title: router.name });
        const info = new maps.InfoWindow({ content: `<div style="color:#172033"><strong>${router.name}</strong><br/>${router.location || "Equipo central"}</div>` });
        marker.addListener("click", () => info.open({ map, anchor: marker }));
        info.open({ map, anchor: marker });
        setMessage("");
      } catch {
        if (!cancelled) setMessage("No se pudo cargar el mini mapa. Revisa la clave de Google Maps y el dominio autorizado.");
      }
    };
    start();
    return () => { cancelled = true; };
  }, [API, token, hasCoordinates, lat, lng, router.name, router.location]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
    <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <div><h3 className="flex items-center gap-2 font-bold text-slate-100"><MapPin className="h-5 w-5 text-cyan-400" /> Coordenadas · {router.name}</h3><p className="mt-1 text-xs text-slate-500">{hasCoordinates ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "Sin coordenadas"}</p></div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div ref={mapRef} className="h-80 w-full bg-slate-950" />
      {message && <div className="border-t border-slate-800 p-5 text-center text-sm text-slate-400">{message}</div>}
    </div>
  </div>;
}
