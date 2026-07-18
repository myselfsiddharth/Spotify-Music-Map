import base64
import csv
import io
import json
import os
import re
import secrets
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import quote, unquote

import requests
import spotipy
from dotenv import load_dotenv
from flask import Flask, jsonify, make_response, redirect, request, send_file, session
from spotipy.exceptions import SpotifyException
from spotipy.oauth2 import SpotifyOAuth

load_dotenv()

# Windows consoles often use cp1252/charmap — don't crash on Unicode playlist names
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg):
    """Print safely on Windows consoles that can't encode all Unicode."""
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        text = str(msg).encode(enc, errors="replace").decode(enc, errors="replace")
        print(text, flush=True)

BASE_DIR = Path(__file__).parent
CACHE_PATH = BASE_DIR / "origins_cache.json"
LIBRARY_CACHE_PATH = BASE_DIR / "library_cache.json"
LIKED_INDEX_PATH = BASE_DIR / "liked_tracks_index.json"
SHARES_DIR = BASE_DIR / "shares"
SHARES_DIR.mkdir(exist_ok=True)

SPOTIFY_SCOPES = (
    "user-top-read playlist-read-private playlist-read-collaborative user-library-read"
)

GENRE_RULES = [
    ("Afrobeats", ["afrobeat", "afropop", "amapiano", "naija", "highlife"]),
    (
        "Latin",
        [
            "latin",
            "reggaeton",
            "salsa",
            "bachata",
            "cumbia",
            "brasil",
            "brazil",
            "mpb",
            "funk carioca",
            "corrido",
            "banda",
        ],
    ),
    ("Reggae", ["reggae", "dancehall", "dub", "ska"]),
    ("Hip-Hop", ["hip hop", "rap", "drill", "trap", "grime"]),
    ("R&B/Soul", ["r&b", "rnb", "soul", "neo soul", "funk", "motown"]),
    (
        "Electronic",
        [
            "electronic",
            "house",
            "techno",
            "edm",
            "dubstep",
            "dnb",
            "drum and bass",
            "trance",
            "garage",
            "ambient",
            "idm",
            "electropop",
        ],
    ),
    ("Jazz", ["jazz", "bossa", "swing", "bebop"]),
    ("Indie", ["indie", "bedroom", "dream pop", "shoegaze", "lo-fi", "art pop"]),
    ("Rock", ["rock", "metal", "punk", "grunge", "emo", "hardcore"]),
    ("Pop", ["pop", "k-pop", "kpop", "j-pop", "singer-songwriter"]),
]

WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(32)),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("FLASK_ENV") == "production",
    SESSION_COOKIE_SAMESITE="Lax",
)


def spotify_oauth() -> SpotifyOAuth:
    return SpotifyOAuth(
        client_id=os.environ.get("SPOTIFY_CLIENT_ID"),
        client_secret=os.environ.get("SPOTIFY_CLIENT_SECRET"),
        redirect_uri=os.environ.get(
            "SPOTIFY_REDIRECT_URI", "http://127.0.0.1:5000/api/auth/callback"
        ),
        scope=SPOTIFY_SCOPES,
        show_dialog=True,
        cache_handler=spotipy.cache_handler.MemoryCacheHandler(),
    )


def bucket_genre(spotify_genres):
    text = " ".join(spotify_genres).lower()
    for bucket, keys in GENRE_RULES:
        if any(k in text for k in keys):
            return bucket
    return spotify_genres[0].title() if spotify_genres else "Other"


def load_origin_cache():
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_origin_cache(cache):
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")


def _wikidata_query_batch(batch, batch_index):
    """Query Wikidata SPARQL for a single batch of artist names."""
    values = " ".join(f'"{n}"@en' for n in batch)
    query = f"""
SELECT ?nameVal ?placeLabel ?countryLabel ?lat ?lon WHERE {{
  VALUES ?nameVal {{ {values} }}
  ?artist rdfs:label ?nameVal .
  ?artist wdt:P31/wdt:P279* ?type .
  FILTER(?type IN (wd:Q5, wd:Q215380, wd:Q2088357))
  {{ ?artist wdt:P19 ?place }} UNION {{ ?artist wdt:P740 ?place }}
  ?place wdt:P625 ?coord .
  OPTIONAL {{ ?place wdt:P17 ?country }}
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lon)
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" }}
}}
"""
    partial = {}
    try:
        r = requests.get(
            WIKIDATA_SPARQL,
            params={"query": query, "format": "json"},
            headers={"User-Agent": "SonicCartography/1.0"},
            timeout=30,
        )
        if r.status_code != 200:
            log(f"[WIKIDATA] Batch {batch_index} status {r.status_code}")
            return partial
        for b in r.json().get("results", {}).get("bindings", []):
            name = b["nameVal"]["value"]
            if name in partial:
                continue
            partial[name] = {
                "city": b.get("placeLabel", {}).get("value"),
                "country": b.get("countryLabel", {}).get("value"),
                "lat": round(float(b["lat"]["value"]), 4),
                "lng": round(float(b["lon"]["value"]), 4),
            }
    except Exception as e:
        log(f"[WIKIDATA] Batch {batch_index} error: {e}")
    return partial


def wikidata_batch_resolve(names):
    """Resolve artist origins in bulk via Wikidata SPARQL.

    Returns dict of name -> {"city", "country", "lat", "lng"}.
    Uses P19 (birthplace) for solo artists and P740 (formation location) for groups.
    Batches run concurrently for speed.
    """
    results = {}
    BATCH = 50
    batches = [(names[i : i + BATCH], i) for i in range(0, len(names), BATCH)]
    if not batches:
        return results

    workers = min(4, len(batches))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_wikidata_query_batch, batch, idx): idx
            for batch, idx in batches
        }
        for future in as_completed(futures):
            partial = future.result()
            for name, origin in partial.items():
                if name not in results:
                    results[name] = origin
    return results


def resolve_origins_bulk(artists, cache):
    """Resolve all artists at once. Cache hit first, then Wikidata batch, results cached."""
    uncached = [a["name"] for a in artists if a["name"] not in cache]
    if uncached:
        log(f"[RESOLVE] {len(uncached)} uncached artists, querying Wikidata...")
        resolved = wikidata_batch_resolve(uncached)
        for name in uncached:
            if name in resolved:
                cache[name] = resolved[name]
            else:
                cache[name] = {"city": None, "country": None, "lat": None, "lng": None}
        save_origin_cache(cache)
        log(f"[RESOLVE] Wikidata resolved {len(resolved)}/{len(uncached)}")
    return cache


def spotify_rate_limited(exc):
    if isinstance(exc, SpotifyException) and exc.http_status == 429:
        return True
    text = str(exc).lower()
    return "rate" in text and "limit" in text


def retry_after_seconds(exc, default=3600):
    """Best-effort parse of Spotify / Spotipy retry delay."""
    headers = getattr(exc, "headers", None) or {}
    raw = headers.get("Retry-After") or headers.get("retry-after")
    if raw is not None:
        try:
            return max(1, int(float(raw)))
        except (TypeError, ValueError):
            pass
    match = re.search(r"Retry will occur after:\s*(\d+)", str(exc), re.I)
    if match:
        return max(1, int(match.group(1)))
    return default


