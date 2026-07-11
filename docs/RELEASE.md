# Releasing swear-jar (maintainer notes)

Provenance for the leaderboard depends on each published release carrying a
known hash. The stamp step ties the built app to an entry the board trusts.

## Release-stamp procedure

1. Cut the release commit on `main` (version bumped in `package.json` +
   `src/version.mjs` `APP_VERSION`).
2. Stamp the hash — replace the `RELEASE_HASH` placeholder in
   [`src/version.mjs`](../src/version.mjs) with the release commit SHA:

   ```bash
   SHA=$(git rev-parse HEAD)
   # set RELEASE_HASH = "$SHA" in src/version.mjs, commit as the release
   ```

3. Register it so the board marks submissions from this build ✓ verified —
   append the SHA to
   [`scripts/leaderboard/known-releases.json`](../scripts/leaderboard/known-releases.json):

   ```json
   { "<full-sha>": { "version": "0.1.0", "published": "<ISO date>" } }
   ```

4. `npm publish` (maintainer only — requires `private: false`, a Jim-only
   decision at go-public) and tag the release.

A dev build keeps the placeholder hash, which the board treats as **unverified**
— that is the honest signal, not a bug. Verified means "came from a published
release + a verified account", never "these numbers are provably real" (a local
tool can't prove that — see [SECURITY.md](../SECURITY.md)).
