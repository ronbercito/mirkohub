/**
 * Archivo: frontend/src/modules/red/components/RouterLiveTabs.jsx
 * Función: Pestañas de lectura en vivo del MikroTik seleccionado. Cada pestaña consulta un
 *          endpoint del backend que a su vez lee el RouterOS por API:
 *          Interfaces (tráfico RX/TX), PPPoE activos, PPPoE secrets (habilitar/deshabilitar),
 *          Colas simples, DHCP leases (hacer estático), Address-list (agregar/quitar IP de morosos)
 *          y Hotspot (usuarios y sesiones activas). Incluye auto-refresco opcional cada 5 s.
 * Trabaja con: modules/red/Network.jsx, backend/app/routers/red/router.py,
 *              backend/app/integrations/mikrotik/client.py
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { ArrowDown, ArrowUp, RefreshCw, Plus, Trash2, Power } from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { id: "interfaces", label: "Interfaces", path: "interfaces" },
  { id: "pppoe_active", label: "PPPoE activos", path: "pppoe/active" },
  { id: "pppoe_secrets", label: "PPPoE secrets", path: "pppoe/secrets" },
  { id: "queues", label: "Colas simples", path: "queues" },
  { id: "dhcp", label: "DHCP leases", path: "dhcp-leases" },
  { id: "address_list", label: "Address-list", path: "address-list" },
  { id: "hotspot", label: "Hotspot", path: "hotspot/active" },
];

const Badge = ({ ok, yes = "UP", no = "DOWN" }) => (
  <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${ok ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>{ok ? yes : no}</span>
);

export default function RouterLiveTabs({ router }) {
  const { API, token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("interfaces");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(false);
  const [listName, setListName] = useState("morosos");
  const [newIp, setNewIp] = useState("");

  const load = useCallback(async () => {
    const t = TABS.find((x) => x.id === tab);
    setLoading(true);
    setError("");
    try {
      const url = `${API}/routers/${router.id}/${t.path}${tab === "address_list" && listName ? `?list=${encodeURIComponent(listName)}` : ""}`;
      const res = await axios.get(url, { headers });
      if (!res.data.ok) {
        setRows([]);
        setError(res.data.error || "No se pudo leer el MikroTik");
        return;
      }
      setRows(res.data.data);
    } catch (e) {
      setRows([]);
      setError(e?.response?.data?.detail || "No se pudo leer el MikroTik (sin respuesta del servidor)");
    } finally {
      setLoading(false);
    }
  }, [API, token, router.id, tab, listName]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [auto, load]);

  const post = async (path, body = {}, params = "") => {
    try {
      const res = await axios.post(`${API}/routers/${router.id}/${path}${params}`, body, { headers });
      toast.success(res.data.message);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Operación fallida");
    }
  };

  return (
    <div data-testid="router-live-tabs">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 mb-3">
        {TABS.map((t) => (
          <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition ${tab === t.id ? "border-cyan-400 text-cyan-300" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-cyan-500" data-testid="auto-refresh-toggle" /> Auto 5s
          </label>
          <button data-testid="btn-refresh-tab" onClick={load} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        </div>
      </div>

      {tab === "address_list" && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <input data-testid="address-list-name" value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Nombre de la lista" className="p-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono w-40" />
          <input data-testid="address-list-ip" value={newIp} onChange={(e) => setNewIp(e.target.value)} placeholder="IP a agregar (ej. 10.10.10.5)" className="p-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono w-56" />
          <button data-testid="address-list-add" disabled={!newIp} onClick={() => { post("address-list", { action: "add", list: listName, address: newIp, comment: "Agregado desde panel" }); setNewIp(""); }}
            className="px-3 py-2 bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 border border-rose-800/50 rounded-lg font-semibold flex items-center gap-1 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Agregar a la lista
          </button>
        </div>
      )}

      {error ? (
        <div data-testid="live-tab-error" className="p-4 bg-rose-950/30 border border-rose-900/50 rounded-xl text-xs text-rose-300">{error}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs" data-testid={`table-${tab}`}>
            {tab === "interfaces" && (
              <>
                <Head cols={["Interfaz", "Tipo", "IP", "RX (bajada)", "TX (subida)", "MAC", "Estado"]} />
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {rows.map((i) => (
                    <tr key={i.id || i.name} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono font-bold text-slate-100">{i.name}</td>
                      <td className="py-2 px-3 uppercase text-[10px] text-slate-400">{i.type}</td>
                      <td className="py-2 px-3 font-mono text-cyan-300">{i.ip || "—"}</td>
                      <td className="py-2 px-3 font-mono text-cyan-400 font-bold"><ArrowDown className="w-3 h-3 inline mr-1" />{i.rx_mbps} Mbps</td>
                      <td className="py-2 px-3 font-mono text-emerald-400 font-bold"><ArrowUp className="w-3 h-3 inline mr-1" />{i.tx_mbps} Mbps</td>
                      <td className="py-2 px-3 font-mono text-slate-400">{i.mac_address || "—"}</td>
                      <td className="py-2 px-3"><Badge ok={i.running} no={i.disabled ? "DISABLED" : "DOWN"} /></td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "pppoe_active" && (
              <>
                <Head cols={["Usuario", "Servicio", "IP asignada", "MAC (caller-id)", "Uptime"]} />
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono font-bold text-slate-100">{r.name}</td>
                      <td className="py-2 px-3 uppercase text-[10px]">{r.service}</td>
                      <td className="py-2 px-3 font-mono text-cyan-300">{r.address}</td>
                      <td className="py-2 px-3 font-mono text-slate-400">{r.caller_id}</td>
                      <td className="py-2 px-3 font-mono">{r.uptime}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "pppoe_secrets" && (
              <>
                <Head cols={["Usuario", "Perfil", "IP remota", "Comentario", "Estado", ""]} />
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono font-bold text-slate-100">{r.name}</td>
                      <td className="py-2 px-3 font-mono text-emerald-300">{r.profile}</td>
                      <td className="py-2 px-3 font-mono text-cyan-300">{r.remote_address || "—"}</td>
                      <td className="py-2 px-3 text-slate-400 truncate max-w-[220px]">{r.comment}</td>
                      <td className="py-2 px-3"><Badge ok={!r.disabled} yes="HABILITADO" no="DESHABILITADO" /></td>
                      <td className="py-2 px-3 text-right">
                        <button data-testid={`toggle-secret-${r.name}`} onClick={() => post(`pppoe/secrets/${encodeURIComponent(r.name)}/toggle`, {}, `?disabled=${!r.disabled}`)}
                          className={`p-1.5 rounded-lg border ${r.disabled ? "text-emerald-300 border-emerald-800/50 hover:bg-emerald-900/30" : "text-rose-300 border-rose-800/50 hover:bg-rose-900/30"}`} title={r.disabled ? "Habilitar" : "Cortar"}>
                          <Power className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "queues" && (
              <>
                <Head cols={["Nombre", "Target", "Max-limit (sub/baj)", "Tráfico actual", "Comentario", "Estado"]} />
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono font-bold text-slate-100">{r.name}</td>
                      <td className="py-2 px-3 font-mono text-cyan-300">{r.target}</td>
                      <td className="py-2 px-3 font-mono">{r.max_limit}</td>
                      <td className="py-2 px-3 font-mono text-emerald-300">{r.rate_up_mbps} / {r.rate_down_mbps} Mbps</td>
                      <td className="py-2 px-3 text-slate-400 truncate max-w-[220px]">{r.comment}</td>
                      <td className="py-2 px-3"><Badge ok={!r.disabled} yes="ACTIVA" no="DESHABILITADA" /></td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "dhcp" && (
              <>
                <Head cols={["IP", "MAC", "Host", "Servidor", "Estado", "Tipo", ""]} />
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono font-bold text-cyan-300">{r.address}</td>
                      <td className="py-2 px-3 font-mono">{r.mac_address}</td>
                      <td className="py-2 px-3">{r.host_name || "—"}</td>
                      <td className="py-2 px-3 text-slate-400">{r.server}</td>
                      <td className="py-2 px-3 uppercase text-[10px]">{r.status}</td>
                      <td className="py-2 px-3"><Badge ok={!r.dynamic} yes="ESTÁTICO" no="DINÁMICO" /></td>
                      <td className="py-2 px-3 text-right">
                        {r.dynamic && (
                          <button data-testid={`make-static-${r.address}`} onClick={() => post(`dhcp-leases/${encodeURIComponent(r.id)}/make-static`)} className="px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 text-[10px] font-semibold">
                            Hacer estático
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "address_list" && (
              <>
                <Head cols={["Lista", "IP / Red", "Comentario", "Tipo", ""]} />
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono font-bold text-rose-300">{r.list}</td>
                      <td className="py-2 px-3 font-mono text-cyan-300">{r.address}</td>
                      <td className="py-2 px-3 text-slate-400">{r.comment}</td>
                      <td className="py-2 px-3"><Badge ok={!r.dynamic} yes="ESTÁTICO" no="DINÁMICO" /></td>
                      <td className="py-2 px-3 text-right">
                        <button data-testid={`remove-address-${r.address}`} onClick={() => post("address-list", { action: "remove", list: r.list, address: r.address })} className="p-1.5 rounded-lg border border-slate-700 text-rose-400 hover:bg-rose-900/30" title="Quitar de la lista">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
            {tab === "hotspot" && (
              <>
                <Head cols={["Usuario", "IP", "MAC", "Uptime", "Descarga", "Subida"]} />
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-mono font-bold text-slate-100">{r.user}</td>
                      <td className="py-2 px-3 font-mono text-cyan-300">{r.address}</td>
                      <td className="py-2 px-3 font-mono text-slate-400">{r.mac_address}</td>
                      <td className="py-2 px-3 font-mono">{r.uptime}</td>
                      <td className="py-2 px-3 font-mono">{(r.bytes_in / 1048576).toFixed(1)} MB</td>
                      <td className="py-2 px-3 font-mono">{(r.bytes_out / 1048576).toFixed(1)} MB</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
          {!loading && rows.length === 0 && (
            <p data-testid="live-tab-empty" className="p-4 text-center text-xs text-slate-500">Sin registros en el MikroTik para esta sección.</p>
          )}
        </div>
      )}
    </div>
  );
}

const Head = ({ cols }) => (
  <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
    <tr>{cols.map((c, i) => <th key={i} className="py-2.5 px-3 text-[10px]">{c}</th>)}</tr>
  </thead>
);