def load_library_cache(user_id=None):
    try:
        store = json.loads(LIBRARY_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(store, dict):
        return None
    if user_id and isinstance(store.get(user_id), dict):
        return store[user_id]
    # Fall back to most recent snapshot when user id is missing under rate limit
    snapshots = [v for v in store.values() if isinstance(v, dict) and v.get("items")]
    if not snapshots:
        return None
    snapshots.sort(key=lambda s: s.get("saved_at") or 0, reverse=True)
    return snapshots[0]


def save_library_cache(user_id, payload):
    if not user_id or not payload:
        return
    try:
        store = json.loads(LIBRARY_CACHE_PATH.read_text(encoding="utf-8"))
        if not isinstance(store, dict):
            store = {}
    except Exception:
        store = {}
    items = payload.get("items") or []
    store[user_id] = {
        "items": items,
        "playlists": payload.get("playlists") or [],
        "playlistArtists": payload.get("playlistArtists") or {},
        "meta": payload.get("meta") or {},
        "saved_at": time.time(),
    }
    LIBRARY_CACHE_PATH.write_text(
        json.dumps(store, ensure_ascii=False, indent=0), encoding="utf-8"
    )
    # Keep liked-track index warm for rate-limit playback
    liked_index = load_liked_index()
    for item in items:
        track = item.get("likedTrack")
        if not (track or {}).get("id"):
            continue
        remember_liked_track(
            liked_index,
            item.get("spotifyId"),
            item.get("name"),
            {
                "id": track["id"],
                "name": track.get("name"),
                "uri": track.get("uri"),
                "external_urls": {"spotify": track.get("url")},
                "preview_url": track.get("preview_url"),
            },
        )
    save_liked_index(liked_index)


def load_liked_index():
    try:
        data = json.loads(LIKED_INDEX_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"by_id": {}, "by_name": {}}
    except Exception:
        return {"by_id": {}, "by_name": {}}


def save_liked_index(index):
    LIKED_INDEX_PATH.write_text(
        json.dumps(index, ensure_ascii=False, indent=0), encoding="utf-8"
    )


def liked_track_payload(track):
    if not track or not track.get("id"):
        return None
    return {
        "id": track["id"],
        "name": track.get("name") or "Unknown track",
        "uri": track.get("uri"),
        "url": (track.get("external_urls") or {}).get("spotify")
        or f"https://open.spotify.com/track/{track['id']}",
        "preview_url": track.get("preview_url"),
    }


def remember_liked_track(index, artist_id, artist_name, track):
    payload = liked_track_payload(track)
    if not payload:
        return
    if artist_id:
        index.setdefault("by_id", {})[artist_id] = payload
    name_key = (artist_name or "").strip().lower()
    if name_key:
        index.setdefault("by_name", {})[name_key] = payload


def lookup_liked_index(artist_id=None, artist_name=None):
    index = load_liked_index()
    if artist_id:
        hit = (index.get("by_id") or {}).get(artist_id)
        if hit:
            return hit
    name_key = (artist_name or "").strip().lower()
    if name_key:
        return (index.get("by_name") or {}).get(name_key)
    return None


def origins_fallback_items(limit=120):
    """Build map points from previously resolved origins when Spotify is unavailable."""
    cache = load_origin_cache()
    liked_index = load_liked_index()
    by_name = liked_index.get("by_name") or {}
    items = []
    for name, origin in cache.items():
        if not origin or origin.get("lat") is None or origin.get("lng") is None:
            continue
        liked = by_name.get((name or "").strip().lower())
        items.append(
            {
                "name": name,
                "spotifyId": None,
                "city": origin.get("city") or origin.get("country") or "—",
                "country": origin.get("country") or "—",
                "lat": origin["lat"],
                "lng": origin["lng"],
                "genre": "Other",
                "plays": 25,
                "playlists": ["Liked Songs"],
                "likedTrack": liked,
            }
        )
        if len(items) >= limit:
            break
    return items


def cached_sync_response(user_id, retry_after=None, reason="rate_limited"):
    cached = load_library_cache(user_id)
    if cached and cached.get("items"):
        meta = dict(cached.get("meta") or {})
        meta.update(
            {
                "from_cache": True,
                "rate_limited": reason == "rate_limited",
                "cache_reason": reason,
                "resolved": len(cached.get("items") or []),
                "retry_after_seconds": retry_after,
            }
        )
        return {
            "items": cached.get("items") or [],
            "playlists": cached.get("playlists") or [],
            "playlistArtists": cached.get("playlistArtists") or {},
            "meta": meta,
        }

    # Rescue path: previously geocoded artists on disk
    items = origins_fallback_items()
    if not items:
        return None
    return {
        "items": items,
        "playlists": [
            {
                "name": "Liked Songs",
                "id": "liked-songs",
                "trackCount": None,
                "access": "library",
                "tracksBlocked": False,
                "artistCount": len(items),
                "artistTotal": len(items),
            }
        ],
        "playlistArtists": {"Liked Songs": []},
        "meta": {
            "from_cache": True,
            "rate_limited": reason == "rate_limited",
            "cache_reason": "origins_fallback",
            "resolved": len(items),
            "retry_after_seconds": retry_after,
            "playlist_tracks_blocked": False,
        },
    }


def cache_spotify_user(me):
    if not me:
        return
    session["spotify_user"] = {
        "id": me.get("id"),
        "display_name": me.get("display_name") or me.get("id"),
    }


def probe_spotify_library(sp):
    """Check whether Spotify will serve library data. Returns (ok, retry_after|None)."""
    try:
        sp.current_user_top_artists(limit=1, time_range="medium_term")
        return True, None
    except Exception as exc:
        if spotify_rate_limited(exc):
            wait = retry_after_seconds(exc)
            log(f"[SYNC] Spotify rate limited (probe). retry_after={wait}s")
            return False, wait
        log(f"[SYNC] probe failed: {exc}")
        # Still try other endpoints — not necessarily fatal
        return True, None


def get_spotify_client():
    token_info = session.get("token_info")
    if not token_info:
        return None
    oauth = spotify_oauth()
    if oauth.is_token_expired(token_info):
        refresh_token = token_info.get("refresh_token")
        if not refresh_token:
            return None
        try:
            token_info = oauth.refresh_access_token(refresh_token)
        except Exception:
            return None
    session["token_info"] = token_info
    return spotipy.Spotify(auth=token_info["access_token"], requests_timeout=12, retries=0)


def fetch_spotify_me(sp):
    """Return profile dict or None; never raises on rate limit."""
    try:
        me = sp.me() or {}
        cache_spotify_user(me)
        return me
    except Exception as exc:
        if spotify_rate_limited(exc):
            log("[AUTH] Spotify rate limited on /me — using session cache")
        else:
            log(f"[AUTH] /me failed: {exc}")
        return None


def spotify_market(sp):
    me = fetch_spotify_me(sp)
    if me:
        return me.get("country") or "US"
    return "US"


def _track_from_playlist_item(item):
    if not item:
        return {}
    track = item.get("track") or item.get("item")
    return track if isinstance(track, dict) else {}


def playlist_access(pl, user_id):
    """owned | collaborative | followed (Spotify dev mode limits track reads)."""
    if not pl:
        return "followed"
    owner_id = (pl.get("owner") or {}).get("id")
    if user_id and owner_id == user_id:
        return "owned"
    if pl.get("collaborative"):
        return "collaborative"
    return "followed"


def _playlist_track_total(pl):
    meta = pl.get("items") or pl.get("tracks") or {}
    return meta.get("total")


def _artist_ids_from_playlist_pages(pages):
    ids = set()
    for page in pages:
        for item in (page.get("items") if isinstance(page, dict) else page) or []:
            track = _track_from_playlist_item(item)
            if not track or track.get("is_local"):
                continue
            for artist in track.get("artists") or []:
                if artist and artist.get("id"):
                    ids.add(artist["id"])
    return ids


def _embedded_playlist_item_pages(pl):
    container = pl.get("items") or pl.get("tracks")
    if not container:
        return []
    items = container.get("items")
    if not items:
        return []
    return [{"items": items}]


def _spotify_bearer_token(sp):
    auth = getattr(sp, "_auth", None)
    if isinstance(auth, str) and auth:
        return auth
    return (session.get("token_info") or {}).get("access_token")


def _exportify_tracks_base_url(playlist_id=None, tracks_href=None, liked=False):
    """Same bases Exportify uses: /me/tracks or playlist.tracks.href."""
    if liked:
        return "https://api.spotify.com/v1/me/tracks"
    if tracks_href:
        return str(tracks_href).split("?", 1)[0]
    if not playlist_id:
        raise ValueError("playlist_id or tracks_href required")
    return f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks"


def _exportify_fetch_page(sp, base_url, offset, limit):
    """Exportify-style page fetch: Bearer GET with offset/limit only (no fields/market).

    See https://github.com/pavelkomarov/exportify/blob/master/exportify.js
    """
    token = _spotify_bearer_token(sp)
    if not token:
        raise RuntimeError("No Spotify access token")
    url = f"{base_url}?offset={offset}&limit={limit}"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    if resp.status_code == 429:
        raise SpotifyException(
            429,
            -1,
            resp.text,
            headers=dict(resp.headers),
            reason=resp.reason,
        )
    if not resp.ok:
        raise SpotifyException(
            resp.status_code,
            -1,
            resp.text,
            headers=dict(resp.headers),
            reason=resp.reason,
        )
    data = resp.json()
    return data if isinstance(data, dict) else {}


def _page_track_count(page):
    count = 0
    for item in (page or {}).get("items") or []:
        track = _track_from_playlist_item(item)
        if track.get("id") and not track.get("is_local"):
            count += 1
    return count


def _fetch_playlist_track_page(sp, playlist_id, offset, market=None, tracks_href=None):
    """Fetch one playlist page the way Exportify does, then fall back if needed.

    Important: do not treat an empty `items` array from a fields-filtered call as
    success — that was skipping real tracks. Prefer unfiltered /tracks paging.
    """
    base = _exportify_tracks_base_url(playlist_id, tracks_href=tracks_href)
    attempts = [
        lambda: _exportify_fetch_page(sp, base, offset, 100),
        lambda: sp.playlist_tracks(playlist_id, limit=100, offset=offset),
        lambda: sp.playlist_items(
            playlist_id, additional_types=["track"], limit=100, offset=offset
        ),
    ]
    if market:
        attempts.append(
            lambda: sp.playlist_tracks(
                playlist_id, limit=100, offset=offset, market=market
            )
        )
    last_err = None
    empty_page = None
    for fn in attempts:
        try:
            page = fn()
            if not isinstance(page, dict):
                continue
            if _page_track_count(page) > 0:
                return page
            # Truly empty playlist (total 0) — accept
            if (page.get("total") or 0) == 0 and offset == 0:
                return page
            empty_page = page
        except Exception as e:
            last_err = e
            continue
    if empty_page is not None:
        return empty_page
    raise last_err or RuntimeError("playlist track fetch failed")


def iter_playlist_tracks(sp, playlist_id, market=None, tracks_href=None):
    """Page through playlist tracks (Exportify-compatible)."""
    offset = 0
    while True:
        page = _fetch_playlist_track_page(
            sp, playlist_id, offset, market=market, tracks_href=tracks_href
        )
        yield page
        if not page.get("next"):
            break
        offset += len(page.get("items") or [])
        time.sleep(0.1)  # Exportify staggers requests ~100ms


def index_playlist_artists(sp, playlist_entries, market=None, user_id=None):
    """Map playlist name -> {ids, tracksBlocked, blockReason, access}.

    Only indexes owned / collaborative playlists (followed lists are hidden from the UI).
    """
    market = market or spotify_market(sp)
    user_id = user_id or (sp.me() or {}).get("id")
    index = {}
    errors = 0
    for pl in playlist_entries or []:
        pname = (pl.get("name") or "").strip()
        pid = pl.get("id")
        if not pname or not pid:
            continue
        access = playlist_access(pl, user_id)
        if access == "followed":
            continue
        entry = {
            "ids": [],
            "tracksBlocked": False,
            "blockReason": None,
            "access": access,
        }
        ids = _artist_ids_from_playlist_pages(_embedded_playlist_item_pages(pl))
        if ids:
            entry["ids"] = sorted(ids)
            index[pname] = entry
            continue
        try:
            tracks_href = (pl.get("tracks") or {}).get("href")
            pages = list(
                iter_playlist_tracks(sp, pid, market=market, tracks_href=tracks_href)
            )
            ids = _artist_ids_from_playlist_pages(pages)
            entry["ids"] = sorted(ids)
            if not ids:
                entry["tracksBlocked"] = True
                entry["blockReason"] = "empty"
        except Exception as e:
            errors += 1
            entry["tracksBlocked"] = True
            entry["blockReason"] = "api_restricted"
            log(f"[PLAYLISTS] track fetch failed for {pname!r} ({access}): {e}")
        index[pname] = entry
    restricted = sum(
        1 for e in index.values() if e.get("blockReason") == "api_restricted"
    )
    mapped = sum(1 for e in index.values() if e.get("ids"))
    log(
        f"[PLAYLISTS] index: {mapped} with artists, "
        f"{restricted} API restricted (followed playlists skipped)"
    )
    return index, errors


def fetch_spotify_playlist_entries(sp):
    """Return raw playlist objects from Spotify (no Liked Songs pseudo-entry)."""
    entries = []
    try:
        results = sp.current_user_playlists(limit=50)
        while results:
            for pl in results.get("items") or []:
                if pl and pl.get("id"):
                    entries.append(pl)
            results = sp.next(results) if results.get("next") else None
    except Exception as e:
        log(f"[PLAYLISTS] current_user_playlists error: {e}")
    log(f"[PLAYLISTS] Spotify returned {len(entries)} playlists")
    return entries


def playlist_entries_to_rows(entries, user_id=None, include_followed=False):
    rows = []
    seen = set()
    for pl in entries or []:
        name = (pl.get("name") or "").strip()
        if not name or name in seen:
            continue
        access = playlist_access(pl, user_id)
        if access == "followed" and not include_followed:
            continue
        seen.add(name)
        rows.append(
            {
                "name": name,
                "id": pl.get("id"),
                "trackCount": _playlist_track_total(pl),
                "url": (pl.get("external_urls") or {}).get("spotify"),
                "access": access,
                "ownerName": (pl.get("owner") or {}).get("display_name"),
            }
        )
    return rows


def collect_artists(
    sp,
    max_artists=150,
    include_top_artists=True,
    playlist_entries=None,
    user_id=None,
    include_playlist_tracks=True,
):
    artists = {}
    user_id = user_id or ((fetch_spotify_me(sp) or {}).get("id"))
    stats = {
        "liked_ok": False,
        "top_ok": False,
        "rate_limited": False,
        "retry_after_seconds": None,
    }

    def bump(a_id, name, playlist=None, track=None, genres=None):
        entry = artists.setdefault(
            a_id,
            {
                "id": a_id,
                "name": name,
                "track_count": 0,
                "playlists": set(),
                "genres": [],
                "liked_track": None,
            },
        )
        entry["track_count"] += 1
        if playlist:
            entry["playlists"].add(playlist)
        if genres:
            entry["genres"] = genres
        if playlist == "Liked Songs" and track and track.get("id"):
            entry["liked_track"] = {
                "id": track["id"],
                "name": track.get("name") or "Unknown track",
                "uri": track.get("uri"),
                "url": (track.get("external_urls") or {}).get("spotify"),
                "preview_url": track.get("preview_url"),
            }

    def mark_rate_limited(exc):
        stats["rate_limited"] = True
        stats["retry_after_seconds"] = retry_after_seconds(exc)
        log(f"[SYNC] rate limited while collecting artists: {exc}")

    # Top artists first — few calls, genres included, reliable under Dev Mode
    if include_top_artists:
        for rng in ("medium_term", "long_term", "short_term"):
            if stats["rate_limited"]:
                break
            try:
                top = sp.current_user_top_artists(limit=50, time_range=rng)
                for artist in top.get("items") or []:
                    if artist.get("id"):
                        bump(
                            artist["id"],
                            artist["name"],
                            genres=artist.get("genres") or [],
                        )
                stats["top_ok"] = True
            except Exception as e:
                if spotify_rate_limited(e):
                    mark_rate_limited(e)
                    break
                continue

    # Liked / saved tracks — also persist a local index for offline/rate-limit playback
    if not stats["rate_limited"]:
        liked_index = load_liked_index()
        try:
            results = sp.current_user_saved_tracks(limit=50)
            while results:
                for item in results.get("items") or []:
                    track = (item or {}).get("track") or {}
                    for artist in track.get("artists", []):
                        if artist.get("id"):
                            bump(
                                artist["id"],
                                artist["name"],
                                "Liked Songs",
                                track=track,
                            )
                            remember_liked_track(
                                liked_index,
                                artist.get("id"),
                                artist.get("name"),
                                track,
                            )
                results = sp.next(results) if results.get("next") else None
            stats["liked_ok"] = True
            save_liked_index(liked_index)
            log(
                f"[SYNC] liked index saved "
                f"({len(liked_index.get('by_name') or {})} artists)"
            )
        except Exception as e:
            if spotify_rate_limited(e):
                mark_rate_limited(e)
            else:
                log(f"[SYNC] liked songs collect error: {e}")

    # All library playlists (owned + Spotify/followed), Exportify-style track paging
    if include_playlist_tracks and not stats["rate_limited"]:
        if playlist_entries is None:
            playlist_entries = fetch_spotify_playlist_entries(sp)
        market = spotify_market(sp)
        for pl in playlist_entries or []:
            if stats["rate_limited"]:
                break
            if not pl:
                continue
            pname = (pl.get("name") or "").strip()
            pid = pl.get("id")
            if not pname or not pid:
                continue
            try:
                pages = _embedded_playlist_item_pages(pl)
                if not pages:
                    tracks_href = (pl.get("tracks") or {}).get("href")
                    pages = list(
                        iter_playlist_tracks(
                            sp, pid, market=market, tracks_href=tracks_href
                        )
                    )
                for page in pages:
                    for item in page.get("items") or []:
                        track = _track_from_playlist_item(item)
                        if not track or track.get("is_local"):
                            continue
                        for artist in track.get("artists") or []:
                            if artist.get("id"):
                                bump(artist["id"], artist["name"], pname)
            except Exception as e:
                if spotify_rate_limited(e):
                    mark_rate_limited(e)
                    break
                log(f"[PLAYLISTS] skipping {pname!r} during artist collect: {e}")
                continue

    ranked = sorted(artists.values(), key=lambda e: e["track_count"], reverse=True)
    log(
        f"[SYNC] collected {len(ranked)} artists "
        f"(top_ok={stats['top_ok']}, liked_ok={stats['liked_ok']}, "
        f"rate_limited={stats['rate_limited']})"
    )
    return ranked[:max_artists], stats


def collect_playlists(sp, playlist_entries=None, user_id=None, count_liked=True):
    """Return Liked Songs + owned/collaborative playlists (followed lists excluded)."""
    liked = {
        "name": "Liked Songs",
        "id": "liked-songs",
        "trackCount": None,
        "url": "https://open.spotify.com/collection/tracks",
        "access": "library",
        "tracksBlocked": False,
    }
    if count_liked:
        try:
            # One page is enough for a count estimate when rate-limited; full count when allowed.
            results = sp.current_user_saved_tracks(limit=1)
            liked["trackCount"] = (results or {}).get("total")
            if liked["trackCount"] is None:
                liked_count = len((results or {}).get("items") or [])
                liked["trackCount"] = liked_count
        except Exception as e:
            log(f"[PLAYLISTS] liked songs count error: {e}")

    if playlist_entries is None:
        playlist_entries = fetch_spotify_playlist_entries(sp)
    user_id = user_id or ((fetch_spotify_me(sp) or {}).get("id"))
    playlists = [liked, *playlist_entries_to_rows(playlist_entries, user_id=user_id)]
    playlists.sort(key=lambda p: (p["name"] != "Liked Songs", p["name"].lower()))
    log(f"[PLAYLISTS] returning {len(playlists)} playlists for UI (owned/collaborative only)")
    return playlists


@app.get("/")
def index():
    return send_file(BASE_DIR / "sonic-cartography.html")


@app.get("/api/auth/login")
def auth_login():
    oauth = spotify_oauth()
    state = secrets.token_urlsafe(24)
    resp = make_response(redirect(oauth.get_authorize_url(state=state)))
    resp.set_cookie(
        "oauth_state", state, max_age=600, httponly=True, samesite="Lax",
    )
    return resp


@app.get("/api/auth/callback")
def auth_callback():
    error = request.args.get("error")
    if error:
        return redirect(f"/?auth=failed&reason={error}")
    code = request.args.get("code")
    state = request.args.get("state")
    saved_state = request.cookies.get("oauth_state")
    if not code or not state or saved_state != state:
        return redirect("/?auth=failed&reason=invalid_state")
    oauth = spotify_oauth()
    try:
        token_info = oauth.get_access_token(code)
    except Exception:
        return redirect("/?auth=failed&reason=token_error")
    session["token_info"] = token_info
    try:
        sp = spotipy.Spotify(
            auth=token_info["access_token"], requests_timeout=12, retries=0
        )
        me = sp.me()
        cache_spotify_user(me)
    except Exception as exc:
        log(f"[AUTH] callback profile fetch: {exc}")
    resp = make_response(redirect("/?auth=success"))
    resp.delete_cookie("oauth_state")
    return resp


@app.get("/api/auth/me")
def auth_me():
    if not session.get("token_info"):
        return jsonify({"authenticated": False}), 401
    sp = get_spotify_client()
    if not sp:
        return jsonify({"authenticated": False}), 401

    cached = session.get("spotify_user") or {}
    me = fetch_spotify_me(sp)
    if me:
        return jsonify(
            {
                "authenticated": True,
                "id": me.get("id"),
                "display_name": me.get("display_name") or me.get("id"),
                "rate_limited": False,
            }
        )

    if cached.get("id") or cached.get("display_name"):
        return jsonify(
            {
                "authenticated": True,
                "id": cached.get("id"),
                "display_name": cached.get("display_name"),
                "rate_limited": True,
            }
        )

    return jsonify(
        {
            "authenticated": True,
            "id": None,
            "display_name": "Spotify user",
            "rate_limited": True,
        }
    )


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.post("/api/library/sync")
def library_sync():
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "Not authenticated"}), 401

    me = fetch_spotify_me(sp) or session.get("spotify_user") or {}
    user_id = me.get("id")

    try:
        max_artists = min(int(request.args.get("max_artists", "120")), 300)
        ok, retry_after = probe_spotify_library(sp)
        if not ok:
            cached = cached_sync_response(
                user_id, retry_after=retry_after, reason="rate_limited"
            )
            if cached:
                log(
                    f"[SYNC] serving cached library ({len(cached['items'])} artists) "
                    f"due to rate limit"
                )
                return jsonify(cached)
            return jsonify(
                {
                    "error": (
                        f"Spotify rate limit reached. Try again in "
                        f"about {max(1, (retry_after or 3600) // 60)} minutes."
                    ),
                    "rate_limited": True,
                    "retry_after_seconds": retry_after,
                }
            ), 429

        playlist_entries = fetch_spotify_playlist_entries(sp)
        # Avoid paging all liked tracks just to count — saves quota
        playlists = collect_playlists(
            sp,
            playlist_entries=playlist_entries,
            user_id=user_id,
            count_liked=True,
        )

        # Collect artists (top + liked + owned playlist tracks via Exportify-style paging)
        artists, collect_stats = collect_artists(
            sp,
            max_artists=max_artists,
            include_top_artists=True,
            playlist_entries=playlist_entries,
            user_id=user_id,
            include_playlist_tracks=True,
        )

        if collect_stats.get("rate_limited") and not artists:
            cached = cached_sync_response(
                user_id,
                retry_after=collect_stats.get("retry_after_seconds"),
                reason="rate_limited",
            )
            if cached:
                return jsonify(cached)
            return jsonify(
                {
                    "error": "Spotify rate limit reached while reading your library.",
                    "rate_limited": True,
                    "retry_after_seconds": collect_stats.get("retry_after_seconds"),
                }
            ), 429

        # Lightweight playlist ↔ artist index from owned playlists only when we still
        # have quota and already collected a library.
        playlist_index, playlist_track_errors = {}, 0
        if not collect_stats.get("rate_limited"):
            playlist_index, playlist_track_errors = index_playlist_artists(
                sp, playlist_entries, user_id=user_id
            )
        playlist_artists = {
            name: entry["ids"] for name, entry in playlist_index.items()
        }

        cache = load_origin_cache()
        cache = resolve_origins_bulk(artists, cache)

        rows = []
        unresolved = 0
        for artist in artists:
            origin = cache.get(artist["name"], {})
            if not origin.get("lat"):
                unresolved += 1
                continue
            artist_playlists = set(artist.get("playlists") or [])
            for pname, ids in playlist_artists.items():
                if artist["id"] in ids:
                    artist_playlists.add(pname)
            rows.append(
                {
                    "name": artist["name"],
                    "spotifyId": artist["id"],
                    "city": origin["city"] or origin["country"] or "—",
                    "country": origin["country"] or "—",
                    "lat": origin["lat"],
                    "lng": origin["lng"],
                    "genre": bucket_genre(artist["genres"]),
                    "plays": artist["track_count"] * 25,
                    "playlists": sorted(artist_playlists),
                    "likedTrack": artist.get("liked_track"),
                }
            )

        playlist_artist_counts = {}
        mapped_ids = {row["spotifyId"] for row in rows if row.get("spotifyId")}
        for pname, ids in playlist_artists.items():
            on_map = len([aid for aid in ids if aid in mapped_ids])
            playlist_artist_counts[pname] = {
                "total": len(ids),
                "onMap": on_map,
            }
        liked_total = len(
            [a for a in artists if "Liked Songs" in (a.get("playlists") or set())]
        )
        liked_on_map = len(
            [r for r in rows if "Liked Songs" in (r.get("playlists") or [])]
        )
        playlist_artist_counts["Liked Songs"] = {
            "total": liked_total,
            "onMap": liked_on_map,
        }
        playlist_artists["Liked Songs"] = sorted(
            a["id"]
            for a in artists
            if "Liked Songs" in (a.get("playlists") or set())
        )
        for pl in playlists:
            stats = playlist_artist_counts.get(pl["name"], {"total": 0, "onMap": 0})
            pl["artistCount"] = stats["onMap"]
            pl["artistTotal"] = stats["total"]
            idx = playlist_index.get(pl["name"], {})
            if pl["name"] == "Liked Songs":
                pl["tracksBlocked"] = False
                pl["access"] = "library"
            else:
                access = idx.get("access") or pl.get("access") or playlist_access(
                    next(
                        (
                            p
                            for p in (playlist_entries or [])
                            if (p.get("name") or "").strip() == pl["name"]
                        ),
                        None,
                    ),
                    user_id,
                )
                pl["access"] = access
                pl["tracksBlocked"] = idx.get("tracksBlocked", False)
                pl["blockReason"] = idx.get("blockReason")

        followed_blocked = sum(
            1 for p in playlists if p.get("blockReason") == "followed"
        )
        payload = {
            "items": rows,
            "playlists": playlists,
            "playlistArtists": playlist_artists,
            "meta": {
                "resolved": len(rows),
                "unresolved": unresolved,
                "input_artists": len(artists),
                "playlist_count": len(playlists),
                "playlist_track_errors": playlist_track_errors,
                "playlist_tracks_blocked": followed_blocked > 0,
                "followed_playlist_count": followed_blocked,
                "rate_limited": bool(collect_stats.get("rate_limited")),
                "from_cache": False,
                "liked_ok": collect_stats.get("liked_ok"),
                "top_ok": collect_stats.get("top_ok"),
                "retry_after_seconds": collect_stats.get("retry_after_seconds"),
            },
        }

        if rows:
            save_library_cache(user_id, payload)
        elif not rows:
            # Fresh sync found nothing usable — fall back to last good map
            cached = cached_sync_response(
                user_id,
                retry_after=collect_stats.get("retry_after_seconds"),
                reason="empty_or_rate_limited"
                if collect_stats.get("rate_limited")
                else "empty_library",
            )
            if cached:
                log("[SYNC] 0 resolved artists — serving previous library cache")
                return jsonify(cached)

        return jsonify(payload)
    except Exception as e:
        if spotify_rate_limited(e):
            wait = retry_after_seconds(e)
            cached = cached_sync_response(user_id, retry_after=wait, reason="rate_limited")
            if cached:
                return jsonify(cached)
        return jsonify(
            {
                    "error": (
                        f"Spotify rate limit reached. Try again in "
                        f"about {max(1, wait // 60)} minutes."
                    ),
                    "rate_limited": True,
                    "retry_after_seconds": wait,
                }
            ), 429
        return jsonify({"error": str(e)}), 500


