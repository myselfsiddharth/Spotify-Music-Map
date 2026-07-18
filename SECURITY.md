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

## Safe contribution rules

- Never commit `.env`, Spotify client secrets, session cookies, OAuth tokens, or personal library/cache data.
- Do not paste secrets into issues, PRs, or screenshots.
- Prefer local testing with your own Spotify Developer app credentials.
- Treat third-party APIs (Spotify, Wikidata, MusicBrainz) with respect for their rate limits and terms of use.
