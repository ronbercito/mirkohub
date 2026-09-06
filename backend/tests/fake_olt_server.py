"""Servidor OLT VSOL simulado (Telnet) para pruebas locales del panel."""
import asyncio
import sys

ONU_TABLE = (
    "OnuIndex  Type   Status   SN            Distance(m)  Description\r\n"
    "1         HGU    online   GPON00A1B2C3  1234         Juan Perez\r\n"
    "2         SFU    offline  GPON00A1B2C4  2200         -\r\n"
)
OPT = (
    "OnuIndex  RxPower(dBm)  TxPower(dBm)  Temp(C)\r\n"
    "1         -19.52        2.10          45\r\n"
    "2         -27.80        2.30          41\r\n"
)
AUTOFIND = (
    "Index  SN            Type  Time\r\n"
    "1      GPON00FFEE01  HGU   2026-06-05 10:00\r\n"
)
VERSION = (
    "Product name : V1600G1-B\r\n"
    "Hardware version : V1.0\r\n"
    "Software version : V1.5.2R\r\n"
    "Uptime : 3 days 4:12:33\r\n"
)
DETAIL = (
    "ONU ID : 1\r\n"
    "SN : GPON00A1B2C3\r\n"
    "Type : HGU\r\n"
    "Status : online\r\n"
)


async def handle(reader, writer):
    async def send(s):
        writer.write(s.encode())
        await writer.drain()

    async def line():
        return (await reader.readline()).decode(errors="ignore").strip()

    prompt = "V1600G1-B> "

    try:
        await send("\r\nLogin: ")
        u = await line()
        await send("Password: ")
        p = await line()

        if (u, p) != ("admin", "admin"):
            await send("Login incorrect\r\n")
            writer.close()
            return

        await send("\r\n" + prompt)

        while True:
            cmd = await line()
            if not cmd and reader.at_eof():
                break

            if cmd == "enable":
                await send("Password: ")
                _ = await line()
                prompt = "V1600G1-B# "
                await send("\r\n" + prompt)
                continue

            if cmd in ("configure terminal", "conf t"):
                prompt = "V1600G1-B(config)# "
                await send(cmd + "\r\n" + prompt)
                continue

            if cmd.startswith("interface gpon"):
                pon = cmd.split("gpon", 1)[1].strip()
                prompt = f"V1600G1-B(config-pon-{pon})# "
                await send(cmd + "\r\n" + prompt)
                continue

            if cmd.startswith("interface epon"):
                epon = cmd.split("epon", 1)[1].strip()
                prompt = f"V1600G1-B(config-epon-{epon})# "
                await send(cmd + "\r\n" + prompt)
                continue

            if cmd == "exit":
                if "config-pon-" in prompt or "config-epon-" in prompt:
                    prompt = "V1600G1-B(config)# "
                elif "(config)#" in prompt:
                    prompt = "V1600G1-B# "
                else:
                    prompt = "V1600G1-B# "
                await send(cmd + "\r\n" + prompt)
                continue

            body = {
                "show onuinfo": ONU_TABLE,
                "show onu info": ONU_TABLE,
                "show pon onu all rx-power": OPT,
                "show pon onu all rx": OPT,
                "show pon onu all rx transceiver": OPT,
                "show onu auto-find": AUTOFIND,
                "show onu auto-find detail-info": AUTOFIND,
                "show version": VERSION,
                "show onu detail-info 1": DETAIL,
                "show onu 1 detail-info": DETAIL,
                "show pon optical transceiver": (
                    "TxPower(dBm)  RxPower(dBm)  Temp(C)  Voltage(V)\r\n"
                    "4.2           -12.3         48       3.3\r\n"
                ),
                "show pon statistics": (
                    "RxPackets   TxPackets   RxBytes   TxBytes\r\n"
                    "1000        1200        100000    120000\r\n"
                ),
            }.get(cmd)

            if body is not None:
                await send(cmd + "\r\n" + body + prompt)
            elif cmd.startswith(("onu ", "no onu", "write")):
                await send(cmd + "\r\nOK\r\n" + prompt)
            else:
                await send(cmd + "\r\n% Unknown command\r\n" + prompt)

    except Exception:
        pass


async def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 2323
    srv = await asyncio.start_server(handle, "127.0.0.1", port)
    async with srv:
        await srv.serve_forever()


asyncio.run(main())
