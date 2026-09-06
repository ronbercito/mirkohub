"""
Archivo: backend/tests/test_onu_power.py
Área: Pruebas de Red > OLT > ONUs > RX.
Función: Regresión con salida optical_info y sesión CLI simulada.
Alcance: Parser, caché y errores; no conecta ni modifica equipos reales.
"""
import unittest
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock
from app.routers.red import olt_onu_power as power

RAW = """Alarm                      : enable
Piggyback DBA rpt mode     : mode 0 and 1
Rx optical level(ONU)      : -16.73
Lower rx optical threshold : -28.00
Upper rx optical threshold : -8.00
Tx optical level           : 2.00
Lower tx optical threshold : ont internal policy
Upper tx optical threshold : ont internal policy
ONU response time          : 0
Power feed voltage         : 3.20(V)
Laser bias current         : 11.550(mA)
Temperature                : 44.074(C)
"""


class OpticalTests(unittest.IsolatedAsyncioTestCase):
    def test_exact_labels(self):
        row = power.parse_optical_info(RAW)
        self.assertEqual(row, {"rx_dbm": -16.73, "tx_dbm": 2.0,
                              "voltage_v": 3.2, "bias_ma": 11.55, "temperature_c": 44.074})
        self.assertIsNone(power.parse_optical_info("Lower rx optical threshold : -28.00")["rx_dbm"])
        self.assertIsNone(power.parse_optical_info("% Command incomplete.")["rx_dbm"])
        self.assertIsNone(power.parse_optical_info("")["rx_dbm"])
        self.assertEqual(power.parse_optical_info("\x1b[32m" + RAW + "\x1b[0m")["rx_dbm"], -16.73)

    async def test_one_command_and_cache(self):
        power._cache.clear()
        cli = AsyncMock()
        cli.__aenter__.return_value = cli
        cli.run_pon.return_value = RAW
        with patch.object(power, "get_or_404", AsyncMock(return_value=SimpleNamespace(device_type="olt", pon_ports=8))), patch.object(power.olt_service, "connect", return_value=cli):
            first = await power.onu_power("test", 1, 1, None)
            second = await power.onu_power("test", 1, 1, None)
            self.assertTrue(first["ok"])
            self.assertTrue(second["cached"])
            cli.run_pon.assert_awaited_once_with(1, "show onu 1 optical_info", raise_on_error=False)
            self.assertEqual(first["measured_at"], second["measured_at"])
            power._cache.clear()
            cli.run_pon.return_value = ""
            empty = await power.onu_power("test", 1, 1, None)
            self.assertFalse(empty["ok"])
            self.assertIsNone(empty["rx_dbm"])
        self.assertNotIn("test", power._busy)


if __name__ == "__main__":
    unittest.main()