@app.get("/api/library/playlists")
def library_playlists():
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "Not authenticated"}), 401
    me = fetch_spotify_me(sp) or session.get("spotify_user") or {}
    user_id = me.get("id")
    try:
        ok, retry_after = probe_spotify_library(sp)
        if not ok:
            cached = load_library_cache(user_id) or cached_sync_response(
                user_id, retry_after=retry_after
            )
            if cached:
                cached_playlists = [
                    p
                    for p in (cached.get("playlists") or [])
                    if (p or {}).get("access") != "followed"
                    and (p or {}).get("blockReason") != "followed"
                ]
                return jsonify(
                    {
                        "playlists": cached_playlists,
                        "meta": {
                            "playlist_count": len(cached_playlists),
                            "from_cache": True,
                            "rate_limited": True,
                            "retry_after_seconds": retry_after,
                        },
                    }
                )
            return jsonify(
                {
                    "error": "Spotify rate limit reached. Wait and try again.",
                    "rate_limited": True,
                    "retry_after_seconds": retry_after,
                }
            ), 429

        entries = fetch_spotify_playlist_entries(sp)
        playlists = collect_playlists(
            sp, playlist_entries=entries, user_id=user_id, count_liked=False
        )
        # Metadata only — do not crawl playlist tracks here (burns rate limit)
        for pl in playlists:
            if pl["name"] == "Liked Songs":
                pl["tracksBlocked"] = False
                pl["access"] = "library"
        return jsonify(
            {
                "playlists": playlists,
                "meta": {
                    "playlist_count": len(playlists),
                    "playlist_track_errors": 0,
                },
            }
        )
    except Exception as e:
        if spotify_rate_limited(e):
            wait = retry_after_seconds(e)
            cached = load_library_cache(user_id)
            if cached:
                return jsonify(
                    {
                        "playlists": cached.get("playlists") or [],
                        "meta": {
                            "from_cache": True,
                            "rate_limited": True,
                            "retry_after_seconds": wait,
                        },
                    }
                )
            return jsonify(
                {
                    "error": "Spotify rate limit reached. Wait and try again.",
                    "rate_limited": True,
                    "retry_after_seconds": wait,
                }
            ), 429
        return jsonify({"error": str(e)}), 500


