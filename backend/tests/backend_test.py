"""Regression suite for FibraZ / MikroSmart ISP panel (MariaDB migration).

Cubre: auth, dashboard, planes, red/routers (MikroTik inalcanzable),
clientes, facturacion/pagos, tickets, almacen, hotspot, tareas,
mensajeria y ajustes.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 25
UNREACHABLE_IP = "10.255.255.1"


# ------------------------- fixtures -------------------------
@pytest.fixture(scope="session")
def auth_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@fibraz.pe", "password": "admin123"},
                      timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == "admin@fibraz.pe"
    assert body["token"]
    return {"Authorization": f"Bearer {body['token']}"}


@pytest.fixture(scope="session")
def seeded_plan(auth_headers):
    payload = {"name": f"TEST Plan {uuid.uuid4().hex[:6]}",
               "download_speed_mbps": 50, "upload_speed_mbps": 25, "price": 79.9}
    r = requests.post(f"{API}/plans", headers=auth_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield r.json()
    requests.delete(f"{API}/plans/{pid}", headers=auth_headers, timeout=TIMEOUT)


@pytest.fixture(scope="session")
def seeded_router(auth_headers):
    payload = {"name": f"TEST MK {uuid.uuid4().hex[:5]}", "device_type": "mikrotik",
               "ip_address": UNREACHABLE_IP, "port": 8728, "username": "admin", "password": "x"}
    r = requests.post(f"{API}/routers", headers=auth_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "offline"
    assert body["connection"]["ok"] is False
    assert "password" not in body
    assert body.get("has_password") is True
    yield body
    requests.delete(f"{API}/routers/{body['id']}", headers=auth_headers, timeout=TIMEOUT)


# ------------------------- auth -------------------------
def test_login_invalid():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@fibraz.pe", "password": "wrong"}, timeout=TIMEOUT)
    assert r.status_code == 401


def test_protected_requires_token():
    r = requests.get(f"{API}/clients", timeout=TIMEOUT)
    assert r.status_code in (401, 403)


def test_auth_me(auth_headers):
    r = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    u = r.json()["user"]
    assert u["email"] == "admin@fibraz.pe" and u["role"] == "admin"


# ------------------------- dashboard -------------------------
def test_dashboard_summary(auth_headers):
    r = requests.get(f"{API}/dashboard/summary", headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("kpi", "system_status", "bandwidth_gauge", "last_7_days",
                "recent_payments", "recent_connected"):
        assert key in data, f"missing {key}"
    assert len(data["last_7_days"]) == 7


# ------------------------- plans CRUD -------------------------
def test_plans_crud(auth_headers):
    payload = {"name": f"TEST P {uuid.uuid4().hex[:5]}", "download_speed_mbps": 100,
               "upload_speed_mbps": 20, "price": 99.9}
    r = requests.post(f"{API}/plans", headers=auth_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200
    pid = r.json()["id"]

    lst = requests.get(f"{API}/plans", headers=auth_headers, timeout=TIMEOUT).json()
    match = [p for p in lst if p["id"] == pid]
    assert match and "rate_limit" in match[0] and "profile_name" in match[0]

    upd = requests.put(f"{API}/plans/{pid}", headers=auth_headers,
                       json={**payload, "price": 88.0}, timeout=TIMEOUT)
    assert upd.status_code == 200 and upd.json()["price"] == 88.0

    d = requests.delete(f"{API}/plans/{pid}", headers=auth_headers, timeout=TIMEOUT)
    assert d.status_code == 200


# ------------------------- routers / red -------------------------
def test_routers_list_no_password(auth_headers, seeded_router):
    lst = requests.get(f"{API}/routers", headers=auth_headers, timeout=TIMEOUT).json()
    for r in lst:
        assert "password" not in r
        assert "has_password" in r


def test_router_edit_keeps_password_when_empty(auth_headers, seeded_router):
    rid = seeded_router["id"]
    payload = {"name": seeded_router["name"] + " up", "device_type": "mikrotik",
               "ip_address": UNREACHABLE_IP, "port": 8728, "username": "admin", "password": ""}
    r = requests.put(f"{API}/routers/{rid}", headers=auth_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200
    assert r.json().get("has_password") is True


def test_router_test_connection_offline(auth_headers, seeded_router):
    r = requests.post(f"{API}/routers/{seeded_router['id']}/test-connection",
                      headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "message" in body


def test_router_ping_offline(auth_headers, seeded_router):
    r = requests.post(f"{API}/routers/{seeded_router['id']}/ping",
                      headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert body["latency_ms"] is None
    assert body["status"] == "offline"


@pytest.mark.parametrize("ep", [
    "interfaces", "pppoe/active", "pppoe/secrets", "queues",
    "dhcp-leases", "address-list", "hotspot/active"
])
def test_router_live_endpoints_502(auth_headers, seeded_router, ep):
    r = requests.get(f"{API}/routers/{seeded_router['id']}/{ep}",
                     headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 502, f"{ep} => {r.status_code}: {r.text[:120]}"
    # NOTE: la infra (Cloudflare/ingress) reemplaza el body de 502 con HTML propio,
    # el detail JSON de FastAPI no llega al cliente en producción preview.


def test_sync_cuts(auth_headers):
    r = requests.post(f"{API}/routers/sync-cuts", headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    assert "clients_affected" in r.json()


# ------------------------- clients -------------------------
@pytest.fixture(scope="session")
def seeded_client(auth_headers, seeded_plan, seeded_router):
    payload = {
        "full_name": f"TEST Cliente {uuid.uuid4().hex[:5]}",
        "dni_ruc": f"DNI{uuid.uuid4().hex[:6]}",
        "phone": "999999999", "address": "Av. Test 123",
        "plan_id": seeded_plan["id"], "router_id": seeded_router["id"],
        "connection_type": "PPPoE", "pppoe_user": "test_u", "pppoe_password": "test_p",
    }
    r = requests.post(f"{API}/clients", headers=auth_headers, json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    c = r.json()
    yield c
    requests.delete(f"{API}/clients/{c['id']}", headers=auth_headers, timeout=TIMEOUT)


def test_create_client_invoice_and_mikrotik(seeded_client, seeded_plan):
    assert seeded_client["unpaid_invoices_count"] == 1
    assert abs(seeded_client["balance_due"] - seeded_plan["price"]) < 0.01
    assert "mikrotik" in seeded_client and seeded_client["mikrotik"]["ok"] is False


def test_client_get_detail(auth_headers, seeded_client):
    r = requests.get(f"{API}/clients/{seeded_client['id']}", headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert "invoices" in body and "tickets" in body
    assert len(body["invoices"]) >= 1


def test_client_search(auth_headers, seeded_client):
    r = requests.get(f"{API}/clients?search={seeded_client['full_name'][:8]}",
                     headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    assert any(c["id"] == seeded_client["id"] for c in r.json())


def test_client_toggle_status(auth_headers, seeded_client):
    r = requests.post(f"{API}/clients/{seeded_client['id']}/toggle-status",
                      headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "suspended"
    assert "message" in body
    # restore
    r2 = requests.post(f"{API}/clients/{seeded_client['id']}/toggle-status",
                       headers=auth_headers, timeout=TIMEOUT)
    assert r2.status_code == 200 and r2.json()["status"] == "active"


# ------------------------- invoices / payments -------------------------
def test_invoices_list(auth_headers):
    r = requests.get(f"{API}/invoices", headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_payment_flow_and_double_pay(auth_headers, seeded_client):
    # suspend to test reactivation
    requests.post(f"{API}/clients/{seeded_client['id']}/toggle-status",
                  headers=auth_headers, timeout=TIMEOUT)

    detail = requests.get(f"{API}/clients/{seeded_client['id']}",
                          headers=auth_headers, timeout=TIMEOUT).json()
    invoice = detail["invoices"][0]

    pay = requests.post(f"{API}/payments", headers=auth_headers, json={
        "invoice_id": invoice["id"], "amount": invoice["amount"],
        "payment_method": "yape",
    }, timeout=TIMEOUT)
    assert pay.status_code == 200, pay.text
    assert pay.json()["invoice"]["status"] == "paid"

    detail2 = requests.get(f"{API}/clients/{seeded_client['id']}",
                           headers=auth_headers, timeout=TIMEOUT).json()
    assert detail2["status"] == "active"
    assert detail2["balance_due"] == 0

    dup = requests.post(f"{API}/payments", headers=auth_headers, json={
        "invoice_id": invoice["id"], "amount": invoice["amount"], "payment_method": "yape",
    }, timeout=TIMEOUT)
    assert dup.status_code == 400


def test_mass_generate_no_duplicates(auth_headers):
    r1 = requests.post(f"{API}/invoices/mass-generate", headers=auth_headers, timeout=TIMEOUT)
    assert r1.status_code == 200
    r2 = requests.post(f"{API}/invoices/mass-generate", headers=auth_headers, timeout=TIMEOUT)
    assert r2.status_code == 200 and r2.json()["count"] == 0


def test_mark_overdue(auth_headers):
    r = requests.post(f"{API}/invoices/mark-overdue", headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200 and "count" in r.json()


def test_create_invoice_from_client(auth_headers, seeded_client):
    r = requests.post(f"{API}/invoices", headers=auth_headers,
                      json={"client_id": seeded_client["id"]}, timeout=TIMEOUT)
    assert r.status_code == 200
    inv = r.json()
    assert inv["client_name"] == seeded_client["full_name"]
    assert inv["invoice_number"].startswith("REC")


# ------------------------- tickets -------------------------
def test_tickets_crud(auth_headers, seeded_client):
    r = requests.post(f"{API}/tickets", headers=auth_headers, json={
        "client_id": seeded_client["id"], "category": "Falla técnica",
        "subject": "TEST no internet",
    }, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["ticket_number"].startswith("TCK")
    assert t["client_name"] == seeded_client["full_name"]
    tid = t["id"]

    upd = requests.put(f"{API}/tickets/{tid}", headers=auth_headers, json={
        "client_id": seeded_client["id"], "category": "Falla técnica",
        "subject": "TEST no internet", "status": "resolved",
    }, timeout=TIMEOUT)
    assert upd.status_code == 200 and upd.json()["resolved_at"]

    d = requests.delete(f"{API}/tickets/{tid}", headers=auth_headers, timeout=TIMEOUT)
    assert d.status_code == 200


# ------------------------- inventory -------------------------
def test_inventory_autocode(auth_headers):
    r = requests.post(f"{API}/inventory", headers=auth_headers, json={
        "name": "TEST ONU", "category": "Equipos", "stock": 5, "unit_cost": 20,
    }, timeout=TIMEOUT)
    assert r.status_code == 200
    item = r.json()
    assert item["item_code"].startswith("INV")
    d = requests.delete(f"{API}/inventory/{item['id']}", headers=auth_headers, timeout=TIMEOUT)
    assert d.status_code == 200


# ------------------------- hotspot -------------------------
def test_hotspot_batch_no_router(auth_headers):
    r = requests.post(f"{API}/hotspot/generate-batch", headers=auth_headers, json={
        "profile_name": "TEST 1H", "duration_hours": 1, "price": 2, "quantity": 5,
    }, timeout=TIMEOUT)
    assert r.status_code == 200
    body = r.json()
    assert len(body["vouchers"]) == 5
    assert body["mikrotik"]["ok"] is False

    lst = requests.get(f"{API}/hotspot/vouchers", headers=auth_headers, timeout=TIMEOUT).json()
    assert isinstance(lst, list) and len(lst) >= 5

    vid = body["vouchers"][0]["id"]
    ms = requests.post(f"{API}/hotspot/vouchers/{vid}/mark-sold",
                       headers=auth_headers, timeout=TIMEOUT)
    assert ms.status_code == 200

    for v in body["vouchers"]:
        requests.delete(f"{API}/hotspot/vouchers/{v['id']}",
                        headers=auth_headers, timeout=TIMEOUT)


# ------------------------- tasks -------------------------
def test_tasks_autofill_client(auth_headers, seeded_client):
    r = requests.post(f"{API}/tasks", headers=auth_headers, json={
        "title": "TEST Instalación", "task_type": "Instalación",
        "client_id": seeded_client["id"], "technician_name": "Tec 1",
        "scheduled_date": "2026-02-10",
    }, timeout=TIMEOUT)
    assert r.status_code == 200
    t = r.json()
    assert t["client_name"] == seeded_client["full_name"]
    d = requests.delete(f"{API}/tasks/{t['id']}", headers=auth_headers, timeout=TIMEOUT)
    assert d.status_code == 200


# ------------------------- mensajeria -------------------------
def test_messaging_templates(auth_headers):
    r = requests.get(f"{API}/messaging/templates", headers=auth_headers, timeout=TIMEOUT)
    assert r.status_code == 200
    assert len(r.json()) == 4


# ------------------------- settings -------------------------
def test_settings_get_and_update(auth_headers):
    g = requests.get(f"{API}/settings", headers=auth_headers, timeout=TIMEOUT)
    assert g.status_code == 200
    body = g.json()
    assert "mikrotik_cut_list" in body

    new_name = f"TEST ISP {uuid.uuid4().hex[:4]}"
    u = requests.put(f"{API}/settings", headers=auth_headers, json={
        "company_name": new_name, "mikrotik_cut_list": "test_morosos",
    }, timeout=TIMEOUT)
    assert u.status_code == 200
    assert u.json()["company_name"] == new_name
    assert u.json()["mikrotik_cut_list"] == "test_morosos"

    # restore
    requests.put(f"{API}/settings", headers=auth_headers, json={
        "company_name": body.get("company_name", ""),
        "mikrotik_cut_list": body.get("mikrotik_cut_list", "morosos"),
    }, timeout=TIMEOUT)
