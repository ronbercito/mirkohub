/**
 * Archivo: frontend/src/modules/red/components/OltLiveTabs.jsx
 * Función: Pestañas de lectura en vivo de una OLT VSOL (por CLI Telnet/SSH): Resumen (show version),
 *          Puertos PON (óptica y estadísticas), ONUs autorizadas, ONUs pendientes (auto-find),
 *          Óptica de ONUs y Consola libre. Las tablas se dibujan con las columnas que devuelva la OLT
 *          (parser genérico), y siempre se puede ver la salida cruda. Acciones sobre ONU:
 *          autorizar por SN, reiniciar, desactivar/activar y eliminar.
 * Trabaja con: modules/red/Network.jsx, backend/app/routers/red/router.py (/api/routers/{id}/olt/*),
 *              backend/app/integrations/olt/vsol.py (OLT_PROFILES)
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { RefreshCw, Terminal, Power, RotateCw, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { id: "system", label: "Resumen" },
  { id: "pon_optical", label: "Puertos PON" },
  { id: "onu_list", label: "ONUs" },
  { id: "onu_autofind", label: "Pendientes (auto-find)" },
  { id: "onu_optical", label: "Óptica ONUs" },
  { id: "console", label: "Consola" },
];
const PON_TABS = ["pon_optical", "onu_list", "onu_autofind", "onu_optical"];

export default function OltLiveTabs({ router }) {
  const { API, token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [tab, setTab] = useState("system");
  const [pon, setPon] = useState(1);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [cmd, setCmd] = useState("show version");
  const [auth, setAuth] = useState({ onu: "", sn: "", profile: "default" });

  const load = useCallback(async () => {
    if (tab === "console") return;
    setLoading(true);
    try {
      const r = await axios.get(`${API}/routers/${router.id}/olt/${tab}?pon=${pon}`, { headers });
      setRes(r.data);
    } catch (e) {
      setRes({ ok: false, error: e?.response?.data?.detail || "Sin respuesta del servidor" });
    } finally {
      setLoading(false);
    }
  }, [API, token, router.id, tab, pon]);

  useEffect(() => { setRes(null); load(); }, [load]);

  const runConsole = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await axios.post(`${API}/routers/${router.id}/olt/command`, { command: cmd }, { headers });
      setRes(r.data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Comando rechazado");
    } finally {
      setLoading(false);
    }
  };

  const onuAction = async (action, onu, sn = "") => {
    if (["delete", "deactivate", "reboot"].includes(action) && !window.confirm(`¿Ejecutar "${action}" sobre la ONU ${onu} del PON ${pon}?`)) return;
    try {
      const r = await axios.post(`${API}/routers/${router.id}/olt/onu/${action}`, { pon, onu: parseInt(onu) || 0, sn, profile: auth.profile }, { headers });
      toast.success(r.data.message);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "La OLT rechazó la acción");
    }
  };

  const rows = res?.rows || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const onuIdOf = (row) => row[cols.find((c) => /onu|index|id/i.test(c)) || cols[0]];
  const snOf = (row) => row[cols.find((c) => /sn|serial|mac/i.test(c))] || "";

  return (
    <div data-testid="olt-live-tabs">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 mb-3">
        {TABS.map((t) => (
          <button key={t.id} data-testid={`olt-tab-${t.id}`} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition ${tab === t.id ? "border-cyan-400 text-cyan-300" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-1 text-[11px] text-slate-400">
          {PON_TABS.includes(tab) && (
            <label className="flex items-center gap-1">PON
              <select data-testid="olt-pon-select" value={pon} onChange={(e) => setPon(parseInt(e.target.value))} className="p-1 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono">
                {Array.from({ length: router.pon_ports || 8 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>0/{n}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} className="accent-cyan-500" /> Salida cruda</label>
          {tab !== "console" && (
            <button data-testid="olt-refresh" onClick={load} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-cyan-400" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {tab === "console" && (
        <form onSubmit={runConsole} className="flex gap-2 mb-3 text-xs">
          <span className="p-2 text-cyan-400"><Terminal className="w-4 h-4" /></span>
          <input data-testid="olt-console-input" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="show onu info" className="flex-1 p-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono" />
          <button data-testid="olt-console-run" type="submit" disabled={loading} className="px-3 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-700/50 rounded-lg font-semibold">
            {loading ? "Ejecutando..." : "Ejecutar"}
          </button>
        </form>
      )}

      {tab === "onu_autofind" && (
        <div className="flex flex-wrap items-end gap-2 mb-3 text-xs p-3 rounded-xl bg-slate-950/60 border border-slate-800">
          <div><label className="block text-slate-400 mb-1">ID ONU a asignar</label><input data-testid="olt-auth-onu" value={auth.onu} onChange={(e) => setAuth({ ...auth, onu: e.target.value })} className="p-2 w-20 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono" /></div>
          <div><label className="block text-slate-400 mb-1">SN / MAC</label><input data-testid="olt-auth-sn" value={auth.sn} onChange={(e) => setAuth({ ...auth, sn: e.target.value })} placeholder="GPON00A1B2C3" className="p-2 w-44 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono" /></div>
          <div><label className="block text-slate-400 mb-1">Perfil ONU</label><input data-testid="olt-auth-profile" value={auth.profile} onChange={(e) => setAuth({ ...auth, profile: e.target.value })} className="p-2 w-28 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono" /></div>
          <button data-testid="olt-authorize-btn" disabled={!auth.sn} onClick={() => onuAction("authorize", auth.onu, auth.sn)} className="px-3 py-2 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-800/50 rounded-lg font-semibold flex items-center gap-1 disabled:opacity-40">
            <CheckCircle2 className="w-3.5 h-3.5" /> Autorizar ONU
          </button>
        </div>
      )}

      {res && !res.ok && <div data-testid="olt-error" className="p-4 bg-rose-950/30 border border-rose-900/50 rounded-xl text-xs text-rose-300">{res.error}</div>}

      {res?.ok && tab === "system" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {Object.entries(res.info || {}).map(([k, v]) => (
            <div key={k} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800"><p className="text-[10px] uppercase text-slate-500">{k}</p><p className="font-mono text-slate-100 mt-1 break-all">{v}</p></div>
          ))}
          {!Object.keys(res.info || {}).length && <p className="text-slate-500 col-span-4">La OLT respondió pero sin pares clave/valor; activa "Salida cruda".</p>}
        </div>
      )}

      {res?.ok && tab !== "system" && (
        rows.length ? (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs" data-testid={`olt-table-${tab}`}>
              <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
                <tr>{cols.map((c) => <th key={c} className="py-2.5 px-3 text-[10px]">{c}</th>)}{tab === "onu_list" && <th />}</tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {rows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-800/40">
                    {cols.map((c) => <td key={c} className={`py-2 px-3 font-mono ${/online|up|active/i.test(r[c]) ? "text-emerald-300" : /offline|down|los/i.test(r[c]) ? "text-rose-300" : ""}`}>{r[c]}</td>)}
                    {tab === "onu_list" && (
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <button title="Reiniciar" data-testid={`olt-onu-reboot-${onuIdOf(r)}`} onClick={() => onuAction("reboot", onuIdOf(r), snOf(r))} className="p-1.5 rounded-lg border border-slate-700 text-cyan-300 hover:bg-slate-800 mr-1"><RotateCw className="w-3.5 h-3.5" /></button>
                        <button title="Activar" data-testid={`olt-onu-activate-${onuIdOf(r)}`} onClick={() => onuAction("activate", onuIdOf(r), snOf(r))} className="p-1.5 rounded-lg border border-slate-700 text-emerald-300 hover:bg-emerald-900/20 mr-1"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                        <button title="Desactivar" onClick={() => onuAction("deactivate", onuIdOf(r), snOf(r))} className="p-1.5 rounded-lg border border-slate-700 text-amber-300 hover:bg-slate-800 mr-1"><Power className="w-3.5 h-3.5" /></button>
                        <button title="Eliminar" onClick={() => onuAction("delete", onuIdOf(r), snOf(r))} className="p-1.5 rounded-lg border border-slate-700 text-rose-400 hover:bg-rose-900/30"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p data-testid="olt-empty" className="p-4 text-center text-xs text-slate-500">La OLT respondió sin filas tabulares. {res.raw ? "Revisa la salida cruda." : "Sin registros."}</p>
        )
      )}

      {res?.ok && (showRaw || (tab === "console")) && (
        <pre data-testid="olt-raw" className="mt-3 p-3 rounded-xl bg-black/60 border border-slate-800 text-[11px] text-slate-300 font-mono whitespace-pre-wrap max-h-96 overflow-auto">{res.raw || "(sin salida)"}</pre>
      )}
    </div>
  );
}