@app.get("/api/auth/diagnostics")
def auth_diagnostics():
    """Probe which Spotify endpoints work for the current token (dev-mode troubleshooting)."""
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "Not authenticated"}), 401

    def probe(label, fn):
        try:
            fn()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    me = sp.me() or {}
    user_id = me.get("id")
    entries = fetch_spotify_playlist_entries(sp)
    owned = []
    followed = []
    for pl in entries:
        row = {
            "name": pl.get("name"),
            "id": pl.get("id"),
            "access": playlist_access(pl, user_id),
            "trackCount": _playlist_track_total(pl),
            "owner": (pl.get("owner") or {}).get("display_name"),
        }
        if row["access"] == "followed":
            followed.append(row)
        else:
            owned.append(row)

    sample_owned = owned[0] if owned else None
    sample_artist_id = None
    try:
        saved = sp.current_user_saved_tracks(limit=1)
        for item in saved.get("items") or []:
            track = (item or {}).get("track") or {}
            for artist in track.get("artists") or []:
                if artist.get("id"):
                    sample_artist_id = artist["id"]
                    break
    except Exception:
        pass

    tests = {
        "saved_tracks": probe("saved_tracks", lambda: sp.current_user_saved_tracks(limit=1)),
        "top_artists": probe(
            "top_artists", lambda: sp.current_user_top_artists(limit=1)
        ),
        "user_playlists": probe(
            "user_playlists", lambda: sp.current_user_playlists(limit=1)
        ),
        "batch_artists_removed": probe(
            "batch_artists",
            lambda: sp.artists([sample_artist_id]) if sample_artist_id else None,
        ),
        "single_artist": probe(
            "single_artist",
            lambda: sp.artist(sample_artist_id) if sample_artist_id else None,
        ),
    }
    if sample_owned:
        pid = sample_owned["id"]
        tests["owned_playlist_items"] = probe(
            f"playlist_items:{sample_owned['name']}",
            lambda: sp.playlist_items(pid, additional_types=["track"], limit=1),
        )

    return jsonify(
        {
            "user": {"id": user_id, "display_name": me.get("display_name")},
            "playlist_summary": {
                "total": len(entries),
                "owned_or_collaborative": len(owned),
                "followed_only": len(followed),
            },
            "owned_playlists": owned,
            "followed_playlists": followed,
            "endpoint_tests": tests,
            "hints": [
                "User Management allowlist controls who can log in — not which endpoints return data.",
                "Feb 2026 Dev Mode: GET /artists?ids=… is removed; genres come from top-artists or GET /artists/{id}.",
                "Playlist tracks are only readable for playlists you own or collaborate on.",
                "App owner needs Spotify Premium. Re-connect after allowlist changes.",
            ],
        }
    )


