from fastapi.testclient import TestClient

from app.main import create_app


# health says ok
def test_health() -> None:
    with TestClient(create_app()) as client:
        resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["version"]
