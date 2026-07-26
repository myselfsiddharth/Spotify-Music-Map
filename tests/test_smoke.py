"""Smoke and unit tests for Sonic Cartography.

Run with: pytest
"""

from __future__ import annotations

import os

import pytest

# Ensure predictable env before importing the Flask app
os.environ.setdefault("FLASK_SECRET_KEY", "test-secret-key-not-for-production")
os.environ.setdefault("SPOTIFY_CLIENT_ID", "test-client-id")
os.environ.setdefault("SPOTIFY_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:5000/api/auth/callback")
os.environ.setdefault("FLASK_ENV", "development")

import app as app_module  # noqa: E402
from app import CREDENTIALS_SESSION_KEY, app, bucket_genre  # noqa: E402


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture
def no_env_credentials(monkeypatch):
    """Simulate a fresh clone with no .env — the first-run setup path."""
    monkeypatch.delenv("SPOTIFY_CLIENT_ID", raising=False)
    monkeypatch.delenv("SPOTIFY_CLIENT_SECRET", raising=False)


class FakeTokenResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"access_token": "fake"}

    def json(self):
        return self._payload


def test_bucket_genre_hip_hop():
    assert bucket_genre(["underground hip hop", "rap"]) == "Hip-Hop"


def test_bucket_genre_empty_is_other():
    assert bucket_genre([]) == "Other"


def test_index_serves_html(client):
    res = client.get("/")
    assert res.status_code == 200
    assert b"Sonic Cartography" in res.data


def test_auth_me_unauthenticated(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401
    assert res.get_json()["authenticated"] is False


def test_logout_clears_session(client):
    with client.session_transaction() as sess:
        sess["token_info"] = {"access_token": "fake"}
    res = client.post("/api/auth/logout")
    assert res.status_code == 200
    assert res.get_json()["ok"] is True


def test_config_status_reports_env_credentials(client):
    res = client.get("/api/config/spotify")
    assert res.status_code == 200
    payload = res.get_json()
    assert payload["configured"] is True
    assert payload["source"] == "env"
    assert payload["redirectUri"].endswith("/api/auth/callback")


def test_config_status_unconfigured_without_env(client, no_env_credentials):
    payload = client.get("/api/config/spotify").get_json()
    assert payload["configured"] is False
    assert payload["source"] is None
    assert payload["envConfigured"] is False


def test_config_status_never_leaks_the_secret(client):
    body = client.get("/api/config/spotify").get_data(as_text=True)
    assert "test-client-secret" not in body


def test_login_redirects_to_setup_without_credentials(client, no_env_credentials):
    res = client.get("/api/auth/login")
    assert res.status_code == 302
    assert "reason=missing_credentials" in res.headers["Location"]


def test_save_credentials_requires_both_fields(client, no_env_credentials):
    res = client.post("/api/config/spotify", json={"client_id": "abc"})
    assert res.status_code == 400
    assert "error" in res.get_json()


def test_save_credentials_rejects_malformed_client_id(client, no_env_credentials):
    res = client.post(
        "/api/config/spotify",
        json={"client_id": "Client ID: abc", "client_secret": "a" * 32},
    )
    assert res.status_code == 400
    assert "Client ID" in res.get_json()["error"]


def test_save_credentials_rejects_keys_spotify_denies(client, no_env_credentials, monkeypatch):
    monkeypatch.setattr(
        app_module.requests,
        "post",
        lambda *a, **kw: FakeTokenResponse(401, {"error": "invalid_client"}),
    )
    res = client.post(
        "/api/config/spotify",
        json={"client_id": "a" * 32, "client_secret": "b" * 32},
    )
    assert res.status_code == 400
    assert "rejected" in res.get_json()["error"]
    with client.session_transaction() as sess:
        assert CREDENTIALS_SESSION_KEY not in sess


def test_save_valid_credentials_unlocks_login(client, no_env_credentials, monkeypatch):
    monkeypatch.setattr(app_module.requests, "post", lambda *a, **kw: FakeTokenResponse())
    res = client.post(
        "/api/config/spotify",
        json={"client_id": "a" * 32, "client_secret": "b" * 32},
    )
    assert res.status_code == 200
    payload = res.get_json()
    assert payload["configured"] is True
    assert payload["source"] == "session"

    # Status now reflects the saved keys, and login proceeds to Spotify
    assert client.get("/api/config/spotify").get_json()["source"] == "session"
    login = client.get("/api/auth/login")
    assert login.status_code == 302
    assert login.headers["Location"].startswith("https://accounts.spotify.com/authorize")


def test_saving_credentials_drops_a_stale_token(client, no_env_credentials, monkeypatch):
    monkeypatch.setattr(app_module.requests, "post", lambda *a, **kw: FakeTokenResponse())
    with client.session_transaction() as sess:
        sess["token_info"] = {"access_token": "issued-by-the-old-app"}
    client.post(
        "/api/config/spotify",
        json={"client_id": "a" * 32, "client_secret": "b" * 32},
    )
    with client.session_transaction() as sess:
        assert "token_info" not in sess


def test_clear_credentials_returns_to_setup(client, no_env_credentials, monkeypatch):
    monkeypatch.setattr(app_module.requests, "post", lambda *a, **kw: FakeTokenResponse())
    client.post(
        "/api/config/spotify",
        json={"client_id": "a" * 32, "client_secret": "b" * 32},
    )
    payload = client.delete("/api/config/spotify").get_json()
    assert payload["configured"] is False
    with client.session_transaction() as sess:
        assert CREDENTIALS_SESSION_KEY not in sess


def test_session_credentials_override_env(client, monkeypatch):
    monkeypatch.setattr(app_module.requests, "post", lambda *a, **kw: FakeTokenResponse())
    client.post(
        "/api/config/spotify",
        json={"client_id": "c" * 32, "client_secret": "d" * 32},
    )
    payload = client.get("/api/config/spotify").get_json()
    assert payload["source"] == "session"
    assert payload["clientId"] == "c" * 32