def playlist_name_from_filename(filename):
    base = Path(filename or "Imported Playlist").stem
    base = unquote(base).strip() or "Imported Playlist"
    # Exportify often uses playlist name; drop trailing underscores from zip dupes
    return re.sub(r"_+$", "", base).strip() or "Imported Playlist"


def parse_exportify_csv(text, playlist_name):
    """Parse an Exportify CSV into artists + playlist artist ids.

    Expected headers (Exportify):
    Track URI, Track Name, Album Name, Artist Name(s), Release Date, Duration (ms),
    Popularity, Explicit, Added By, Added At, Genres, Record Label,
    Danceability, Energy, Key, Loudness, Mode, Speechiness, Acousticness,
    Instrumentalness, Liveness, Valence, Tempo, Time Signature
    See https://github.com/pavelkomarov/exportify
    """
    if text.startswith("\ufeff"):
        text = text[1:]
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")

    field_map = {(h or "").strip(): h for h in reader.fieldnames}

    def col(*names):
        for n in names:
            if n in field_map:
                return field_map[n]
        lower = {k.lower(): v for k, v in field_map.items()}
        for n in names:
            if n.lower() in lower:
                return lower[n.lower()]
        return None

    def num(row, key):
        if not key:
            return None
        raw = (row.get(key) or "").strip()
        if raw == "":
            return None
        try:
            return float(raw)
        except ValueError:
            return None

    def truthy(row, key):
        if not key:
            return False
        raw = (row.get(key) or "").strip().lower()
        return raw in ("true", "1", "yes", "y")

    track_uri_col = col("Track URI", "URI", "Spotify URI")
    track_name_col = col("Track Name", "Track")
    album_col = col("Album Name", "Album")
    artists_col = col("Artist Name(s)", "Artist Names", "Artist(s)", "Artists", "Artist")
    release_col = col("Release Date", "Release")
    duration_col = col("Duration (ms)", "Duration")
    popularity_col = col("Popularity")
    explicit_col = col("Explicit")
    added_by_col = col("Added By")
    added_at_col = col("Added At")
    genres_col = col("Genres", "Genre")
    label_col = col("Record Label", "Label")
    dance_col = col("Danceability")
    energy_col = col("Energy")
    key_col = col("Key")
    loud_col = col("Loudness")
    mode_col = col("Mode")
    speech_col = col("Speechiness")
    acoustic_col = col("Acousticness")
    instru_col = col("Instrumentalness")
    live_col = col("Liveness")
    valence_col = col("Valence")
    tempo_col = col("Tempo")
    time_sig_col = col("Time Signature")

    if not artists_col:
        raise ValueError(
            "Not an Exportify CSV — missing 'Artist Name(s)' column. "
            "Export from https://exportify.net"
        )

    artists = {}
    playlist_artist_ids = set()
    track_count = 0

    audio_keys = (
        ("danceability", dance_col),
        ("energy", energy_col),
        ("loudness", loud_col),
        ("speechiness", speech_col),
        ("acousticness", acoustic_col),
        ("instrumentalness", instru_col),
        ("liveness", live_col),
        ("valence", valence_col),
        ("tempo", tempo_col),
    )

    for row in reader:
        raw_artists = (row.get(artists_col) or "").strip()
        if not raw_artists:
            continue
        track_count += 1
        track_uri = (row.get(track_uri_col) or "").strip() if track_uri_col else ""
        track_name = (row.get(track_name_col) or "").strip() if track_name_col else ""
        album_name = (row.get(album_col) or "").strip() if album_col else ""
        release_date = (row.get(release_col) or "").strip() if release_col else ""
        release_year = None
        if release_date[:4].isdigit():
            release_year = int(release_date[:4])
        duration_ms = num(row, duration_col)
        popularity = num(row, popularity_col)
        explicit = truthy(row, explicit_col)
        added_by = (row.get(added_by_col) or "").strip() if added_by_col else ""
        added_at = (row.get(added_at_col) or "").strip() if added_at_col else ""
        label = (row.get(label_col) or "").strip() if label_col else ""
        genres_raw = (row.get(genres_col) or "").strip() if genres_col else ""
        genres = [g.strip() for g in genres_raw.split(",") if g.strip()]
        key_val = num(row, key_col)
        mode_raw = (row.get(mode_col) or "").strip() if mode_col else ""
        time_sig = num(row, time_sig_col)

        audio = {}
        for name, c in audio_keys:
            v = num(row, c)
            if v is not None:
                audio[name] = v

        track_id = None
        if track_uri.startswith("spotify:track:"):
            track_id = track_uri.split(":")[-1]
        elif "open.spotify.com/track/" in track_uri:
            track_id = track_uri.rstrip("/").split("/")[-1].split("?")[0]

        names = [n.strip() for n in raw_artists.split(";") if n.strip()]
        if not names:
            names = [n.strip() for n in raw_artists.split(",") if n.strip()]

        for name in names:
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "artist"
            a_id = f"csv:{slug}"
            entry = artists.setdefault(
                a_id,
                {
                    "id": a_id,
                    "name": name,
                    "track_count": 0,
                    "playlists": set(),
                    "genres": [],
                    "liked_track": None,
                    "albums": set(),
                    "labels": set(),
                    "release_years": set(),
                    "csv_genres": set(),
                    "added_by": set(),
                    "explicit": False,
                    "duration_sum": 0.0,
                    "duration_n": 0,
                    "popularity_sum": 0.0,
                    "popularity_n": 0,
                    "audio_sums": {},
                    "audio_ns": {},
                    "keys": set(),
                    "modes": set(),
                    "time_signatures": set(),
                    "added_at_min": None,
                    "added_at_max": None,
                    "track_names": set(),
                },
            )
            entry["track_count"] += 1
            entry["playlists"].add(playlist_name)
            if genres:
                entry["csv_genres"].update(genres)
                if not entry["genres"]:
                    entry["genres"] = list(genres)
            if album_name:
                entry["albums"].add(album_name)
            if label:
                entry["labels"].add(label)
            if release_year:
                entry["release_years"].add(release_year)
            if added_by:
                entry["added_by"].add(added_by)
            if track_name:
                entry["track_names"].add(track_name)
            if explicit:
                entry["explicit"] = True
            if duration_ms is not None:
                entry["duration_sum"] += duration_ms
                entry["duration_n"] += 1
            if popularity is not None:
                entry["popularity_sum"] += popularity
                entry["popularity_n"] += 1
            for ak, av in audio.items():
                entry["audio_sums"][ak] = entry["audio_sums"].get(ak, 0.0) + av
                entry["audio_ns"][ak] = entry["audio_ns"].get(ak, 0) + 1
            if key_val is not None:
                entry["keys"].add(int(key_val))
            if mode_raw:
                entry["modes"].add(mode_raw)
            if time_sig is not None:
                entry["time_signatures"].add(int(time_sig))
            if added_at:
                if entry["added_at_min"] is None or added_at < entry["added_at_min"]:
                    entry["added_at_min"] = added_at
                if entry["added_at_max"] is None or added_at > entry["added_at_max"]:
                    entry["added_at_max"] = added_at
            if track_id and not entry["liked_track"]:
                entry["liked_track"] = {
                    "id": track_id,
                    "name": track_name or "Unknown track",
                    "uri": track_uri
                    if track_uri.startswith("spotify:")
                    else f"spotify:track:{track_id}",
                    "url": f"https://open.spotify.com/track/{track_id}",
                    "preview_url": None,
                }
            playlist_artist_ids.add(a_id)

    # Finalize aggregates into JSON-friendly shapes
    finalized = []
    for entry in artists.values():
        n = max(1, entry["track_count"])
        audio_avg = {}
        for ak, total in (entry.get("audio_sums") or {}).items():
            count = (entry.get("audio_ns") or {}).get(ak) or 0
            if count:
                audio_avg[ak] = round(total / count, 4)
        finalized.append(
            {
                "id": entry["id"],
                "name": entry["name"],
                "track_count": entry["track_count"],
                "playlists": entry["playlists"],
                "genres": entry["genres"],
                "liked_track": entry["liked_track"],
                "albums": sorted(entry["albums"]),
                "labels": sorted(entry["labels"]),
                "releaseYears": sorted(entry["release_years"]),
                "csvGenres": sorted(entry["csv_genres"]),
                "addedBy": sorted(entry["added_by"]),
                "explicit": bool(entry["explicit"]),
                "durationMs": int(entry["duration_sum"] / entry["duration_n"])
                if entry["duration_n"]
                else None,
                "trackPopularity": round(entry["popularity_sum"] / entry["popularity_n"], 1)
                if entry["popularity_n"]
                else None,
                "audio": audio_avg,
                "keys": sorted(entry["keys"]),
                "modes": sorted(entry["modes"]),
                "timeSignatures": sorted(entry["time_signatures"]),
                "addedAtMin": entry["added_at_min"],
                "addedAtMax": entry["added_at_max"],
                "trackNames": sorted(entry["track_names"])[:40],
            }
        )

    return {
        "artists": finalized,
        "playlist": {
            "name": playlist_name,
            "id": f"csv-{re.sub(r'[^a-z0-9]+', '-', playlist_name.lower()).strip('-')[:40]}",
            "trackCount": track_count,
            "url": None,
            "access": "import",
            "tracksBlocked": False,
            "blockReason": None,
            "artistTotal": len(playlist_artist_ids),
            "artistCount": 0,
        },
        "playlist_artist_ids": sorted(playlist_artist_ids),
        "track_count": track_count,
    }


