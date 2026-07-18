#!/usr/bin/env python3
"""
Sonic Cartography — data builder
================================
Turns YOUR Spotify library into `data.json` for the globe tool.

What it does, step by step:
  1. Auth with Spotify (your account) and pull the artists you actually listen to
     (your playlists + top artists), tagging each with the playlists it appears in.
  2. For each artist, resolve WHERE THEY'RE FROM. Spotify does not provide this —
     so we query MusicBrainz for the artist's area / begin-area (the real work),
     then geocode that place to lat/lng via OpenStreetMap.
  3. Write data.json in the shape the globe expects, ready to "Load your library".

This resolution step is deliberately the substance: names are messy, some artists
don't resolve, some collide. The script keeps a cache and logs what it couldn't place.

-----------------------------------------------------------------------------------
SETUP
  pip install spotipy musicbrainzngs requests

  In your Spotify Developer Dashboard (https://developer.spotify.com/dashboard):
    - copy your Client ID and Client Secret into the CONFIG block below
    - add this Redirect URI to the app:  http://127.0.0.1:8888/callback

RUN
  python spotify_origins.py
  (a browser opens once so you can authorize; then it runs unattended)

OUTPUT
  data.json          <- load this in the globe with "Load your library"
  origins_cache.json <- cache so re-runs are fast; safe to delete
-----------------------------------------------------------------------------------
"""

import os, sys, time, json, re
import requests
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import musicbrainzngs

# ============================= CONFIG =============================
CLIENT_ID     = os.environ.get("SPOTIFY_CLIENT_ID", "PASTE_YOUR_CLIENT_ID")
CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "PASTE_YOUR_CLIENT_SECRET")
REDIRECT_URI  = "http://127.0.0.1:8888/callback"
CONTACT_EMAIL = "you@example.com"      # MusicBrainz asks for a contact in the user-agent

MAX_ARTISTS   = 150                    # cap so a first run isn't too slow (raise later)
INCLUDE_TOP_ARTISTS = True             # also fold in your Spotify "top artists"
# =================================================================

SCOPES = "user-top-read playlist-read-private playlist-read-collaborative user-library-read"

# Map Spotify's granular genre strings -> the globe's buckets. First match wins.
GENRE_RULES = [
    ("Afrobeats", ["afrobeat", "afropop", "amapiano", "naija", "highlife"]),
    ("Latin",     ["latin", "reggaeton", "salsa", "bachata", "cumbia", "brasil", "brazil", "mpb", "funk carioca", "corrido", "banda"]),
    ("Reggae",    ["reggae", "dancehall", "dub", "ska"]),
    ("Hip-Hop",   ["hip hop", "rap", "drill", "trap", "grime"]),
    ("R&B/Soul",  ["r&b", "rnb", "soul", "neo soul", "funk", "motown"]),
    ("Electronic",["electronic", "house", "techno", "edm", "dubstep", "dnb", "drum and bass", "trance", "garage", "ambient", "idm", "electropop"]),
    ("Jazz",      ["jazz", "bossa", "swing", "bebop"]),
    ("Indie",     ["indie", "bedroom", "dream pop", "shoegaze", "lo-fi", "art pop"]),
    ("Rock",      ["rock", "metal", "punk", "grunge", "emo", "hardcore"]),
    ("Pop",       ["pop", "k-pop", "kpop", "j-pop", "singer-songwriter"]),
]

def bucket_genre(spotify_genres):
    text = " ".join(spotify_genres).lower()
    for bucket, keys in GENRE_RULES:
        if any(k in text for k in keys):
            return bucket
    return spotify_genres[0].title() if spotify_genres else "Other"

# ----------------------------- Spotify -----------------------------
def get_spotify():
    if "PASTE_YOUR" in CLIENT_ID:
        sys.exit("Set CLIENT_ID / CLIENT_SECRET in the CONFIG block (or as env vars) first.")
    auth = SpotifyOAuth(client_id=CLIENT_ID, client_secret=CLIENT_SECRET,
                        redirect_uri=REDIRECT_URI, scope=SCOPES, cache_path=".spotify_cache")
    return spotipy.Spotify(auth_manager=auth, requests_timeout=20, retries=3)

