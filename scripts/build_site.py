#!/usr/bin/env python3
"""site/ をそのままコピーし、routines/*.yml と config.yml を JSON 化して data/ に置く。

使い方: python3 scripts/build_site.py [出力先=_site]
GitHub Actions（.github/workflows/build-pages.yml）が実行し、出力先を GitHub Pages へ配信する。
YAML が壊れていればここで失敗して配信されない。
"""
import glob
import json
import os
import re
import shutil
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONT_MATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.S)
LOAD_RANGES = {"physical": {1, 2, 3}, "mental": {1, 2, 3}, "time_bound": {0, 1, 2}}
SCHEDULE_TYPES = {"cron", "daily", "weekly", "monthly", "seasonal", "manual", "interval"}
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
            schedule = r["schedule"] or {}
            if schedule.get("type") not in SCHEDULE_TYPES:
                fail(f"{rid}: schedule.type は {sorted(SCHEDULE_TYPES)} のどれか")
            if schedule.get("type") == "interval" and not (isinstance(schedule.get("days"), int) and schedule["days"] > 0):
                fail(f"{rid}: interval には正の整数の days が要る")
            for key, allowed in LOAD_RANGES.items():
                if (r["load"] or {}).get(key) not in allowed:
                    fail(f"{rid}: load.{key} は {sorted(allowed)} のどれか")
            if not isinstance(r["est_minutes"], (int, float)) or r["est_minutes"] <= 0:
                fail(f"{rid}: est_minutes は正の数")
            routines.append(r)
    return routines


def load_knowledge():
    """knowledge/**/*.md（docs/SPEC.md §9.1 の front matter 付き Markdown）を読む。_ 始まりは無視。"""
    tips, seen = [], set()
    for path in sorted(glob.glob(os.path.join(ROOT, "knowledge", "**", "*.md"), recursive=True)):
        rel = os.path.relpath(path, os.path.join(ROOT, "knowledge"))
        if os.path.basename(path).startswith("_") or rel.split(os.sep)[0] in ("reference", "basics"):
            continue   # reference/ は原文の資料、basics/ はやさしい版の教科書（別扱い）
        with open(path, encoding="utf-8") as f:
            m = FRONT_MATTER.match(f.read())
        if not m:
            fail(f"{path}: 先頭に --- で囲んだ front matter が要る")
        meta = yaml.safe_load(m.group(1)) or {}
        for key in ("id", "title", "area"):
            if key not in meta:
                fail(f"{path}: {key} がない")
        if meta["id"] in seen:
            fail(f"{path}: id が重複 {meta['id']}")
        seen.add(meta["id"])
        meta["body"] = m.group(2).strip()
        tips.append(meta)
    return tips


def load_basics():
    """knowledge/basics/*.md（やさしい版の教科書）を章ごとに HTML 化する。source: は knowledge/reference/ の原文ファイル名。"""
    import html as htmlmod
    try:
        import markdown
    except ImportError:
        fail("python-markdown が要る: pip install markdown")
    chapters = []
    for path in sorted(glob.glob(os.path.join(ROOT, "knowledge", "basics", "*.md"))):
        with open(path, encoding="utf-8") as f:
            m = FRONT_MATTER.match(f.read())
        if not m:
            fail(f"{path}: 先頭に --- で囲んだ front matter が要る")
        meta = yaml.safe_load(m.group(1)) or {}
        for key in ("id", "title"):
            if key not in meta:
                fail(f"{path}: {key} がない")
        body = m.group(2).strip()
        rendered = markdown.markdown(body, extensions=["tables"], output_format="html")
        text = re.sub(r"<[^>]+>", " ", rendered)
        text = re.sub(r"\s+", " ", htmlmod.unescape(text)).strip()
        src = meta.get("source")
        if src and not os.path.exists(os.path.join(ROOT, "knowledge", "reference", src)):
            fail(f"{path}: source の原文 {src} が knowledge/reference に無い")
        chapters.append({
            "id": meta["id"], "title": meta["title"], "order": meta.get("order", 999),
            "summary": meta.get("summary", ""), "source": src, "html": rendered, "text": text,
        })
    chapters.sort(key=lambda c: (c["order"], c["id"]))
    return chapters