def artists_to_map_rows(artists, playlist_artists=None):
    """Resolve origins and build map rows for a list of artist dicts."""
    playlist_artists = playlist_artists or {}
    cache = load_origin_cache()
    cache = resolve_origins_bulk(artists, cache)
    rows = []
    unresolved = 0
    liked_index = load_liked_index()
    for artist in artists:
        origin = cache.get(artist["name"], {})
        if not origin.get("lat"):
            unresolved += 1
            continue
        tags = set(artist.get("playlists") or [])
        for pname, ids in playlist_artists.items():
            if artist["id"] in ids:
                tags.add(pname)
        liked = artist.get("liked_track")
        if liked:
            remember_liked_track(
                liked_index,
                artist.get("id"),
                artist.get("name"),
                {
                    "id": liked["id"],
                    "name": liked.get("name"),
                    "uri": liked.get("uri"),
                    "external_urls": {"spotify": liked.get("url")},
                    "preview_url": liked.get("preview_url"),
                },
            )
        rows.append(
            {
                "name": artist["name"],
                "spotifyId": artist["id"] if not str(artist["id"]).startswith("csv:") else None,
                "city": origin["city"] or origin["country"] or "—",
                "country": origin["country"] or "—",
                "lat": origin["lat"],
                "lng": origin["lng"],
                "genre": bucket_genre(artist.get("genres") or []),
                "plays": artist["track_count"] * 25,
                "playlists": sorted(tags),
                "likedTrack": liked,
                "albums": list(artist.get("albums") or []),
                "labels": list(artist.get("labels") or []),
                "releaseYears": list(artist.get("releaseYears") or []),
                "csvGenres": list(artist.get("csvGenres") or artist.get("genres") or []),
                "addedBy": list(artist.get("addedBy") or []),
                "explicit": bool(artist.get("explicit")),
                "durationMs": artist.get("durationMs"),
                "trackPopularity": artist.get("trackPopularity"),
                "audio": artist.get("audio") or {},
                "keys": list(artist.get("keys") or []),
                "modes": list(artist.get("modes") or []),
                "timeSignatures": list(artist.get("timeSignatures") or []),
                "addedAtMin": artist.get("addedAtMin"),
                "addedAtMax": artist.get("addedAtMax"),
                "trackNames": list(artist.get("trackNames") or []),
                "saved": bool(liked)
                or "Liked Songs" in tags,
            }
        )
    save_liked_index(liked_index)
    return rows, unresolved


def safe_csv_filename(name):
    cleaned = re.sub(r'[<>:"/\\|?*]+', "_", (name or "playlist").strip()) or "playlist"
    # Keep HTTP headers ASCII-safe (Windows/Werkzeug can choke on Unicode filenames)
    cleaned = cleaned.encode("ascii", errors="ignore").decode("ascii").strip(" ._") or "playlist"
    return cleaned[:80]


def fetch_liked_track_objects(sp, max_tracks=2000):
    tracks = []
    results = sp.current_user_saved_tracks(limit=50)
    while results:
        for item in results.get("items") or []:
            track = (item or {}).get("track") or {}
            if track.get("id") and not track.get("is_local"):
                # Preserve playlist-item metadata for Exportify CSV columns
                track = dict(track)
                track["_added_at"] = (item or {}).get("added_at")
                tracks.append(track)
                if len(tracks) >= max_tracks:
                    return tracks
        results = sp.next(results) if results.get("next") else None
    return tracks


def fetch_playlist_track_objects(sp, playlist_id, max_tracks=2000, market=None, tracks_href=None):
    tracks = []
    for page in iter_playlist_tracks(
        sp, playlist_id, market=market, tracks_href=tracks_href
    ):
        for item in page.get("items") or []:
            track = _track_from_playlist_item(item)
            if track.get("id") and not track.get("is_local"):
                track = dict(track)
                track["_added_at"] = (item or {}).get("added_at")
                added_by = (item or {}).get("added_by") or {}
                track["_added_by"] = added_by.get("id") or ""
                tracks.append(track)
                if len(tracks) >= max_tracks:
                    return tracks
    return tracks


def playlist_to_exportify_csv_text(sp, playlist_id, name, tracks_href=None, liked=False):
    """Fetch tracks Exportify-style and return an Exportify-compatible CSV string."""
    if liked or playlist_id in ("liked-songs", "liked", "liked_songs"):
        tracks = fetch_liked_track_objects(sp)
    else:
        tracks = fetch_playlist_track_objects(
            sp, playlist_id, tracks_href=tracks_href
        )
    if not tracks:
        return None, 0
    return tracks_to_exportify_csv(tracks), len(tracks)


