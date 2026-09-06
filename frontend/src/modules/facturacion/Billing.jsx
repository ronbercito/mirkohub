/**
 * Archivo: frontend/src/modules/facturacion/Billing.jsx
 * Función: Módulo Facturación: listado de facturas con filtros, emisión individual y masiva, registro de pagos (Yape, Plin, BCP, BBVA, Efectivo), impresión de comprobantes térmico/A4 y reactivación automática del servicio al pagar.
 * Trabaja con: backend/app/routers/facturacion/router.py (/api/invoices, /api/payments), modules/clientes/Clients.jsx
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { 
  DollarSign, FileText, CheckCircle2, Clock, AlertTriangle, 
  Printer, QrCode, ShieldAlert, Sparkles, Plus, Search, 
  CreditCard, Smartphone, Building2, User, Phone, MapPin
} from "lucide-react";
import { toast } from "sonner";

export default function Billing() {
  const { API, token, user } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Payment Modal
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payData, setPayData] = useState({
    payment_method: "Yape",
    amount: 0,
    operation_reference: "",
    notes: ""
  });

  // Printable Receipt Modal
  const [receiptToPrint, setReceiptToPrint] = useState(null);
  const [printFormat, setPrintFormat] = useState("thermal"); // thermal (80mm) or standard (A4)

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/invoices`, {
        params: { status: statusFilter, search },
        headers: { Authorization: `Bearer ${token}` }
      });
      setInvoices(res.data);
    } catch (e) {
      console.error(e);
      toast.error("Error al cargar las facturas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [statusFilter, search]);

  const handleOpenPayModal = (inv) => {
    setSelectedInvoice(inv);
    setPayData({
      payment_method: "Yape",
      amount: inv.amount,
      operation_reference: `OP-${Math.floor(100000 + Math.random() * 900000)}`,
      notes: ""
    });
    setShowPayModal(true);
  };

  const handleProcessPayment = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API}/payments`, {
        invoice_id: selectedInvoice.id,
        amount: parseFloat(payData.amount),
        payment_method: payData.payment_method,
        operation_reference: payData.operation_reference,
        notes: payData.notes
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("¡Pago registrado con éxito! Recibo emitido.");
      setShowPayModal(false);
      fetchInvoices();
      // Auto open printable receipt
      setReceiptToPrint(res.data.invoice);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Error al registrar pago");
    }
  };

  const handleMassGenerate = async () => {
    if (!window.confirm("¿Deseas generar masivamente los recibos de este mes para todos los clientes activos?")) return;
    try {
      const res = await axios.post(`${API}/invoices/mass-generate`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(res.data.message);
      fetchInvoices();
    } catch (e) {
      toast.error("Error en la facturación masiva");
    }
  };

  const handleSyncCuts = async () => {
    if (!window.confirm("¿Deseas ejecutar la regla de corte en MikroTik para clientes con facturas vencidas?")) return;
    try {
      const res = await axios.post(`${API}/routers/sync-cuts`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(res.data.message);
      fetchInvoices();
    } catch (e) {
      toast.error("Error al sincronizar cortes");
    }
  };

  // Metrics summary
  const totalInvoiced = invoices.reduce((acc, curr) => acc + (curr.amount || 0), 0);
  const totalPaid = invoices.filter(i => i.status === "paid").reduce((acc, curr) => acc + (curr.paid_amount || curr.amount || 0), 0);
  const totalUnpaid = invoices.filter(i => i.status !== "paid").reduce((acc, curr) => acc + (curr.amount || 0), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-emerald-400" /> Facturación, Cobranza y Recibos
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Emisión de recibos, registro de pagos (Yape, Plin, Efectivo, BCP) y corte por mora
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            data-testid={TEST_IDS.BTN_MASS_INVOICES}
            onClick={handleMassGenerate}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition"
          >
            <Sparkles className="w-4 h-4 text-cyan-400" /> Generar Facturación Masiva
          </button>

          <button
            data-testid={TEST_IDS.BTN_SYNC_CUTS}
            onClick={handleSyncCuts}
            className="px-3.5 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition"
          >
            <ShieldAlert className="w-4 h-4 text-rose-400" /> Aplicar Corte a Morosos
          </button>
        </div>
      </div>

      {/* Financial Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Facturado</p>
          <h3 className="text-2xl font-black text-slate-100 mt-1">S/. {totalInvoiced.toFixed(2)}</h3>
          <p className="text-[11px] text-slate-500 mt-1">{invoices.length} recibos emitidos</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Total Recaudado (Cobrado)</p>
          <h3 className="text-2xl font-black text-emerald-400 mt-1">S/. {totalPaid.toFixed(2)}</h3>
          <p className="text-[11px] text-slate-500 mt-1">{invoices.filter(i => i.status === "paid").length} pagados</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl">
          <p className="text-xs font-semibold text-rose-400 uppercase tracking-wider">Cuentas por Cobrar (Pendiente)</p>
          <h3 className="text-2xl font-black text-rose-400 mt-1">S/. {totalUnpaid.toFixed(2)}</h3>
          <p className="text-[11px] text-rose-300/80 mt-1">{invoices.filter(i => i.status !== "paid").length} recibos pendientes/vencidos</p>
        </div>
      </div>

      {/* Filter & Search */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Buscar por N° Recibo, cliente o DNI/RUC..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === "all" ? "bg-cyan-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setStatusFilter("paid")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === "paid" ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Pagados
          </button>
          <button
            onClick={() => setStatusFilter("unpaid")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === "unpaid" ? "bg-amber-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Pendientes
          </button>
          <button
            onClick={() => setStatusFilter("overdue")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === "overdue" ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Vencidos
          </button>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">N° Recibo / Periodo</th>
                <th className="py-3 px-4">Abonado / DNI-RUC</th>
                <th className="py-3 px-4">Plan / Concepto</th>
                <th className="py-3 px-4">Monto (S/.)</th>
                <th className="py-3 px-4">Vencimiento</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-slate-500">
                    Cargando facturas y recibos...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-slate-500">
                    No hay comprobantes para mostrar.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-mono font-bold text-slate-100">{inv.invoice_number}</div>
                      <div className="text-[11px] text-cyan-400">{inv.month_period}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-200">{inv.client_name}</div>
                      <div className="text-[11px] text-slate-400">DNI/RUC: {inv.client_dni_ruc}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-slate-300">{inv.plan_name}</div>
                      <div className="text-[10px] text-slate-500">{inv.notes || "Servicio mensual"}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-100 text-sm">
                        S/. {Number(inv.amount).toFixed(2)}
                      </div>
                      {inv.status === "paid" && (
                        <div className="text-[10px] text-emerald-400">
                          {inv.payment_method} ({inv.operation_reference || "OK"})
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-slate-300">{inv.due_date}</div>
                      <div className="text-[10px] text-slate-500">Emisión: {inv.issue_date}</div>
                    </td>

                    <td className="py-3 px-4">
                      {inv.status === "paid" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px] border border-emerald-500/30">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PAGADO
                        </span>
                      ) : inv.status === "overdue" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-bold text-[11px] border border-rose-500/30">
                          <AlertTriangle className="w-3.5 h-3.5" /> VENCIDO
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold text-[11px] border border-amber-500/30">
                          <Clock className="w-3.5 h-3.5" /> PENDIENTE
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {inv.status !== "paid" ? (
                          <button
                            onClick={() => handleOpenPayModal(inv)}
                            className="px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold rounded-lg shadow-sm flex items-center gap-1 text-[11px] transition"
                          >
                            <DollarSign className="w-3.5 h-3.5" /> Cobrar S/.
                          </button>
                        ) : (
                          <button
                            onClick={() => setReceiptToPrint(inv)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-medium rounded-lg flex items-center gap-1 text-[11px] transition"
                          >
                            <Printer className="w-3.5 h-3.5" /> Ver Recibo
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Processing Modal */}
      {showPayModal && selectedInvoice && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-400" /> Registrar Cobro de Recibo
              </h3>
              <button onClick={() => setShowPayModal(false)} className="text-slate-400 hover:text-slate-200">
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Abonado:</span>
                <span className="font-semibold text-slate-100">{selectedInvoice.client_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Comprobante:</span>
                <span className="font-mono text-cyan-400">{selectedInvoice.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Periodo:</span>
                <span className="text-slate-200">{selectedInvoice.month_period}</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-2 border-t border-slate-800">
                <span className="text-slate-300">Total a Pagar:</span>
                <span className="text-emerald-400">S/. {Number(selectedInvoice.amount).toFixed(2)}</span>
              </div>
            </div>

            <form onSubmit={handleProcessPayment} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Método de Pago *</label>
                <div className="grid grid-cols-2 gap-2">
                  {["Yape", "Plin", "Efectivo", "Transferencia BCP", "Transferencia BBVA", "Interbank"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayData({ ...payData, payment_method: m })}
                      className={`p-2 rounded-xl border text-center font-medium transition ${
                        payData.payment_method === m
                          ? "bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold"
                          : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Monto Recibido (S/.) *</label>
                <input
                  type="number"
                  step="0.10"
                  required
                  value={payData.amount}
                  onChange={(e) => setPayData({ ...payData, amount: e.target.value })}
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-emerald-400 font-bold text-sm"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">N° Operación / Referencia</label>
                <input
                  type="text"
                  value={payData.operation_reference}
                  onChange={(e) => setPayData({ ...payData, operation_reference: e.target.value })}
                  placeholder="Ej. OP-449102 o N° de Yape"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold rounded-xl shadow-lg"
                >
                  Confirmar Pago y Emitir Recibo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Receipt Preview Modal */}
      {receiptToPrint && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Printer className="w-5 h-5 text-cyan-400" /> Vista Previa del Recibo
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPrintFormat(printFormat === "thermal" ? "standard" : "thermal")}
                  className="px-2 py-1 bg-slate-800 text-[11px] text-cyan-300 rounded border border-slate-700"
                >
                  Formato: {printFormat === "thermal" ? "Ticket 80mm" : "Estándar A4"}
                </button>
                <button onClick={() => setReceiptToPrint(null)} className="text-slate-400 hover:text-slate-200">
                  ✕
                </button>
              </div>
            </div>

            {/* Receipt Content Container styled for paper print */}
            <div className="bg-white text-slate-900 p-6 rounded-xl font-mono text-xs shadow-inner select-all">
              {printFormat === "thermal" ? (
                /* 80mm Thermal Receipt Format */
                <div className="max-w-[300px] mx-auto text-center space-y-2 leading-tight">
                  <h2 className="text-lg font-black tracking-wider">FIBRAZ PERÚ S.A.C.</h2>
                  <p className="text-[10px]">RUC: 20608934521</p>
                  <p className="text-[10px]">Av. Las Palmeras 1450, Los Olivos</p>
                  <p className="text-[10px]">Central: +51 987 654 321</p>
                  <div className="border-b border-dashed border-slate-400 my-2"></div>
                  
                  <p className="font-bold text-sm">RECIBO DE SERVICIO</p>
                  <p className="font-bold">{receiptToPrint.invoice_number}</p>
                  <p className="text-[11px]">Fecha: {receiptToPrint.payment_date ? receiptToPrint.payment_date.split("T")[0] : receiptToPrint.issue_date}</p>
                  <div className="border-b border-dashed border-slate-400 my-2"></div>

                  <div className="text-left space-y-1 text-[11px]">
                    <p><span className="font-bold">Cliente:</span> {receiptToPrint.client_name}</p>
                    <p><span className="font-bold">DNI/RUC:</span> {receiptToPrint.client_dni_ruc}</p>
                    <p><span className="font-bold">Dirección:</span> {receiptToPrint.client_address}</p>
                    <p><span className="font-bold">Periodo:</span> {receiptToPrint.month_period}</p>
                  </div>
                  <div className="border-b border-dashed border-slate-400 my-2"></div>

                  <div className="text-left space-y-1 text-[11px]">
                    <div className="flex justify-between font-bold">
                      <span>Concepto</span>
                      <span>Total</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{receiptToPrint.plan_name}</span>
                      <span>S/. {Number(receiptToPrint.amount).toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="border-b border-dashed border-slate-400 my-2"></div>

                  <div className="flex justify-between text-sm font-black py-1">
                    <span>TOTAL COBRADO:</span>
                    <span>S/. {Number(receiptToPrint.paid_amount || receiptToPrint.amount).toFixed(2)}</span>
                  </div>
                  <p className="text-left text-[10px]">Medio: {receiptToPrint.payment_method || "Efectivo"} ({receiptToPrint.operation_reference || "CONFORME"})</p>
                  <p className="text-left text-[10px]">Atendido por: {receiptToPrint.operator_name || user?.name || "Administración"}</p>

                  <div className="pt-3 flex flex-col items-center">
                    <div className="w-20 h-20 bg-slate-100 border border-slate-300 rounded flex items-center justify-center">
                      <QrCode className="w-16 h-16 text-slate-800" />
                    </div>
                    <p className="text-[9px] mt-1 text-slate-500">Comprobante de Pago Electrónico FibraZ</p>
                    <p className="text-[9px] font-bold mt-1">¡Gracias por su preferencia!</p>
                  </div>
                </div>
              ) : (
                /* Standard A4 Receipt Format */
                <div className="space-y-4">
                  <div className="flex justify-between items-start border-b border-slate-300 pb-3">
                    <div>
                      <h2 className="text-xl font-extrabold text-cyan-800">FIBRAZ PERÚ S.A.C.</h2>
                      <p className="text-xs text-slate-600">Servicios de Telecomunicaciones e Internet de Alta Velocidad</p>
                      <p className="text-xs text-slate-600">RUC: 20608934521 | Tel: +51 987 654 321</p>
                    </div>
                    <div className="text-right border border-cyan-800 p-2 rounded bg-cyan-50">
                      <p className="text-xs font-bold text-cyan-900 uppercase">RECIBO DE CAJA</p>
                      <p className="text-sm font-black text-cyan-950">{receiptToPrint.invoice_number}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p><span className="font-bold">Abonado:</span> {receiptToPrint.client_name}</p>
                      <p><span className="font-bold">DNI/RUC:</span> {receiptToPrint.client_dni_ruc}</p>
                      <p><span className="font-bold">Dirección:</span> {receiptToPrint.client_address}</p>
                    </div>
                    <div>
                      <p><span className="font-bold">Periodo facturado:</span> {receiptToPrint.month_period}</p>
                      <p><span className="font-bold">Fecha de pago:</span> {receiptToPrint.payment_date ? receiptToPrint.payment_date.split("T")[0] : receiptToPrint.issue_date}</p>
                      <p><span className="font-bold">Método:</span> {receiptToPrint.payment_method || "Efectivo"}</p>
                    </div>
                  </div>

                  <table className="w-full text-left text-xs border border-slate-300 mt-2">
                    <thead className="bg-slate-100 font-bold border-b border-slate-300">
                      <tr>
                        <th className="p-2">Descripción del Servicio</th>
                        <th className="p-2 text-right">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="p-2">Servicio de Internet Fibra Óptica - {receiptToPrint.plan_name}</td>
                        <td className="p-2 text-right font-bold">S/. {Number(receiptToPrint.amount).toFixed(2)}</td>
                      </tr>
                    </tbody>
                    <tfoot className="border-t border-slate-300 bg-slate-50">
                      <tr>
                        <td className="p-2 font-black text-right">TOTAL PAGADO:</td>
                        <td className="p-2 text-right font-black text-emerald-700">S/. {Number(receiptToPrint.paid_amount || receiptToPrint.amount).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-lg"
              >
                <Printer className="w-4 h-4" /> Imprimir Comprobante
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
