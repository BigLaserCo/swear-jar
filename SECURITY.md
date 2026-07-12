# Security & Privacy

> **Note.** Swear Jar is an AI-built application: specified and directed by a
> human, written almost entirely by AI, and not every line has been read by
> human eyes. Treat it accordingly — it's a toy. The source is short and
> MIT-licensed; read it yourself.

swear-jar is a local novelty tool: it counts how often you (and your AI) swear
while you work, and shows you the tally. It is built to be **boring and
trustworthy** — no network, no dependencies, no data leaving your machine. This
document states exactly what it does with your data and how each guarantee is
enforced mechanically in CI, so you don't have to take our word for it.

## What data is collected

For every message that contains a tracked word, swear-jar records **a count, not
the text**. A ledger row looks like this:

```json
{"v":1,"uuid":"3b1f…","ts":"2026-07-09T12:00:00.000Z","session":"a2c…",
 "source":"user","agent":"claude","event":"Stop",
 "project":"my-app","cwd":"/Users/me/code/my-app",
 "transcript":"/Users/me/.claude/projects/my-app/a2c….jsonl",
 "words":{"fuck":1,"shit":2},"coins":7,"h":"9f2c8e…"}
```

- **`words`** — a map of normalized swear-word *families* (e.g. `fuck`, `shit`)
  to how many times each was used. The number is the only payload.
- **Metadata** — `source` (you vs. the assistant), `agent`, `event`, `project`,
  `cwd`, a `ts` timestamp, the local `transcript` file path the count came from,
  a `session` id, and a `uuid` used only to avoid double-counting the same
  message. `coins` is a derived score; `v` is the row-format version.
- **`h`** — a per-row hash-chain link (see *Tamper-EVIDENT ledger* below).

Every one of these is either a small integer or a **local** identifier/path on
your own machine. None of it is message content.

**What is never stored:**

- The **message text** — your prompt, the assistant's reply, and every
  surrounding word. Only the aggregate family counts above are written.
- The **verbatim surface forms** — the ledger holds the family key `fuck`
  with a count; it never stores what you actually typed (`fucking`, `shitty`,
  the sentence around it). Censoring (`f**k`) happens only when a report is
  *displayed*, never at rest.
- Any **secret, key, or token** that happened to be in the message.

### Where it is stored

Everything lives in a single local directory: **`~/.swear-jar/`**
(`ledger.jsonl` — the append-only counts; `state.json` — scan bookmarks).
Nothing is uploaded, synced, or transmitted. Delete the folder and the jar is
gone. (You can point it elsewhere with `SWEAR_JAR_HOME`.)

## Guarantees — and how each is mechanically enforced

Every guarantee below is a **check in `scripts/ci/verify.mjs`** that fails the
build red, so a regression can't ship. Run the whole gate yourself with
`node scripts/ci/verify.mjs`.

| Guarantee | How it's enforced |
| --- | --- |
| **Zero dependencies.** No third-party code in the install. | verify check **(c) no-deps** parses `package.json` and fails if it declares any runtime dependency. The tree has none. |
| **Zero network.** Nothing is ever sent anywhere. | verify check **(b) no-network** scans all of `src/` and `bin/` and fails on any `fetch(`, `http.request`, `https.request`, `net.connect`, `child_process`, or an `exec` of `curl`/`wget`. There are none. |
| **No first-party / internal code.** No private company code rides along in the open tree. | verify check **(f) leak-guard** (`scripts/ci/leak-guard.mjs`) scans the shipped `bin/`, `src/`, and `scripts/` source and fails on any non-stdlib/non-relative `import`/`require`, any relative import that escapes the repo root, or any internal-scope token from an auditable denylist. |
| **No secrets in the tree.** | verify check **(d) no-secrets** scans every tracked file for API-key, token, and private-key patterns. |
| **Privacy invariant — counts only, never text.** | verify check **(e) privacy** feeds a hostile transcript (real swears **plus** a planted fake credential) through the real scanner end-to-end, then asserts the ledger holds only word-count keys — the credential and the message text are proven absent. |
| **Tamper-EVIDENT ledger.** Casual, silent edits to your local ledger are detectable. | Each row carries `h = sha256(previousRowHash + the row's own fields)`, chaining every row to the one before it. `verifyLedger()` in `src/ledger.mjs` re-walks the chain and reports the first row whose hash no longer recomputes. This is **tamper-evident, not tamper-proof**: anyone who owns the file can rebuild the whole chain — the point is to make casual hand-edits *visible*, not to stop a determined editor. |
| **No install-time code execution.** | Dependencies are zero (enforced by **(c)**), so `npm install` fetches nothing and runs no third-party lifecycle scripts. The package's own `package.json` declares **no** `install` / `postinstall` / `prepare` script — only `test` and `verify`. |

The whole shipped program is **about 2,600 lines of Node standard-library
JavaScript** (~1,900 excluding comments and blanks) across `bin/` and `src/` —
small enough to read in a sitting.

## Verify it yourself in 60 seconds

You don't have to trust the table above — confirm it directly:

1. **No network calls.**
   ```sh
   grep -rnE 'fetch|http|net\.connect|child_process' src bin
   ```
   Every hit falls into exactly two classes, and none is a network call site:
   `https://…` URL *strings* (the hosted-page and tip links the CLI prints or
   your browser opens — printing a URL is not a request), and one real
   `node:child_process` import in `src/open.mjs`, which spawns your OS's
   "open this in the browser" helper (`open`/`start`/`xdg-open`) — a local
   program launch, no socket, no data sent. There are **zero**
   `fetch`/`http.request`/`net.connect` call sites; verify check **(b)
   no-network** fails the build if one ever appears.

2. **It works with the network off.** Turn off Wi-Fi / pull the cable and run
   any command (`swear-jar status`, `swear-jar backfill`). Everything still
   works, because nothing ever needed the network.

3. **The ledger is just counts.**
   ```sh
   cat ~/.swear-jar/ledger.jsonl
   ```
   You'll see family counts, the metadata fields above, and a per-row hash —
   no message text, no secrets.

4. **Read the source.** It's ~2,600 lines of plain stdlib JavaScript in `bin/`
   and `src/`. No build step, no minification, no dependencies to audit.

5. **Run the gate.**
   ```sh
   node scripts/ci/verify.mjs
   ```
   It runs every guarantee in the table above as a mechanical pass/fail check,
   including the `leak-guard` internal-code scanner.

## Reporting a security issue

Found something — a leak, an unexpected write, a way to make it phone home?
Please report it **privately** rather than opening a public issue, and allow a
little time for a fix before disclosure:

- **GitHub private vulnerability reporting** — the *"Report a vulnerability"*
  button on this repo's **Security** tab, or
- **<https://setupyour.ai/contact>**

Thank you.