def tracks_to_exportify_csv(tracks):
    """Build an Exportify-compatible CSV string from Spotify track objects."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(
        [
            "Track URI",
            "Track Name",
            "Album Name",
            "Artist Name(s)",
            "Release Date",
            "Duration (ms)",
            "Popularity",
            "Explicit",
            "Added By",
            "Added At",
            "Genres",
            "Record Label",
            "Danceability",
            "Energy",
            "Key",
            "Loudness",
            "Mode",
            "Speechiness",
            "Acousticness",
            "Instrumentalness",
            "Liveness",
            "Valence",
            "Tempo",
            "Time Signature",
        ]
    )
    for track in tracks or []:
        artists = track.get("artists") or []
        artist_names = ";".join(
            (a.get("name") or "").replace(";", "") for a in artists if a.get("name")
        )
        album = track.get("album") or {}
        writer.writerow(
            [
                track.get("uri") or "",
                track.get("name") or "",
                album.get("name") or "",
                artist_names,
                album.get("release_date") or "",
                track.get("duration_ms") or "",
                track.get("popularity") if track.get("popularity") is not None else "",
                bool(track.get("explicit")),
                track.get("_added_by") or "",
                track.get("_added_at") or "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ]
        )
    return "\ufeff" + buf.getvalue()


def artists_from_spotify_tracks(tracks, playlist_name, playlist_id=None):
    artists = {}
    playlist_artist_ids = set()
    track_count = 0
    for track in tracks or []:
        if not track or not track.get("id") or track.get("is_local"):
            continue
        track_count += 1
        liked = liked_track_payload(track)
        for artist in track.get("artists") or []:
            a_id = artist.get("id")
            name = (artist.get("name") or "").strip()
            if not a_id or not name:
                continue
            entry = artists.setdefault(
                a_id,
                {
                    "id": a_id,
                    "name": name,
                    "track_count": 0,
                    "playlists": set(),
                    "genres": [],
                    "liked_track": None,
                },
            )
            entry["track_count"] += 1
            entry["playlists"].add(playlist_name)
            if liked and not entry["liked_track"]:
                entry["liked_track"] = liked
            playlist_artist_ids.add(a_id)
    return {
        "artists": list(artists.values()),
        "playlist": {
            "name": playlist_name,
            "id": playlist_id
            or (
                "liked-songs"
                if playlist_name == "Liked Songs"
                else f"pl-{re.sub(r'[^a-z0-9]+', '-', playlist_name.lower()).strip('-')[:40]}"
            ),
            "trackCount": track_count,
            "url": (
                f"https://open.spotify.com/playlist/{playlist_id}"
                if playlist_id and playlist_id != "liked-songs"
                else "https://open.spotify.com/collection/tracks"
                if playlist_name == "Liked Songs"
                else None
            ),
            "access": "library" if playlist_name == "Liked Songs" else "owned",
            "tracksBlocked": False,
            "blockReason": None,
            "artistTotal": len(playlist_artist_ids),
            "artistCount": 0,
        },
        "playlist_artist_ids": sorted(playlist_artist_ids),
        "track_count": track_count,
    }


def merge_artist_bundles(bundles):
    all_artists = {}
    playlists_out = []
    playlist_artists = {}
    total_tracks = 0
    for parsed in bundles:
        total_tracks += parsed["track_count"]
        for artist in parsed["artists"]:
            existing = all_artists.get(artist["id"])
            if not existing:
                all_artists[artist["id"]] = {
                    **artist,
                    "playlists": set(artist.get("playlists") or []),
                }
            else:
                existing["track_count"] += artist["track_count"]
                existing["playlists"] |= set(artist.get("playlists") or [])
                if artist.get("genres") and not existing.get("genres"):
                    existing["genres"] = artist["genres"]
                if artist.get("liked_track") and not existing.get("liked_track"):
                    existing["liked_track"] = artist["liked_track"]
        pl = dict(parsed["playlist"])
        ids = parsed["playlist_artist_ids"]
        if pl["name"] in playlist_artists:
            playlist_artists[pl["name"]] = sorted(
                set(playlist_artists[pl["name"]]) | set(ids)
            )
            for existing_pl in playlists_out:
                if existing_pl["name"] == pl["name"]:
                    existing_pl["trackCount"] = (existing_pl.get("trackCount") or 0) + (
                        pl.get("trackCount") or 0
                    )
                    existing_pl["artistTotal"] = len(playlist_artists[pl["name"]])
                    break
        else:
            playlist_artists[pl["name"]] = ids
            playlists_out.append(pl)
    return all_artists, playlists_out, playlist_artists, total_tracks


def finalize_mapped_import(all_artists, playlists_out, playlist_artists, total_tracks, source):
    if not all_artists:
        return None
    artists = sorted(all_artists.values(), key=lambda a: a["track_count"], reverse=True)
    rows, unresolved = artists_to_map_rows(artists, playlist_artists)
    mapped_names = {r["name"] for r in rows}
    id_to_name = {a["id"]: a["name"] for a in artists}
    for pl in playlists_out:
        ids = playlist_artists.get(pl["name"], [])
        on_map = sum(1 for i in ids if id_to_name.get(i) in mapped_names)
        pl["artistCount"] = on_map
        pl["artistTotal"] = len(ids)
        pl["tracksBlocked"] = False
    playlist_artists_out = {
        name: list(ids) if not isinstance(ids, list) else ids
        for name, ids in (playlist_artists or {}).items()
    }
    user_id = (session.get("spotify_user") or {}).get("id") or "csv-import"
    payload = {
                "items": rows,
        "playlists": playlists_out,
        "playlistArtists": playlist_artists_out,
        "meta": {
            "resolved": len(rows),
            "unresolved": unresolved,
            "input_artists": len(artists),
            "playlist_count": len(playlists_out),
            "track_count": total_tracks,
            "source": source,
            "from_cache": False,
            "rate_limited": False,
            "merge": True,
        },
    }
    existing = load_library_cache(user_id) or {
        "items": [],
        "playlists": [],
        "playlistArtists": {},
    }
    merged_items = _merge_artist_rows(existing.get("items") or [], rows)
    merged_playlists = _merge_playlist_rows(existing.get("playlists") or [], playlists_out)
    merged_pa = dict(existing.get("playlistArtists") or {})
    merged_pa.update(playlist_artists_out)
    save_library_cache(
        user_id,
        {
            "items": merged_items,
            "playlists": merged_playlists,
            "playlistArtists": merged_pa,
            "meta": {**payload["meta"], "resolved": len(merged_items)},
        },
    )
    payload["items"] = merged_items
    payload["playlists"] = merged_playlists
    payload["playlistArtists"] = merged_pa
    payload["meta"]["resolved"] = len(merged_items)
    return payload


@app.get("/api/library/export-csv")
def export_playlist_csv():
    """Download an Exportify-compatible CSV for a playlist or Liked Songs.

    Track paging matches https://github.com/pavelkomarov/exportify (tracks.href + offset/limit).
    """
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "Not authenticated"}), 401

    playlist_id = (request.args.get("playlist_id") or request.args.get("id") or "").strip()
    if not playlist_id:
        return jsonify({"error": "playlist_id required"}), 400

    try:
        tracks_href = None
        if playlist_id in ("liked-songs", "liked", "liked_songs"):
            name = "Liked Songs"
            csv_text, n = playlist_to_exportify_csv_text(sp, playlist_id, name, liked=True)
        else:
            entries = fetch_spotify_playlist_entries(sp)
            match = next((p for p in entries if p.get("id") == playlist_id), None)
            name = (match or {}).get("name") or playlist_id
            tracks_href = ((match or {}).get("tracks") or {}).get("href")
            csv_text, n = playlist_to_exportify_csv_text(
                sp, playlist_id, name, tracks_href=tracks_href
            )

        if not csv_text:
            return jsonify({"error": f"No tracks found for {name}"}), 404

        log(f"[EXPORTIFY] CSV for {name!r}: {n} tracks")
        filename = f"{safe_csv_filename(name)}.csv"
        resp = make_response(csv_text)
        resp.headers["Content-Type"] = "text/csv; charset=utf-8"
        resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp
    except Exception as e:
        if spotify_rate_limited(e):
            return jsonify(
                {
                    "error": "Spotify rate limit reached. Try again later.",
                    "rate_limited": True,
                    "retry_after_seconds": retry_after_seconds(e),
                }
            ), 429
        return jsonify({"error": str(e)}), 500


@app.post("/api/library/pull-playlists")
def pull_playlists_from_spotify():
    """Exportify-style pull: fetch playlist tracks → CSV → resolve artist origins.

    Mirrors https://github.com/pavelkomarov/exportify paging, then runs the same
    CSV → Wikidata/origin pipeline as Import Exportify CSV.
    """
    sp = get_spotify_client()
    if not sp:
        return jsonify({"error": "Not authenticated"}), 401

    me = fetch_spotify_me(sp) or session.get("spotify_user") or {}
    user_id = me.get("id")

    try:
        ok, retry_after = probe_spotify_library(sp)
        if not ok:
            return jsonify(
                {
                    "error": "Spotify rate limit reached. Try again later.",
                    "rate_limited": True,
                    "retry_after_seconds": retry_after,
                }
            ), 429

        entries = fetch_spotify_playlist_entries(sp)

        # Liked Songs + playlists you own or collaborate on (skip followed / Spotify lists)
        targets = [
            {
                "id": "liked-songs",
                "name": "Liked Songs",
                "tracks_href": "https://api.spotify.com/v1/me/tracks",
                "liked": True,
                "access": "library",
            }
        ]
        skipped_followed = 0
        for pl in entries:
            pid = pl.get("id")
            name = (pl.get("name") or "").strip()
            if not pid or not name:
                continue
            access = playlist_access(pl, user_id)
            if access == "followed":
                skipped_followed += 1
                continue
            targets.append(
                {
                    "id": pid,
                    "name": name,
                    "tracks_href": (pl.get("tracks") or {}).get("href"),
                    "liked": False,
                    "access": access,
                }
            )
        if skipped_followed:
            log(f"[EXPORTIFY] skipping {skipped_followed} followed playlist(s)")

        all_artists = {}
        playlists_out = []
        playlist_artists = {}
        total_tracks = 0
        errors = []
        pulled_names = []

        for target in targets:
            name = target["name"]
            try:
                csv_text, n = playlist_to_exportify_csv_text(
                    sp,
                    target["id"],
                    name,
                    tracks_href=target.get("tracks_href"),
                    liked=target.get("liked"),
                )
                if not csv_text:
                    errors.append({"playlist": name, "error": "No tracks returned"})
                    log(f"[EXPORTIFY] {name!r}: no tracks")
                    continue
                parsed = parse_exportify_csv(csv_text, name)
                # Prefer real Spotify playlist id when we have one
                if not target.get("liked"):
                    parsed["playlist"]["id"] = target["id"]
                    parsed["playlist"]["access"] = target.get("access") or "followed"
                    parsed["playlist"]["url"] = (
                        f"https://open.spotify.com/playlist/{target['id']}"
                    )
                total_tracks += parsed["track_count"]
                log(
                    f"[EXPORTIFY] {name!r} ({target.get('access')}): "
                    f"{parsed['track_count']} tracks → "
                    f"{len(parsed['playlist_artist_ids'])} artists (CSV resolve)"
                )
                for artist in parsed["artists"]:
                    existing = all_artists.get(artist["id"])
                    if not existing:
                        all_artists[artist["id"]] = artist
                    else:
                        existing["track_count"] += artist["track_count"]
                        existing["playlists"] |= artist["playlists"]
                        if artist.get("genres") and not existing.get("genres"):
                            existing["genres"] = artist["genres"]
                        if artist.get("liked_track") and not existing.get("liked_track"):
                            existing["liked_track"] = artist["liked_track"]
                pl = parsed["playlist"]
                ids = parsed["playlist_artist_ids"]
                if pl["name"] in playlist_artists:
                    playlist_artists[pl["name"]] = sorted(
                        set(playlist_artists[pl["name"]]) | set(ids)
                    )
                    for existing_pl in playlists_out:
                        if existing_pl["name"] == pl["name"]:
                            existing_pl["trackCount"] = (
                                existing_pl.get("trackCount") or 0
                            ) + pl["trackCount"]
                            existing_pl["artistTotal"] = len(
                                playlist_artists[pl["name"]]
                            )
                            break
                else:
                    playlist_artists[pl["name"]] = ids
                    playlists_out.append(pl)
                pulled_names.append(name)
            except Exception as e:
                if spotify_rate_limited(e):
                    log(f"[PULL] rate limited after {len(pulled_names)} playlists")
                    break
                errors.append({"playlist": name, "error": str(e)})
                log(f"[EXPORTIFY] failed {name!r}: {e}")

        if not all_artists:
            return jsonify(
                {
                    "error": "Could not pull any tracks from Spotify.",
                    "errors": errors,
                    "hint": (
                        "Export CSVs from https://exportify.net and use Import Exportify CSV, "
                        "or retry when not rate-limited."
                    ),
                }
            ), 400

        payload = finalize_mapped_import(
            all_artists,
            playlists_out,
            playlist_artists,
            total_tracks,
            source="exportify_pull",
        )
        if not payload:
            return jsonify({"error": "No artists found"}), 400

        # Full playlist shelf for the UI — only mark blocked if pull failed for that name
        failed = {e["playlist"] for e in errors if e.get("playlist")}
        playlists_meta = collect_playlists(
            sp, playlist_entries=entries, user_id=user_id, count_liked=False
        )
        by_name = {p["name"]: p for p in playlists_out}
        for pl in playlists_meta:
            mapped = by_name.get(pl["name"])
            if mapped:
                pl["artistCount"] = mapped.get("artistCount") or 0
                pl["artistTotal"] = mapped.get("artistTotal") or 0
                pl["trackCount"] = mapped.get("trackCount") or pl.get("trackCount")
                pl["tracksBlocked"] = False
                pl["blockReason"] = None
                pl["access"] = mapped.get("access") or pl.get("access")
            elif pl["name"] in failed:
                pl["tracksBlocked"] = True
                pl["blockReason"] = (
                    "followed" if pl.get("access") == "followed" else "api_restricted"
                )
            else:
                # Listed but not pulled yet (e.g. rate-limit mid-run)
                pl["tracksBlocked"] = pl.get("access") == "followed"
                pl["blockReason"] = "followed" if pl.get("access") == "followed" else None

        payload["meta"]["errors"] = errors
        payload["meta"]["pulled_playlists"] = pulled_names
        payload["playlists"] = _merge_playlist_rows(playlists_meta, playlists_out)
        # Persist merged shelf so refresh keeps non-Liked playlists
        uid = user_id or "csv-import"
        save_library_cache(
            uid,
            {
                "items": payload["items"],
                "playlists": payload["playlists"],
                "playlistArtists": payload["playlistArtists"],
                "meta": payload["meta"],
            },
        )
        return jsonify(payload)
    except Exception as e:
        if spotify_rate_limited(e):
            return jsonify(
                {
                    "error": "Spotify rate limit reached.",
                    "rate_limited": True,
                    "retry_after_seconds": retry_after_seconds(e),
                }
            ), 429
        return jsonify({"error": str(e)}), 500


def _fetch_playlist_tracks_with_backoff(sp, playlist_id, market, max_retries=3, tracks_href=None):
    """Fetch playlist tracks with retry/backoff on 429 rate limits."""
    tracks = []
    for page in _iter_playlist_tracks_with_backoff(
        sp, playlist_id, market, max_retries, tracks_href=tracks_href
    ):
        for item in page.get("items") or []:
            track = _track_from_playlist_item(item)
            if track.get("id") and not track.get("is_local"):
                tracks.append(track)
                if len(tracks) >= 2000:
                    return tracks
    return tracks


def _iter_playlist_tracks_with_backoff(
    sp, playlist_id, market, max_retries=3, tracks_href=None
):
    """Like iter_playlist_tracks but retries on 429 with Retry-After backoff."""
    offset = 0
    while True:
        page = None
        for attempt in range(max_retries + 1):
            try:
                page = _fetch_playlist_track_page(
                    sp,
                    playlist_id,
                    offset,
                    market=market,
                    tracks_href=tracks_href,
                )
                break
            except Exception as e:
                if spotify_rate_limited(e) and attempt < max_retries:
                    wait = min(retry_after_seconds(e, default=5), 30)
                    log(
                        f"[PULL] 429 on playlist {playlist_id} offset {offset}, "
                        f"retry {attempt + 1}/{max_retries} after {wait}s"
                    )
                    time.sleep(wait)
                    token_info = _spotify_bearer_token(sp)
                    if token_info:
                        sp = spotipy.Spotify(
                            auth=token_info, requests_timeout=12, retries=0
                        )
                    continue
                raise
        if page is None:
            break
        yield page
        if not page.get("next"):
            break
        offset += len(page.get("items") or [])
        time.sleep(0.3)


@app.post("/api/library/import-csv")
def import_exportify_csv():
    """Import one or more Exportify playlist CSV files and map their artists."""
    files = request.files.getlist("files")
    if not files:
        single = request.files.get("file")
        if single:
            files = [single]
    if not files:
        return jsonify(
            {
                "error": "Upload one or more Exportify CSV files.",
                "hint": "Use Pull from Spotify in Account, or download CSV from this app.",
            }
        ), 400

    override_name = (request.form.get("playlist_name") or "").strip()
    all_artists = {}
    playlists_out = []
    playlist_artists = {}
    total_tracks = 0
    errors = []

    for f in files:
        if not f or not f.filename:
            continue
        try:
            raw = f.read()
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            pname = override_name if len(files) == 1 and override_name else playlist_name_from_filename(
                f.filename
            )
            parsed = parse_exportify_csv(text, pname)
            total_tracks += parsed["track_count"]
            for artist in parsed["artists"]:
                existing = all_artists.get(artist["id"])
                if not existing:
                    all_artists[artist["id"]] = artist
                else:
                    existing["track_count"] += artist["track_count"]
                    existing["playlists"] |= artist["playlists"]
                    if artist.get("genres") and not existing.get("genres"):
                        existing["genres"] = artist["genres"]
                    if artist.get("liked_track") and not existing.get("liked_track"):
                        existing["liked_track"] = artist["liked_track"]
            pl = parsed["playlist"]
            ids = parsed["playlist_artist_ids"]
            if pl["name"] in playlist_artists:
                playlist_artists[pl["name"]] = sorted(
                    set(playlist_artists[pl["name"]]) | set(ids)
                )
                for existing_pl in playlists_out:
                    if existing_pl["name"] == pl["name"]:
                        existing_pl["trackCount"] = (existing_pl.get("trackCount") or 0) + pl[
                            "trackCount"
                        ]
                        existing_pl["artistTotal"] = len(playlist_artists[pl["name"]])
                        break
            else:
                playlist_artists[pl["name"]] = ids
                playlists_out.append(pl)
        except Exception as e:
            errors.append({"file": f.filename, "error": str(e)})

    if not all_artists and errors:
        return jsonify({"error": errors[0]["error"], "errors": errors}), 400
    if not all_artists:
        return jsonify({"error": "No artists found in CSV"}), 400

    payload = finalize_mapped_import(
        all_artists, playlists_out, playlist_artists, total_tracks, source="exportify_csv"
    )
    if not payload:
        return jsonify({"error": "No artists found in CSV"}), 400
    payload["meta"]["errors"] = errors
    return jsonify(payload)


def _merge_artist_rows(existing, incoming):
    by_key = {}
    for row in existing + incoming:
        key = (row.get("spotifyId") or "").strip() or (row.get("name") or "").strip().lower()
        if not key:
            continue
        prev = by_key.get(key)
        if not prev:
            by_key[key] = {**row, "playlists": list(row.get("playlists") or [])}
            continue
        tags = set(prev.get("playlists") or []) | set(row.get("playlists") or [])
        prev["playlists"] = sorted(tags)
        prev["plays"] = max(int(prev.get("plays") or 0), int(row.get("plays") or 0))
        if row.get("likedTrack") and not prev.get("likedTrack"):
            prev["likedTrack"] = row["likedTrack"]
        if row.get("genre") and (not prev.get("genre") or prev.get("genre") == "Other"):
            prev["genre"] = row["genre"]
        by_key[key] = prev
    return list(by_key.values())


def _merge_playlist_rows(existing, incoming):
    by_name = {p["name"]: dict(p) for p in existing if p.get("name")}
    for pl in incoming:
        name = pl.get("name")
        if not name:
            continue
        prev = by_name.get(name)
        if not prev:
            by_name[name] = dict(pl)
            continue
        prev["trackCount"] = max(prev.get("trackCount") or 0, pl.get("trackCount") or 0)
        prev["artistTotal"] = max(prev.get("artistTotal") or 0, pl.get("artistTotal") or 0)
        prev["artistCount"] = max(prev.get("artistCount") or 0, pl.get("artistCount") or 0)
        prev["tracksBlocked"] = False
        prev["access"] = pl.get("access") or prev.get("access")
        by_name[name] = prev
    out = list(by_name.values())
    out.sort(key=lambda p: (p["name"] != "Liked Songs", p["name"].lower()))
    return out


@app.get("/api/library/liked-track")
def liked_track_for_artist():
    artist_id = request.args.get("artist_id", "").strip()
    artist_name = request.args.get("name", "").strip()
    artist_name_key = artist_name.lower()
    if not artist_id and not artist_name_key:
        return jsonify({"error": "artist_id or name required"}), 400

    # Prefer local index — works during Spotify rate limits / CSV imports
    cached = lookup_liked_index(artist_id=artist_id or None, artist_name=artist_name)
    if cached:
        return jsonify({"likedTrack": cached, "from_cache": True})

    user_id = (session.get("spotify_user") or {}).get("id")
    for uid in (user_id, "csv-import"):
        if not uid:
            continue
        lib = load_library_cache(uid)
        if not lib:
            continue
        for item in lib.get("items") or []:
            same_id = artist_id and item.get("spotifyId") == artist_id
            same_name = artist_name_key and (item.get("name") or "").lower() == artist_name_key
            if (same_id or same_name) and (item.get("likedTrack") or {}).get("id"):
                return jsonify({"likedTrack": item["likedTrack"], "from_cache": True})

    sp = get_spotify_client()
    if not sp:
        return jsonify(
            {
                "likedTrack": None,
                "searchUrl": (
                    f"https://open.spotify.com/search/{quote(artist_name)}"
                    if artist_name
                    else None
                ),
                "error": "Not authenticated and no cached liked track",
            }
        ), 404

    try:
        results = sp.current_user_saved_tracks(limit=50)
        liked_index = load_liked_index()
        found = None
        while results:
            for item in results.get("items") or []:
                track = (item or {}).get("track") or {}
                if not track.get("id"):
                    continue
                for artist in track.get("artists", []):
                    a_id = artist.get("id")
                    a_name = artist.get("name") or ""
                    remember_liked_track(liked_index, a_id, a_name, track)
                    artist_matches = artist_id and a_id == artist_id
                    name_matches = artist_name_key and a_name.lower() == artist_name_key
                    if not found and (artist_matches or name_matches):
                        found = liked_track_payload(track)
            results = sp.next(results) if results.get("next") else None
        save_liked_index(liked_index)
        if found:
            return jsonify({"likedTrack": found, "from_cache": False})
        return jsonify(
            {
                "likedTrack": None,
                "searchUrl": (
                    f"https://open.spotify.com/search/{quote(artist_name)}"
                    if artist_name
                    else None
                ),
            }
        ), 404
    except Exception as e:
        if spotify_rate_limited(e):
            wait = retry_after_seconds(e)
            return jsonify(
                {
                    "likedTrack": None,
                    "rate_limited": True,
                    "retry_after_seconds": wait,
                    "error": "Spotify rate limit — can't look up Liked Songs right now.",
                    "searchUrl": (
                        f"https://open.spotify.com/search/{quote(artist_name)}"
                        if artist_name
                        else None
                    ),
                }
            ), 429
        return jsonify({"error": str(e)}), 500


@app.post("/api/share")
def api_share():
    data = request.get_json(force=True)
    image_data_url = data.get("image")
    stats = data.get("stats", {})
    item_count = data.get("itemCount", 0)
    country_count = data.get("countryCount", 0)
    title = data.get("title") or "My Spotify Music Map"

    if not image_data_url:
        return jsonify({"error": "image is required"}), 400

    share_id = secrets.token_urlsafe(10)

    # Decode the base64 data URL and write the PNG file
    if "," in image_data_url:
        image_b64 = image_data_url.split(",", 1)[1]
    else:
        image_b64 = image_data_url
    image_bytes = base64.b64decode(image_b64)
    (SHARES_DIR / f"{share_id}.png").write_bytes(image_bytes)

    # Save metadata
    metadata = {
        "id": share_id,
        "stats": stats,
        "itemCount": item_count,
        "countryCount": country_count,
        "title": title,
        "created_at": time.time(),
    }
    (SHARES_DIR / f"{share_id}.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return jsonify({"url": f"/share/{share_id}", "id": share_id})


@app.get("/share/<share_id>")
def share_page(share_id):
    meta_path = SHARES_DIR / f"{share_id}.json"
    if not meta_path.exists():
        return jsonify({"error": "Share not found"}), 404

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    title = meta.get("title", "My Spotify Music Map")
    item_count = meta.get("itemCount", 0)
    country_count = meta.get("countryCount", 0)
    description = f"{item_count} artists from {country_count} countries"
    og_image = request.host_url.rstrip("/") + f"/share/{share_id}/og.png"

    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title}</title>
    <meta property="og:title" content="{title}">
    <meta property="og:description" content="{description}">
    <meta property="og:image" content="{og_image}">
    <meta property="og:type" content="website">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{title}">
    <meta name="twitter:description" content="{description}">
    <meta name="twitter:image" content="{og_image}">
    <meta http-equiv="refresh" content="1;url=/?shared={share_id}">
</head>
<body>
    <p>Redirecting to map&hellip;</p>
</body>
</html>"""

    resp = make_response(html)
    resp.headers["Content-Type"] = "text/html; charset=utf-8"
    return resp


@app.get("/share/<share_id>/og.png")
def share_og_image(share_id):
    image_path = SHARES_DIR / f"{share_id}.png"
    if not image_path.exists():
        return jsonify({"error": "Image not found"}), 404

    return send_file(image_path, mimetype="image/png")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
