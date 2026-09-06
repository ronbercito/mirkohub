/**
 * Archivo: frontend/src/modules/red/components/OltLiveTabs.jsx
 * Pertenece a: Red > OLT.
 * Función: ORQUESTADOR de pestañas OLT. Sólo controla pestaña activa, PON, carga API,
 *          acciones comunes y enlaza cada pestaña con su archivo independiente.
 * Regla de arquitectura: NO implementar aquí el contenido de una pestaña. Cada menú,
 *          pestaña o submenú debe vivir en su propio archivo con comentario de propósito.
 * Trabaja con: ./olt-tabs/*.jsx y backend /api/routers/{id}/olt/*.
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import OltSummaryTab from "./olt-tabs/OltSummaryTab";
import OltPonPortsTab from "./olt-tabs/OltPonPortsTab";
import OltOnusTab from "./olt-tabs/OltOnusTab";
import OltAutofindTab from "./olt-tabs/OltAutofindTab";
import OltOnuOpticalTab from "./olt-tabs/OltOnuOpticalTab";
import OltConsoleTab from "./olt-tabs/OltConsoleTab";

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
  const [onuRefreshSeq, setOnuRefreshSeq] = useState(0);

  const load = useCallback(async () => {
    if (tab === "console") return;

    // ONUs v2 tiene endpoint, parser y estado propios. No ejecutar aquí el antiguo
    // /olt/onu_list porque volvería a introducir el parser que generaba IDs 101/111/121.
    if (tab === "onu_list") {
      setRes({ ok: true, raw: "" });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await axios.get(
        `${API}/routers/${router.id}/olt/${tab}?pon=${pon}`,
        { headers },
      );
      setRes(response.data);
    } catch (error) {
      setRes({
        ok: false,
        error: error?.response?.data?.detail || "Sin respuesta del servidor",
      });
    } finally {
      setLoading(false);
    }
  }, [API, token, router.id, tab, pon]);

  useEffect(() => {
    setRes(null);
    load();
  }, [load]);

  const runConsole = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await axios.post(
        `${API}/routers/${router.id}/olt/command`,
        { command: cmd },
        { headers },
      );
      setRes(response.data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Comando rechazado");
    } finally {
      setLoading(false);
    }
  };

  const onuAction = async (action, onu, sn = "") => {
    if (
      ["delete", "deactivate", "reboot"].includes(action)
      && !window.confirm(`¿Ejecutar "${action}" sobre la ONU ${onu} del PON ${pon}?`)
    ) {
      return;
    }

    try {
      const response = await axios.post(
        `${API}/routers/${router.id}/olt/onu/${action}`,
        {
          pon,
          onu: parseInt(onu) || 0,
          sn,
          profile: auth.profile,
        },
        { headers },
      );
      toast.success(response.data.message);
      if (tab === "onu_list") {
        setOnuRefreshSeq((value) => value + 1);
      } else {
        await load();
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "La OLT rechazó la acción");
    }
  };

  return (
    <div data-testid="olt-live-tabs">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 mb-3">
        {TABS.map((item) => (
          <button
            key={item.id}
            data-testid={`olt-tab-${item.id}`}
            onClick={() => setTab(item.id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition ${
              tab === item.id
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {item.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 pb-1 text-[11px] text-slate-400">
          {PON_TABS.includes(tab) && (
            <label className="flex items-center gap-1">
              PON
              <select
                data-testid="olt-pon-select"
                value={pon}
                onChange={(event) => setPon(parseInt(event.target.value))}
                className="p-1 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono"
              >
                {Array.from({ length: router.pon_ports || 8 }, (_, index) => index + 1).map((number) => (
                  <option key={number} value={number}>0/{number}</option>
                ))}
              </select>
            </label>
          )}

          {tab !== "console" && (
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={showRaw}
                onChange={(event) => setShowRaw(event.target.checked)}
                className="accent-cyan-500"
              />
              Salida cruda
            </label>
          )}

          {tab !== "console" && (
            <button
              data-testid="olt-refresh"
              onClick={tab === "onu_list" ? () => setOnuRefreshSeq((value) => value + 1) : load}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-cyan-400" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {res && !res.ok && (
        <div
          data-testid="olt-error"
          className="p-4 bg-rose-950/30 border border-rose-900/50 rounded-xl text-xs text-rose-300"
        >
          {res.error}
        </div>
      )}

      {res?.ok && tab === "system" && <OltSummaryTab res={res} />}

      {res?.ok && tab === "pon_optical" && (
        <OltPonPortsTab res={res} pon={pon} loading={loading} />
      )}

      {res?.ok && tab === "onu_list" && (
        <OltOnusTab
          router={router}
          pon={pon}
          onAction={onuAction}
          refreshSeq={onuRefreshSeq}
          showRaw={showRaw}
        />
      )}

      {res?.ok && tab === "onu_autofind" && (
        <OltAutofindTab
          res={res}
          auth={auth}
          setAuth={setAuth}
          onAuthorize={() => onuAction("authorize", auth.onu, auth.sn)}
        />
      )}

      {res?.ok && tab === "onu_optical" && <OltOnuOpticalTab res={res} />}

      {tab === "console" && (
        <OltConsoleTab
          cmd={cmd}
          setCmd={setCmd}
          loading={loading}
          onRun={runConsole}
          res={res}
        />
      )}

      {res?.ok && showRaw && tab !== "console" && tab !== "onu_list" && (
        <pre
          data-testid="olt-raw"
          className="mt-3 p-3 rounded-xl bg-black/60 border border-slate-800 text-[11px] text-slate-300 font-mono whitespace-pre-wrap max-h-96 overflow-auto"
        >
          {res.raw || "(sin salida)"}
        </pre>
      )}
    </div>
  );
}
