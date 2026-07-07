"""
Swear Jar — Claude Code capture hook (zero token cost).

Install as a UserPromptSubmit hook and it logs every swear you send an AI agent —
typed OR dictated — to a local file, then exits SILENTLY. Because it writes no
stdout, it adds NOTHING to the model's context and costs zero tokens.

Reuses the exact same audited lexicon as the rest of Swear Jar, so what counts
here is identical to what --audit shows.

Install (per-user, every Claude Code session):
  hooks.UserPromptSubmit -> command: python3 -m swearjar.hook
"""
import sys, os, json, time
from .lexicon import count_swears

LOG = os.environ.get("SWEARJAR_LOG", os.path.expanduser("~/.swearjar/live-events.jsonl"))
DEBOUNCE_S = 2.0   # collapse the identical swear if it repeats within this window


def _recent_key(events_path, word, now):
    """True if this word was already logged within DEBOUNCE_S (dedupe re-submits)."""
    try:
        with open(events_path, "rb") as f:
            f.seek(max(0, os.path.getsize(events_path) - 4096))
            tail = f.read().decode("utf-8", "ignore").splitlines()
    except Exception:
        return False
    for line in reversed(tail[-40:]):
        try:
            e = json.loads(line)
        except Exception:
            continue
        if now - e.get("ts", 0) > DEBOUNCE_S:
            break
        if e.get("word") == word:
            return True
    return False


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0                                   # never break the user's turn
    # Claude Code puts the prompt in "user_input"; Codex uses "prompt". One hook, both.
    text = data.get("user_input") or data.get("prompt") or ""
    source = "claude-code" if data.get("user_input") else ("codex" if data.get("prompt") else "unknown")
    if not text:
        return 0
    total, counts, _ = count_swears(text.lower())
    if not total:
        return 0                                   # silent, zero cost
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    now = round(time.time(), 3)
    with open(LOG, "a", encoding="utf-8") as f:
        for word, n in counts.items():
            if _recent_key(LOG, word, now):
                continue                           # de-dupe an accidental re-submit
            for _ in range(n):
                f.write(json.dumps({"ts": now, "word": word, "source": source,
                                    "session": data.get("session_id", "")}) + "\n")
    return 0                                        # NO stdout -> zero context/tokens


if __name__ == "__main__":
    sys.exit(main())
