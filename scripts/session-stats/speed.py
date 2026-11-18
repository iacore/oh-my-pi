#!/usr/bin/env python3
"""
Decode speed (tok/s) and latency per provider/model over the local session corpus
(`~/.omp/agent/sessions/**/*.jsonl`).

Reads the assistant messages the harness already records — each carries `duration`
(ms), `ttft` (ms), `usage.output` and `usage.reasoningTokens` — so no re-streaming
and no sqlite sync is needed. Read-only; nothing is written.

Metric:

    tok/s = usage.output / ((duration - ttft) / 1000)

`usage.output` includes reasoning tokens, and `duration - ttft` is the wall time
spent generating them, so the two line up.

Turns are dropped, and counted separately, when they cannot carry a decode rate:

  - `duration <= ttft` or a decode window under `--min-decode-ms` (default 250):
    the response arrived in one chunk, so `ttft` is the whole duration and the
    ratio would be a garbage six-digit number. ~7% of the corpus is like this.
  - zero output tokens.


Identical records appear more than once when a session was branched or copied into
a second `.jsonl`; dedupe is by entry id, keeping the first sighting.

Run:
  python3 scripts/session-stats/speed.py
  python3 scripts/session-stats/speed.py --since 7d --by day
  python3 scripts/session-stats/speed.py --model deepseek --json /tmp/speed.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

SESSIONS_ROOT = Path.home() / ".omp" / "agent" / "sessions"


# --------------------------------------------------------------------------- #
# Input


@dataclass
class Call:
    provider: str
    model: str
    tps: float
    ttft_ms: float
    duration_ms: float
    output: int
    input: int
    cache_read: int
    cost: float
    ts: float  # epoch seconds
    session: str = ""


@dataclass
class Scan:
    calls: list[Call] = field(default_factory=list)
    files: int = 0
    records: int = 0
    duplicates: int = 0
    no_timing: int = 0
    no_output: int = 0
    degenerate: int = 0
    bad_lines: int = 0


def parse_since(raw: str | None) -> float | None:
    """`7d`, `12h`, `90m`, `3w`, or an ISO date (`2026-10-01`)."""
    if not raw:
        return None
    now = time.time()
    unit = raw[-1]
    if unit in "smhdw" and raw[:-1].isdigit():
        mult = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}[unit]
        return now - int(raw[:-1]) * mult
    try:
        return datetime.fromisoformat(raw).replace(tzinfo=timezone.utc).timestamp()
    except ValueError:
        sys.exit(f"--since: expected 12h / 7d / 2w or an ISO date, got {raw!r}")


def scan(root: Path, since: float | None, model_filter: str | None, min_decode_ms: float = 250.0) -> Scan:
    out = Scan()
    seen: set[str] = set()
    files = sorted(root.rglob("*.jsonl"))
    out.files = len(files)

    for path in files:
        try:
            fh = open(path, "r", errors="replace")
        except OSError:
            continue
        session = path.stem
        with fh:
            for line in fh:
                if '"assistant"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    out.bad_lines += 1
                    continue
                msg = entry.get("message") or {}
                if entry.get("type") != "message" or msg.get("role") != "assistant":
                    continue
                out.records += 1

                eid = entry.get("id")
                if eid:
                    if eid in seen:
                        out.duplicates += 1
                        continue
                    seen.add(eid)

                usage = msg.get("usage") or {}
                output = int(usage.get("output") or 0)
                duration = msg.get("duration")
                ttft = msg.get("ttft")
                ts_ms = msg.get("timestamp") or 0
                ts = ts_ms / 1000 if ts_ms else 0.0
                if since is not None and ts and ts < since:
                    continue
                if duration is None:
                    out.no_timing += 1
                    continue
                if output <= 0:
                    out.no_output += 1
                    continue
                if ttft is None:
                    ttft = 0.0
                decode_ms = float(duration) - float(ttft)
                if decode_ms < min_decode_ms:
                    out.degenerate += 1
                    continue

                model = msg.get("model") or "?"
                if model_filter and model_filter.lower() not in model.lower():
                    continue
                out.calls.append(
                    Call(
                        provider=msg.get("provider") or "?",
                        model=model,
                        tps=output / (decode_ms / 1000),
                        ttft_ms=float(ttft),
                        duration_ms=float(duration),
                        output=output,
                        input=int(usage.get("input") or 0),
                        cache_read=int(usage.get("cacheRead") or 0),
                        cost=float((usage.get("cost") or {}).get("total") or 0.0),
                        ts=ts,
                        session=session,
                    )
                )
    return out


# --------------------------------------------------------------------------- #
# Stats


def pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pos = (len(ordered) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def summarize(calls: list[Call]) -> dict:
    tps = [c.tps for c in calls]
    return {
        "calls": len(calls),
        "tps_p10": pct(tps, 0.10),
        "tps_p50": pct(tps, 0.50),
        "tps_p90": pct(tps, 0.90),
        "tps_mean": statistics.fmean(tps) if tps else 0.0,
        "ttft_p50": pct([c.ttft_ms for c in calls], 0.50) / 1000,
        "ttft_p90": pct([c.ttft_ms for c in calls], 0.90) / 1000,
        "output_p50": pct([float(c.output) for c in calls], 0.50),
        "input_p50": pct([float(c.input + c.cache_read) for c in calls], 0.50),
        "cost": sum(c.cost for c in calls),
        "tokens_out": sum(c.output for c in calls),
        "first": min((c.ts for c in calls), default=0.0),
        "last": max((c.ts for c in calls), default=0.0),
    }


def bucket_key(ts: float, by: str) -> str:
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    if by == "day":
        return dt.strftime("%Y-%m-%d")
    iso = dt.isocalendar()
    monday = dt.fromordinal(dt.toordinal() - dt.weekday())
    return f"{iso.year}-W{iso.week:02d} ({monday.strftime('%m-%d')})"


# --------------------------------------------------------------------------- #
# Output


def fmt_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d") if ts else "-"


def table(headers: list[str], rows: list[list[str]], align: str | None = None) -> str:
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    spec = align or "".join("l" if i < 2 else "r" for i in range(len(headers)))
    out = ["  ".join(h.ljust(w) if a == "l" else h.rjust(w) for h, w, a in zip(headers, widths, spec))]
    out.append("  ".join("-" * w for w in widths))
    for row in rows:
        out.append("  ".join(c.ljust(w) if a == "l" else c.rjust(w) for c, w, a in zip(row, widths, spec)))
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sessions", type=Path, default=SESSIONS_ROOT, help="session corpus root")
    ap.add_argument("--since", default=None, help="12h / 7d / 2w / ISO date; default: all sessions")
    ap.add_argument("--model", default=None, help="only models whose id contains this substring")
    ap.add_argument("--by", choices=["week", "day"], default="week", help="trend bucket width")
    ap.add_argument("--min-decode-ms", type=float, default=250.0,
                    help="drop turns whose decode window is shorter than this (default 250)")
    ap.add_argument("--no-trend", action="store_true", help="skip the per-bucket trend table")
    ap.add_argument("--top", type=int, default=25, help="max rows in the trend table")
    ap.add_argument("--json", type=Path, default=None, help="write machine-readable results here")
    args = ap.parse_args()

    if not args.sessions.exists():
        sys.exit(f"sessions root not found: {args.sessions}")

    started = time.time()
    scan_result = scan(args.sessions, parse_since(args.since), args.model, args.min_decode_ms)
    calls = scan_result.calls
    if not calls:
        sys.exit("no timed assistant turns matched")

    groups: dict[tuple[str, str], list[Call]] = defaultdict(list)
    for c in calls:
        groups[(c.provider, c.model)].append(c)

    summaries = {f"{p}/{m}": summarize(v) for (p, m), v in groups.items()}

    span = (fmt_ts(min(c.ts for c in calls)), fmt_ts(max(c.ts for c in calls)))
    print(f"corpus: {scan_result.files} session files, {scan_result.records} assistant turns, "
          f"{len(calls)} timed calls ({span[0]} → {span[1]})")
    dropped = (
        f"dropped: {scan_result.duplicates} duplicate copies, {scan_result.no_timing} without timing, "
        f"{scan_result.degenerate} under the decode-window floor"
        + (f", {scan_result.no_output} with zero output" if scan_result.no_output else "")
        + (f", {scan_result.bad_lines} unparsable lines" if scan_result.bad_lines else "")
    )
    print(dropped)
    print("tok/s = output tokens / (duration - ttft); medians are over calls, not sessions\n")

    rows = []
    for name, s in sorted(summaries.items(), key=lambda kv: -kv[1]["calls"]):
        rows.append([
            name,
            f"{s['calls']}",
            f"{s['tps_p10']:.0f}",
            f"{s['tps_p50']:.0f}",
            f"{s['tps_p90']:.0f}",
            f"{s['ttft_p50']:.2f}",
            f"{s['output_p50']:.0f}",
            f"{s['input_p50']:.0f}",
            f"${s['cost']:.2f}",
            fmt_ts(s["first"]),
            fmt_ts(s["last"]),
        ])
    print("=== per provider/model ===")
    print(table(
        ["model", "calls", "p10", "p50", "p90", "ttft p50 s", "out p50", "ctx p50", "cost", "first", "last"],
        rows,
        align="lrrrrrrrrll",
    ))

    if not args.no_trend:
        buckets: dict[str, dict[str, list[Call]]] = defaultdict(lambda: defaultdict(list))
        for c in calls:
            buckets[bucket_key(c.ts, args.by)][f"{c.provider}/{c.model}"].append(c)
        keys = sorted(buckets)[-args.top:]
        names = [n for n, s in sorted(summaries.items(), key=lambda kv: -kv[1]["calls"])][:8]
        header = [args.by] + [n.split("/", 1)[-1] for n in names]
        trend_rows = []
        for key in keys:
            row = [key]
            for name in names:
                cs = buckets[key].get(name)
                if not cs:
                    row.append("-")
                else:
                    row.append(f"{pct([c.tps for c in cs], 0.50):.0f} ({len(cs)})")
            trend_rows.append(row)
        print(f"\n=== median tok/s per {args.by} (calls in parens) ===")
        print(table(header, trend_rows))

    if args.json:
        payload = {
            "generated": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
            "corpus": {
                "files": scan_result.files,
                "assistant_turns": scan_result.records,
                "timed_calls": len(calls),
                "duplicates": scan_result.duplicates,
                "no_timing": scan_result.no_timing,
                "degenerate": scan_result.degenerate,
                "min_decode_ms": args.min_decode_ms,
                "no_output": scan_result.no_output,
            },
            "models": summaries,
        }
        args.json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        print(f"\nwrote {args.json}")

    print(f"\nscanned in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
