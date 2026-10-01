#!/usr/bin/env python3
"""見出し用の書体を site/fonts/ に取り込む（ページから外部へ通信しないよう同梱する）。

- Zen Maru Gothic 700: 見出しで使う文字だけを切り出した小さなファイル（DISPLAY_TEXT ＋ かな ＋ 英数字）。
  見出しに新しい漢字を足したら DISPLAY_TEXT に足してこのスクリプトを実行し直す。無い文字は端末の書体で出る。
- Outfit（可変 400〜800、ラテン文字）: 数字と英字の見出し用。
- どちらも SIL Open Font License 1.1（許諾文は site/fonts/OFL-*.txt）。

使い方: python3 scripts/fetch_fonts.py   （curl でフォントを取得する。ネットワークが要る）
"""
import os
import re
import subprocess
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "fonts")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

DISPLAY_TEXT = (
    # 見出し・あいさつ・時間帯
    "今日のタスク掃除メニュー今日のコツ掃除の教科書後から記録補充買い物メモ今週その週実績今日の記録検索朝昼夜"
    "おはようこんにちはおつかれさまのページ月日曜火水木金土次の一手"
    # 称号（config.yml の titles）
    "駆け出し見習い家事人一人前熟練手練れ達人師範家事の匠名人暮らしの賢者家の守り神家事の英雄伝説神話家事神"
    # 段・領域・分類・演出
    "初銅銀金白金紅蒼翠紫虹洗い物料理洗濯名もなき家事継続目標記録学び引き算全部称号段領域のレベルあと少し最近の獲得"
    "称号アップ設定詳細所要時間帯気分気づき削除トロフィールーム全種今週の進み残り件分換算見込み"
)
KANA = "".join(chr(c) for c in range(0x3041, 0x3097)) + "".join(chr(c) for c in range(0x30A1, 0x30FB)) + "ー・々〜「」『』（）、。！？：／％＋－＝"
ASCII = "".join(chr(c) for c in range(0x20, 0x7F))


def curl(url, binary=False):
    out = subprocess.run(["curl", "-sS", "--fail", "--max-time", "60", "-A", UA, url], capture_output=True, check=True)
    return out.stdout if binary else out.stdout.decode()


def main():
    os.makedirs(OUT, exist_ok=True)
    chars = "".join(sorted(set(DISPLAY_TEXT + KANA + ASCII)))
    css = curl("https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@700&display=swap&text=" + urllib.parse.quote(chars))
    urls = re.findall(r"src: url\(([^)]+)\) format\('woff2'\)", css)
    if len(urls) != 1:
        raise SystemExit(f"Zen Maru Gothic の woff2 が 1 つでない: {len(urls)}")
    with open(os.path.join(OUT, "zen-maru-700.woff2"), "wb") as f:
        f.write(curl(urls[0], binary=True))
    css = curl("https://fonts.googleapis.com/css2?family=Outfit:wght@400..800&display=swap")
    latin = re.search(r"/\* latin \*/.*?src: url\(([^)]+)\)", css, re.S)
    if not latin:
        raise SystemExit("Outfit の latin が見つからない")
    with open(os.path.join(OUT, "outfit.woff2"), "wb") as f:
        f.write(curl(latin.group(1), binary=True))
    # どちらも SIL Open Font License 1.1。フォントと一緒に許諾文を置く
    for name, url in (("OFL-ZenMaruGothic.txt", "https://raw.githubusercontent.com/googlefonts/zen-marugothic/main/OFL.txt"),
                      ("OFL-Outfit.txt", "https://raw.githubusercontent.com/Outfitio/Outfit-Fonts/main/OFL.txt")):
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            f.write(curl(url))
    for name in ("zen-maru-700.woff2", "outfit.woff2"):
        print(name, os.path.getsize(os.path.join(OUT, name)), "bytes")
    print("display chars:", len(chars))


if __name__ == "__main__":
    main()