BADGE_TYPES = {"count", "streak", "weighted_total", "target_hit", "level", "first", "combo", "custom"}
CUSTOM_KEYS = {"fast", "long", "both_slots", "trio", "day_entries", "morning_entries", "weekend_days", "early",
               "core_streak", "resume", "all_places", "everyday_weeks", "tip_stage", "best_week", "ramp_top"}


def load_badges(routines):
    """docs/badges.md の ```yaml ブロックをバッジ定義として読む（docs/SPEC.md §7.2）。"""
    path = os.path.join(ROOT, "docs", "badges.md")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        m = re.search(r"```yaml\n(.*?)\n```", f.read(), re.S)
    if not m:
        fail("docs/badges.md に ```yaml ブロックが無い")
    badges = yaml.safe_load(m.group(1)) or []
    ids, rids = set(), {r["id"] for r in routines}
    for b in badges:
        for key in ("id", "name", "icon", "cat", "condition"):
            if key not in b:
                fail(f"badges: {b.get('id', '?')} に {key} がない")
        if b["id"] in ids:
            fail(f"badges: id が重複 {b['id']}")
        ids.add(b["id"])
        c = b["condition"]
        if c.get("type") not in BADGE_TYPES:
            fail(f"badges: {b['id']} の type は {sorted(BADGE_TYPES)} のどれか")
        if c.get("type") == "custom" and c.get("key") not in CUSTOM_KEYS:
            fail(f"badges: {b['id']} の custom key {c.get('key')} は未対応")
        for tid in ([c["task"]] if c.get("task") else []) + list(c.get("tasks") or []):
            if tid not in rids:
                fail(f"badges: {b['id']} が無いタスク {tid} を参照")
    for b in badges:
        for other in b["condition"].get("all_of") or []:
            if other not in ids:
                fail(f"badges: {b['id']} の all_of に無い id {other}")
    return badges


def link_tips(routines, tips):
    """コツの tasks: をルーチンの tips: に合流させ、参照先が存在するか確かめる。"""
    by_id = {r["id"]: r for r in routines}
    tip_ids = {t["id"] for t in tips}
    for t in tips:
        for rid in t.get("tasks") or []:
            if rid not in by_id:
                fail(f"{t['id']}: tasks に無い id {rid}")
            lst = by_id[rid].get("tips") or []
            if t["id"] not in lst:
                lst.append(t["id"])
            by_id[rid]["tips"] = lst
    for r in routines:
        for tid in r.get("tips") or []:
            if tid not in tip_ids:
                fail(f"{r['id']}: tips に無い id {tid}")


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "_site")
    routines = load_routines()
    tips = load_knowledge()
    basics = load_basics()
    badges = load_badges(routines)
    link_tips(routines, tips)
    with open(os.path.join(ROOT, "config.yml"), encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}
    for key in ("owner", "name"):
        if not (config.get("repo") or {}).get(key):
            fail(f"config.yml: repo.{key} がない")

    if os.path.isdir(out):
        shutil.rmtree(out)
    shutil.copytree(os.path.join(ROOT, "site"), out)
    open(os.path.join(out, ".nojekyll"), "w").close()   # Pages 側の Jekyll 処理を止め、ファイルをそのまま配信する
    os.makedirs(os.path.join(out, "data"), exist_ok=True)
    for name, data in (("routines.json", routines), ("config.json", config), ("knowledge.json", tips), ("basics.json", basics), ("badges.json", badges)):
        with open(os.path.join(out, "data", name), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1, default=str)
            f.write("\n")
    print(f"built {out}: {len(routines)} routines, {len(tips)} tips, {len(basics)} chapters, {len(badges)} badges")


if __name__ == "__main__":
    main()
