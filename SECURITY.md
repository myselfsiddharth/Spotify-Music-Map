# Security Policy

## Supported versions

Security fixes are applied to the latest code on the `main` branch.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Private vulnerability reporting is enabled on this repository.

Instead, report privately via one of these options:

1. [GitHub Security Advisories / private vulnerability reporting](https://github.com/myselfsiddharth/Spotify-Music-Map/security/advisories/new) (preferred)
2. Email the maintainer through the contact listed on their [GitHub profile](https://github.com/myselfsiddharth)

Include:

- A clear description of the issue
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You should receive an acknowledgment within 7 days. Please give us reasonable time to investigate and release a fix before any public disclosure.

## How your Spotify keys are handled

- Keys entered on the app's setup screen are verified with Spotify, then kept in the Flask
  session — the same place this app already stores your OAuth access and refresh tokens.
- That session is a **signed cookie in your browser**, not server-side storage. It is signed
  against tampering but not encrypted, so anyone who can read the cookie can read its contents.
  It is HttpOnly (not reachable from JavaScript) and SameSite=Lax, and Secure when
  `FLASK_ENV=production`. **Run behind HTTPS in production** so it is never sent in the clear.
- The client secret is never written to disk by the app, never logged, and never returned by any
  endpoint. `GET /api/config/spotify` reports only the Client ID, the public half of the pair.
- Saving new keys clears any OAuth token issued by the previous app.
- Because the keys are per-browser, several people can share one server without sharing a
  Spotify app. `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in the environment are a
  server-wide fallback — use those only where every visitor is meant to share your app.
- `.flask_secret` (auto-generated when `FLASK_SECRET_KEY` is unset) signs those cookies. It is
  gitignored — treat it like any other secret and do not commit or share it.

## Safe contribution rules

- Never commit `.env`, `.flask_secret`, Spotify client secrets, session cookies, OAuth tokens, or personal library/cache data.
- Do not paste secrets into issues, PRs, or screenshots.
- Prefer local testing with your own Spotify Developer app credentials.
- Treat third-party APIs (Spotify, Wikidata, MusicBrainz) with respect for their rate limits and terms of use.
