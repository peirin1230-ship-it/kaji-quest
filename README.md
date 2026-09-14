# kaji-quest

自分ひとりが家事・育児を続けるための仕組み。仕様は [docs/SPEC.md](docs/SPEC.md)。

## いまのフェーズ: Phase 0 — 手で回す（Week 1-2）

Bot はまだ動かさない。Issue テンプレートだけで運用し、面倒だった点を Phase 1 の自動化に反映する。

### 毎朝

**Issues → New issue** から定期タスクを 4 件起票する（GitHub Mobile でも可）。

| テンプレート | 領域 | core | 見込み → 換算 |
|---|---|---|---|
| 🧽 夜の洗い物リセット | 洗い物 | ★ | 15分 → 18分 |
| 🍳 翌日分の仕込み | 料理 | | 45分 → 68分 |
| 🚿 風呂掃除 | 掃除 | | 10分 → 11分 |
| 🗑 ゴミまとめ・ゴミ出し | 名もなき家事 | ★ | 5分 → 7分 |

妻が作業を始めるタイミングで 🧸 **作業ブロック** を起票する（core、見込み 60分 → 87分）。

### 完了したら（15秒以内）

1. チェックリストにチェックを入れる
2. コメントに `/done 実時間` を書く。例: `/done 18`。気分や気づきも添えるなら `/done 18 mood:4 先に鍋を浸けておくと早い`
3. Issue をクローズする

Phase 0 では `/done` に Bot は反応しない。同じ書式で残しておけば Phase 2 でログを再生成できる。
やらない日は `/pass`（週1回の権利）とコメントし、`status/passed` を付けてクローズする。追撃はしない。

### 2週間後の判定

- 続いたら Phase 1（自動生成とリマインド）へ
- 続かなければテンプレートを 3 件に減らしてもう 2 週間

## ラベル

[`.github/labels.yml`](.github/labels.yml) が定義（SPEC §11.1）。`main` へ push すると [`sync-labels`](.github/workflows/sync-labels.yml) ワークフローが GitHub のラベルへ反映する。手動で流すときは **Actions → sync-labels → Run workflow**。Actions が使えないときは Issues → Labels から手で作る。

## 構成

| パス | 内容 |
|---|---|
| `docs/SPEC.md` | 仕様書 v2.1 |
| `routines/daily.yml` | 定期タスク定義（Phase 1 の生成元。Phase 0 はテンプレートと二重管理） |
| `.github/ISSUE_TEMPLATE/` | 起票テンプレート。`routine-*.yml` は Phase 0 限定 |
| `.github/labels.yml` | ラベル定義 |
