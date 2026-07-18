# Contributing to Sonic Cartography

Thanks for wanting to help. Contributions of all kinds are welcome—bug reports, fixes, features, docs, and design polish.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

1. Search [existing issues](https://github.com/myselfsiddharth/Spotify-Music-Map/issues) and pull requests to avoid duplicates.
2. For larger changes, open an issue first so we can agree on direction.
3. Never commit secrets (`.env`, API keys, tokens, personal Spotify data, or cache files).

## Development setup

```bash
git clone https://github.com/myselfsiddharth/Spotify-Music-Map.git
cd Spotify-Music-Map
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
# Add your Spotify app credentials to .env (use your own Developer app)
python app.py
```

Use your own Spotify Developer app and redirect URI. Do not share credentials in issues or PRs.

## Making changes

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b fix/short-description
   ```
2. Keep PRs focused—one problem or feature per PR when possible.
3. Match existing code style and project structure.
4. Update docs when behavior or setup changes.
5. Do not include personal library caches, screenshots of private data, or secrets.

## Run tests and make sure your solution works

**Before opening a pull request, run the tests and make sure your solution works.**

```bash
# Automated tests (required)
pytest

# Manual check (required for UI / map / auth changes)
python app.py
# Open http://127.0.0.1:5000 and verify the flow you changed
```

Checklist:

- [ ] `pytest` passes locally
- [ ] The app starts without errors
- [ ] You manually verified the change (happy path + an obvious edge case)
- [ ] No secrets, `.env`, or personal cache files are included
- [ ] CI on your PR is green (or you explained any failure)

If you cannot fully test something (for example Spotify rate limits), say so clearly in the PR.

## Pull requests

1. Push your branch and open a PR against `main`.
2. Fill out the PR template—describe **what** changed and **why**.
3. Link related issues (`Fixes #123`).
4. Be ready to respond to review feedback.

We may ask for changes, split a large PR, or decline work that is out of scope or unsafe (for example anything that weakens auth, exposes secrets, or scrapes data against third-party terms).

## Reporting security issues

Do **not** open a public issue for vulnerabilities. See [SECURITY.md](SECURITY.md).

## Questions

Open a GitHub issue with the question label, or comment on a related thread. Thanks for contributing.
