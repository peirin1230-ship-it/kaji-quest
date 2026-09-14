#!/usr/bin/env python3
"""site/ をそのままコピーし、routines/*.yml と config.yml を JSON 化して data/ に置く。

使い方: python3 scripts/build_site.py [出力先=_site]
GitHub Actions（.github/workflows/build-pages.yml）が実行し、出力先を GitHub Pages へ配信する。
YAML が壊れていればここで失敗して配信されない。
"""
import glob
import json
import os
import shutil
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOAD_RANGES = {"physical": {1, 2, 3}, "mental": {1, 2, 3}, "time_bound": {0, 1, 2}}
SCHEDULE_TYPES = {"cron", "daily", "weekly", "monthly", "seasonal", "manual"}
REQUIRED = ("id", "title", "area", "schedule", "est_minutes", "load")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def load_routines():
    routines, seen = [], set()
    for path in sorted(glob.glob(os.path.join(ROOT, "routines", "*.yml"))):
        with open(path, encoding="utf-8") as f:
            items = yaml.safe_load(f) or []
        if not isinstance(items, list):
            fail(f"{path}: トップレベルはリストにする")
        for r in items:
            rid = r.get("id", "?") if isinstance(r, dict) else "?"
            for key in REQUIRED:
                if not isinstance(r, dict) or key not in r:
                    fail(f"{path}: {rid} に {key} がない")
            if rid in seen:
                fail(f"{path}: id が重複 {rid}")
            seen.add(rid)
            if (r["schedule"] or {}).get("type") not in SCHEDULE_TYPES:
                fail(f"{rid}: schedule.type は {sorted(SCHEDULE_TYPES)} のどれか")
            for key, allowed in LOAD_RANGES.items():
                if (r["load"] or {}).get(key) not in allowed:
                    fail(f"{rid}: load.{key} は {sorted(allowed)} のどれか")
            if not isinstance(r["est_minutes"], (int, float)) or r["est_minutes"] <= 0:
                fail(f"{rid}: est_minutes は正の数")
            routines.append(r)
    return routines


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "_site")
    routines = load_routines()
    with open(os.path.join(ROOT, "config.yml"), encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}
    for key in ("owner", "name"):
        if not (config.get("repo") or {}).get(key):
            fail(f"config.yml: repo.{key} がない")

    if os.path.isdir(out):
        shutil.rmtree(out)
    shutil.copytree(os.path.join(ROOT, "site"), out)
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    for name, data in (("routines.json", routines), ("config.json", config)):
        with open(os.path.join(out, "data", name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1, default=str)
            f.write("\n")
    print(f"built {out}: {len(routines)} routines")


if __name__ == "__main__":
    main()
