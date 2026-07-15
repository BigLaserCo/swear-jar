# Install Swear Jar

Swear Jar is a small, MIT-licensed Node tool. It reads prompts and supported
recordings/transcripts locally, stores counts only, and makes no background
network calls. Opening a hosted report deliberately shares aggregate numbers;
raw sentences stay on your machine.

## Install from GitHub

```sh
git clone https://github.com/BigLaserCo/swear-jar.git ~/Code/swear-jar
cd ~/Code/swear-jar
node bin/swear-jar.mjs install
node bin/swear-jar.mjs init --local
```

`install` adds the Claude Code hooks. `init` is optional: it finds local
history, builds the first report, and can backfill it. The release repository
must be public before this clone command can work for new users.

Check the jar:

```sh
node bin/swear-jar.mjs status
node bin/swear-jar.mjs dashboard --local
```

## Uninstall

Remove only the Swear Jar hooks; the local ledger remains available:

```sh
node bin/swear-jar.mjs uninstall
```

Delete `~/.swear-jar/` separately only if you also want to remove local counts
and reports.

The full command reference is in [`docs/swear-jar.1`](swear-jar.1).

## Custom words

The launch lexicon is English-only and intentionally excludes racial and
bigoted slurs. Add your own terms locally when you want to track something
specific:

```sh
node bin/swear-jar.mjs custom add "your-term"
node bin/swear-jar.mjs custom list
node bin/swear-jar.mjs custom remove "your-term"
```

Custom terms are counted as **user-specific** and their spellings are never
rendered in reports or sent in aggregate links.
