/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu-v2/OnuOpticalView.jsx
 * Área: Red > OLT > ONUs > Potencia Óptica ONU.
 * Función: Selector de todas/una ONU, tarjetas RX/TX y barras de potencia.
 * Alcance: Orquesta useOnuOpticalScan; cada lectura conserva su fecha.
 * No modifica inventario, CLI, acciones ni otros submenús.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Activity, Download, Square, Radio } from "lucide-react";
import useOnuOpticalScan from "./useOnuOpticalScan";

const valid = (v) => typeof v === "number" && Number.isFinite(v);
const dbm = (v) => valid(v) ? v.toFixed(2) + " dBm" : "—";
const keyOf = (onu) => onu.pon_id + ":" + onu.onu_id;
const average = (rows, key) => {
  const values = rows.map((r) => r[key]).filter(valid);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
};

export default function OnuOpticalView({ onus = [], routerId }) {
  const [selected, setSelected] = useState("all");
  const [auto, setAuto] = useState(false);
  const { samples, running, progress, message, scan, stop } = useOnuOpticalScan(routerId);
  const targets = useMemo(() => selected === "all" ? onus : onus.filter((onu) => keyOf(onu) === selected), [onus, selected]);
  const measured = targets.map((onu) => samples[keyOf(onu)]).filter((s) => s?.ok && valid(s.rx_dbm));
  const rx = average(measured, "rx_dbm");
  const tx = average(measured, "tx_dbm");
  useEffect(() => {
    if (!auto || selected === "all" || running || message) return undefined;
    const timer = setTimeout(() => scan(targets), 30000);
    return () => clearTimeout(timer);
  }, [auto, selected, running, message, scan, targets]);
  const start = () => scan(targets);
  const halt = () => { setAuto(false); stop(); };
  const change = (e) => { setAuto(false); setSelected(e.target.value); };
  return (
    <section className="space-y-4" aria-label="Panel de potencia óptica">
      <div className="rounded-2xl border border-cyan-900/50 bg-gradient-to-br from-cyan-950/30 to-slate-950 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-300"><Radio className="w-6 h-6" /></div>
          <div><h3 className="text-base font-semibold text-slate-100">Monitor óptico</h3>
            <p className="text-xs text-slate-400">Consulta por cliente o revisa todo el PON.</p></div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[220px] text-xs text-slate-400">
            Seleccionar ONU
            <select value={selected} onChange={change} disabled={running} className="block mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-slate-100">
              <option value="all">Todas las ONUs ({onus.length})</option>
              {onus.map((onu) => <option key={keyOf(onu)} value={keyOf(onu)}>
                PON {onu.pon_id} · ONU {onu.onu_id} · {onu.description || "Sin descripción"}
              </option>)}
            </select>
          </label>
          <button type="button" disabled={running || !targets.length} onClick={start} className="flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-4 py-3 text-xs font-semibold text-white">
            <Download className="w-4 h-4" />{running ? "Consultando…" : selected === "all" ? "Consultar todas" : "Consultar ONU"}
          </button>
          <button type="button" disabled={!running && !auto} onClick={halt} className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-xs text-slate-200 disabled:opacity-30">
            <Square className="w-4 h-4" />Detener
          </button>
        </div>
        <label className="mt-4 flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={auto} disabled={selected === "all"} onChange={(e) => setAuto(e.target.checked)} />
          Repetir cada 30 s tras finalizar (solo una ONU)
        </label>
        <p className="mt-2 text-[11px] text-slate-400">Todas: lectura secuencial con 2 s de pausa entre equipos; puede tardar varios minutos. Se detiene al ocultar la página. No son mediciones simultáneas.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          [selected === "all" ? "RX promedio leído" : "RX recibido en ONU", dbm(rx), "text-cyan-300"],
          [selected === "all" ? "TX promedio leído" : "TX transmitido", dbm(tx), "text-violet-300"],
          ["ONUs con lectura válida", measured.length + " / " + targets.length, "text-slate-100"],
        ].map(([label, value, color]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
          <p className={"mt-2 text-2xl font-mono font-semibold " + color}>{value}</p>
        </div>)}
      </div>
      {!!progress.total && <div className="rounded-xl border border-slate-800 p-3" role="status">
        <div className="flex justify-between text-xs text-slate-400 mb-2"><span>{running ? "Leyendo equipos" : "Última consulta"}</span><span>{progress.done} / {progress.total}</span></div>
        <progress className="w-full h-2 accent-cyan-400" value={progress.done} max={progress.total} />
      </div>}
      {message && <p role="alert" className="rounded-xl bg-amber-950/30 p-3 text-xs text-amber-300">{message}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[780px] text-left text-xs">
          <thead className="bg-slate-900 text-slate-400 text-[10px] uppercase">
            <tr>{["ONU / cliente", "RX", "TX", "Escala RX (−35 a +5 dBm)", "Hora de lectura"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {targets.map((onu) => {
              const s = samples[keyOf(onu)];
              const has = s?.ok && valid(s.rx_dbm);
              const width = has ? Math.min(100, Math.max(0, (s.rx_dbm + 35) / 40 * 100)) : 0;
              return <tr key={keyOf(onu)} className="border-t border-slate-800 hover:bg-slate-900/50">
                <td className="p-3"><div className="font-semibold text-cyan-200">PON {onu.pon_id} · ONU {onu.onu_id}</div><div className="mt-1 max-w-[280px] break-words text-slate-300">{onu.description || "Sin descripción"}</div></td>
                <td className="p-3 font-mono text-cyan-200">{has ? dbm(s.rx_dbm) : "—"}</td>
                <td className="p-3 font-mono text-violet-200">{has ? dbm(s.tx_dbm) : "—"}</td>
                <td className="p-3 min-w-[200px]">
                  {has ? <><div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-cyan-400 rounded-full transition-all" style={{ width: width + "%" }} /></div><span className="text-[9px] text-slate-500">Escala visual, no diagnóstico de calidad</span></> : <span className="text-slate-500" title={s?.error}>{s ? "Sin lectura válida" : "Pendiente de consulta"}</span>}
                </td>
                <td className="p-3 text-slate-400">{has ? <><Activity className="inline w-3 h-3 mr-1" />{new Date(s.measured_at).toLocaleTimeString()}<div className="text-[9px]">{s.cached ? "Lectura en caché" : "Última medición"}</div></> : "—"}</td>
              </tr>;
            })}
            {!targets.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No hay ONUs autorizadas en esta selección.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
