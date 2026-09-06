import React from "react";
import { Gauge, RadioTower, Thermometer, Zap } from "lucide-react";

const METRICS = [
  {
    key: "temperature",
    label: "Temperatura",
    aliases: ["temperature", "temperatura"],
    icon: Thermometer,
    unit: "°C",
    min: 0,
    max: 85,
    hint: "Temperatura interna del módulo óptico",
  },
  {
    key: "voltage",
    label: "Voltaje",
    aliases: ["voltage", "voltaje"],
    icon: Zap,
    unit: "V",
    min: 0,
    max: 5,
    hint: "Voltaje de alimentación del transceptor",
  },
  {
    key: "txbias",
    label: "Corriente láser",
    aliases: ["txbias", "tx bias", "bias"],
    icon: Gauge,
    unit: "mA",
    min: 0,
    max: 100,
    hint: "Corriente de polarización del láser TX",
  },
  {
    key: "txpower",
    label: "Potencia TX",
    aliases: ["txpower", "tx power"],
    icon: RadioTower,
    unit: "dBm",
    min: -10,
    max: 15,
    hint: "Potencia óptica transmitida por el puerto",
  },
  {
    key: "rxpower",
    label: "Potencia RX",
    aliases: ["rxpower", "rx power"],
    icon: RadioTower,
    unit: "dBm",
    min: -40,
    max: 5,
    hint: "Potencia óptica recibida por el puerto",
  },
];

const parseNumeric = (value) => {
  const match = String(value ?? "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const textSource = (res) => {
  const parts = [];

  if (res?.raw) parts.push(String(res.raw));

  for (const [key, value] of Object.entries(res?.info || {})) {
    parts.push(`${key}: ${value}`);
  }

  for (const row of res?.rows || []) {
    for (const [key, value] of Object.entries(row || {})) {
      parts.push(`${key}: ${value}`);
    }
  }

  return parts.join("\n");
};

const readMetrics = (res) => {
  const source = textSource(res);

  return METRICS.map((definition) => {
    for (const alias of definition.aliases) {
      const aliasPattern = alias.replace(/\s+/g, "\\s*");
      const regex = new RegExp(
        `${aliasPattern}\\s*:?\\s*(-?\\d+(?:[.,]\\d+)?)\\s*([a-zA-Z°%]+)?`,
        "i",
      );
      const match = source.match(regex);

      if (match) {
        return {
          ...definition,
          value: parseNumeric(match[1]),
          display: `${match[1]} ${match[2] || definition.unit}`.trim(),
        };
      }
    }

    return null;
  }).filter(Boolean);
};

const meterPercent = (metric) => {
  if (metric?.value == null || Number.isNaN(metric.value)) return 0;

  const span = metric.max - metric.min;
  if (span <= 0) return 0;

  return Math.max(
    4,
    Math.min(100, ((metric.value - metric.min) / span) * 100),
  );
};

function MetricCard({ metric }) {
  const Icon = metric.icon;
  const percent = meterPercent(metric);

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-cyan-700/60 hover:bg-slate-950">
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-cyan-500/5 blur-2xl" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-800/40 bg-cyan-950/40 text-cyan-300">
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {metric.label}
            </p>
            <p className="mt-1 truncate font-mono text-xl font-bold text-slate-100">
              {metric.display}
            </p>
          </div>
        </div>

        <span className="shrink-0 rounded-full border border-emerald-800/40 bg-emerald-950/30 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
          Lectura
        </span>
      </div>

      <div className="relative mt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-cyan-400/80 transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          {metric.hint}
        </p>
      </div>
    </div>
  );
}

export default function PonOpticalPanel({ res, pon, loading }) {
  const metrics = readMetrics(res);

  return (
    <div className="space-y-3" data-testid="olt-pon-visual-panel">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950/90 to-cyan-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-700/40 bg-cyan-500/10 text-cyan-300">
            <RadioTower className="h-5 w-5" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-slate-100">Puerto PON 0/{pon}</h4>
              <span className="rounded-full border border-cyan-800/40 bg-cyan-950/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-300">
                GPON
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Diagnóstico óptico del transceptor del puerto seleccionado
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span
            className={`h-2 w-2 rounded-full ${
              loading ? "animate-pulse bg-amber-400" : "bg-emerald-400"
            }`}
          />
          {loading ? "Actualizando lectura..." : `${metrics.length} métricas disponibles`}
        </div>
      </div>

      {metrics.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center">
          <RadioTower className="mx-auto h-6 w-6 text-slate-600" />
          <p className="mt-2 text-xs font-semibold text-slate-300">
            La OLT respondió, pero no pude identificar las métricas ópticas.
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            Activa “Salida cruda” para revisar el formato recibido.
          </p>
        </div>
      )}
    </div>
  );
}
