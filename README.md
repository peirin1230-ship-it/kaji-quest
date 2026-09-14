# kaji-quest

自分ひとりが家事・育児を続けるための道具。仕様は [docs/SPEC.md](docs/SPEC.md)。
運用は GitHub Pages のページ 1 枚で行う。Issue は使わない。

**ページ**: https://peirin1230-ship-it.github.io/kaji-quest/

## 使い方

1. ページを開く。スマホなら「ホーム画面に追加」しておくとアプリのように開ける
2. 初回だけ ⚙ から GitHub トークンを保存する（下記）
3. 今日のタスクが並ぶ。やったら **完了** を 1 タップ。所要時間は見込みが自動で入る。変えたいときだけ「詳細」
4. 作業ブロック（子ども担当）と名もなき家事は **後から記録**。終わってから時間チップを 1 タップ。世話中にスマホは見ない
5. やらない日は **今日はパス**（週 1 回）。追撃も減点もない。ストリークも切れない

記録は `logs/YYYY/MM.jsonl` に 1 行ずつコミットされる。集計（今週の換算時間、目標、ストリーク）はページを開くたびにログから計算する。

## トークン（初回 1 回）

[Fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) を作る。

- Repository access: **Only select repositories → kaji-quest**
- Permissions → Repository permissions: **Contents → Read and write**
- Expiration: 好きな長さ。切れたら作り直して ⚙ に貼り直す

発行した `github_pat_…` をページの ⚙ に貼って保存する。トークンはそのスマホのブラウザにだけ残り、GitHub API 以外には送られない。

## 初回セットアップ（Pages）

`main` に push すると `build-pages` ワークフローが `site/` を配信する。Pages が有効になっていなければ、
**Settings → Pages → Build and deployment → Source を「GitHub Actions」** にしてから、Actions → build-pages → Run workflow を 1 回実行する。

## 変えたいとき

| したいこと | 場所 |
|---|---|
| タスクを足す・減らす・見込みや負荷 W を変える | `routines/daily.yml`（push すると自動で反映） |
| 週の目標、段階的引き上げ、パス回数 | `config.yml` |
| 記録に時刻を残さない | `config.yml` の `privacy.log_time: false` |
| 見た目や動き | `site/`（`app.js` / `style.css`） |

ローカルで確認するなら `python3 scripts/build_site.py _site` のあと `_site/` を静的サーバで開く。

## 公開リポジトリでの注意

子の名前・生年月日・写真・住所は書かない。ログには日付・時刻、タスク名、所要時間、任意の気分と気づきだけが残る。
ラベル定義（`.github/labels.yml`）と Issue テンプレート（ナレッジ用）は残してあるが、日々の運用には使わない。