def collect_artists(sp):
    """Return {artist_id: {name, track_count, playlists:set, genres, popularity}}."""
    artists = {}

    def bump(a_id, name, playlist=None):
        e = artists.setdefault(a_id, {"name": name, "track_count": 0,
                                      "playlists": set(), "genres": [], "popularity": 0})
        e["track_count"] += 1
        if playlist:
            e["playlists"].add(playlist)

    # 1) your playlists -> tag artists with the playlist they live in
    print("Reading your playlists...")
    results = sp.current_user_playlists(limit=50)
    while results:
        for pl in results["items"]:
            if not pl:
                continue
            pname = pl["name"]
            tracks = sp.playlist_items(pl["id"], additional_types=["track"], limit=100)
            while tracks:
                for it in tracks["items"]:
                    tr = (it or {}).get("track") or {}
                    for a in tr.get("artists", []):
                        if a.get("id"):
                            bump(a["id"], a["name"], pname)
                tracks = sp.next(tracks) if tracks.get("next") else None
            print(f"  · {pname}")
        results = sp.next(results) if results.get("next") else None

    # 2) top artists (optional) — strong signal of what you actually play
    if INCLUDE_TOP_ARTISTS:
        print("Reading your top artists...")
        for rng in ("long_term", "medium_term", "short_term"):
            top = sp.current_user_top_artists(limit=50, time_range=rng)
            for a in top["items"]:
                bump(a["id"], a["name"])

    # 3) enrich with genres + popularity (batched 50 at a time)
    ids = list(artists.keys())
    for i in range(0, len(ids), 50):
        for a in sp.artists(ids[i:i+50])["artists"]:
            if a and a["id"] in artists:
                artists[a["id"]]["genres"] = a.get("genres", [])
                artists[a["id"]]["popularity"] = a.get("popularity", 0)

    # keep the most-present artists first, then cap
    ranked = sorted(artists.values(), key=lambda e: e["track_count"], reverse=True)
    return ranked[:MAX_ARTISTS]

# --------------------------- Origins (MusicBrainz + geocode) ---------------------------
musicbrainzngs.set_useragent("SonicCartography", "0.2", CONTACT_EMAIL)

def load_cache():
    try:
        with open("origins_cache.json") as f:
            return json.load(f)
    except Exception:
        return {}

def save_cache(c):
    with open("origins_cache.json", "w") as f:
        json.dump(c, f, indent=0)

def mb_lookup(name):
    """Return (city, country) best-effort from MusicBrainz, or (None, None)."""
    try:
        res = musicbrainzngs.search_artists(artist=name, limit=3)
    except Exception:
        return None, None
    for cand in res.get("artist-list", []):
        # take a reasonably confident match
        if int(cand.get("ext:score", "0")) < 70:
            continue
        area  = (cand.get("area") or {}).get("name")
        begin = (cand.get("begin-area") or {}).get("name")
        country = area if area else cand.get("country")
        city    = begin if begin else None
        if city or country:
            return city, country
    return None, None

def geocode(place):
    """OpenStreetMap Nominatim -> (lat, lng). Respect the 1 req/sec policy."""
    try:
        r = requests.get("https://nominatim.openstreetmap.org/search",
                         params={"q": place, "format": "json", "limit": 1},
                         headers={"User-Agent": f"SonicCartography/0.2 ({CONTACT_EMAIL})"},
                         timeout=20)
        time.sleep(1.1)
        j = r.json()
        if j:
            return round(float(j[0]["lat"]), 4), round(float(j[0]["lon"]), 4)
    except Exception:
        pass
    return None, None

def resolve_origin(name, cache):
    if name in cache:
        return cache[name]
    city, country = mb_lookup(name)
    time.sleep(1.1)  # MusicBrainz rate limit
    lat = lng = None
    place = ", ".join([p for p in (city, country) if p])
    if place:
        lat, lng = geocode(place)
    out = {"city": city, "country": country, "lat": lat, "lng": lng}
    cache[name] = out
    save_cache(cache)
    return out

# ------------------------------- main -------------------------------
def main():
    sp = get_spotify()
    artists = collect_artists(sp)
    print(f"\nResolving origins for {len(artists)} artists "
          f"(~1–2s each for uncached; grab a coffee)...\n")

    cache = load_cache()
    rows, unresolved = [], []
    for i, a in enumerate(artists, 1):
        o = resolve_origin(a["name"], cache)
        tag = "ok" if o["lat"] is not None else "no origin"
        print(f"[{i:>3}/{len(artists)}] {a['name'][:34]:<34} -> "
              f"{(o['city'] or o['country'] or '???')}  ({tag})")
        if o["lat"] is None:
            unresolved.append(a["name"])
            continue
        rows.append({
            "name": a["name"],
            "city": o["city"] or o["country"] or "—",
            "country": o["country"] or "—",
            "lat": o["lat"], "lng": o["lng"],
            "genre": bucket_genre(a["genres"]),
            # NOTE: Spotify's API doesn't expose play counts. This is an affinity
            # proxy = how many of your library tracks feature the artist, lifted a
            # bit by popularity. Rename the readout label if you like.
            "plays": a["track_count"] * 25 + a["popularity"],
            "playlists": sorted(a["playlists"]),
        })

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=0)

    print(f"\nWrote data.json  ·  {len(rows)} placed, {len(unresolved)} unresolved.")
    if unresolved:
        print("Couldn't place (try adding manually, or a broader MusicBrainz match):")
        print("  " + ", ".join(unresolved[:25]) + (" ..." if len(unresolved) > 25 else ""))
    print('\nNow open the globe and click "Load your library" -> data.json')

if __name__ == "__main__":
    main()
