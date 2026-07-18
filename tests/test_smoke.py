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

from app import app, bucket_genre  # noqa: E402


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


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
