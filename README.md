# Swear Jar 🫙

See how frustrated you get at AI — and how likely you are to survive the
robot uprising. Swear Jar is a small, open-source, MIT-licensed novelty tool.

It hooks into local prompts and can inspect supported recordings/transcripts.
Analysis is local and the ledger stores counts only. When you deliberately open
a hosted report, it shares aggregate metadata such as totals, distributions,
censored summary words, and uprising stats. Raw sentences stay on your machine.

## Install

```sh
git clone https://github.com/BigLaserCo/swear-jar.git ~/Code/swear-jar
cd ~/Code/swear-jar
node bin/swear-jar.mjs install
node bin/swear-jar.mjs init --local --no-open
```

Check the report with `node bin/swear-jar.mjs status` or
`node bin/swear-jar.mjs dashboard --local --no-open`.

Uninstall the hooks with:

```sh
node bin/swear-jar.mjs uninstall
```

The ledger at `~/.swear-jar/` is left intact by uninstall.

## Detection and pricing

The launch lexicon is English-only and deliberately excludes racial and
bigoted slurs. Users can add local custom terms:

```sh
node bin/swear-jar.mjs custom add "your-term"
node bin/swear-jar.mjs custom list
node bin/swear-jar.mjs custom remove "your-term"
```

Custom terms are reported only as **user-specific**; their spellings are not
rendered in the UI or sent in aggregate links. Current examples include
darn/heck at $0.10, damn it at $0.25, fuck at $1, and cunt at $5.

## Scope

This is a free toy project with no funding or paid support. It is provided
“as-is”; run it at your own risk. Review the [Terms](docs/terms.html) and
[installation notes](docs/INSTALL.md) before using it.
