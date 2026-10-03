# バッジ一覧

docs/SPEC.md §7 のバッジ体系を、いまのページ（Issue を使わない運用）に合わせて定義したもの。
ページは記録（logs/）からバッジを毎回計算する。一度取ったバッジは、記録が残るかぎり残る（剥奪しない）。
足すのは簡単で、減らさないのが運用方針。無理をしないと取れない条件（深夜・連続◯時間など）は作らない。

- `condition.type`: `count`（回数。task / tasks / area / kind / status / learned / practiced / mood / backfill で絞る。task に書いた id の手順（steps）の記録も回数に入る）、
  `streak`（連続日数）、`weighted_total`（累計換算分。area で絞れる）、`target_hit`（週次目標の達成。gte / consecutive / ratio_gte）、
  `level`（領域レベル。area / any / all / areas_gte）、`first`（初回）、`combo`（all_of のバッジを全部持つ）、`custom`（key で決まる特別判定）
- `custom` の key: `record_days`（記録した日の通算）、`since_first`（最初の記録から n 日後にも記録）、`full_months`（暦の 1 か月を毎日）、
  `seasons`（春夏秋冬）、`dow_cover`（曜日ごとに n 日以上）、`tasks_day`（tasks を同じ日にそろえた日数）、
  `distinct`（of: menu / refill の種類数。place で場所を絞る。all: true は削除していない全種類）、`menu_count`（min_days 以上の大物の回数）、
  `day_weighted`（換算 n 分以上の日数）、`light_days`（換算 n 分以下でも記録した日数。前日までで数える）、`all_slots_days`（朝昼夜そろった日数）、
  `slot_total`（slot の記録数）、`tips_distinct`（実践したコツの種類）、`tip_stage`（stage 段階以上のコツの数。省略は最終段階）、
  `fast_total`（見込みの半分以下で終えた回数）、`on_date`（md の日付や zorome の日に記録）、`year_end`（12/25〜31 の掃除メニュー）、
  `shop`（買い物。of: `items` 買った点数 / `days` 買い物をした日数 / `distinct` 買った物の種類 / `same` 同じ物を買った回数の最多 /
  `bulk` n 点以上買った日数 / `weeks` 買い物をした週が続いた最長 / `refill` 補充の項目の物を買った点数 /
  `pairs` 補充とその物の買い物が 14 日以内に並んだ回数（買ってから補充でも、補充してから買い足しでも） / `clean` メモを全部買いきって記録した回数）、
  ほか `fast` / `long` / `both_slots` / `trio` / `day_entries` / `morning_entries` / `weekend_days` / `early` / `core_streak` / `resume` /
  `all_places` / `everyday_weeks` / `best_week` / `ramp_top` / `step_entries` / `steps_complete`
- `tier`: bronze / silver / gold / platinum / secret（xp_bonus を省略すると tier で決まる: 10 / 30 / 100 / 300 / 50）
- `secret: true` は獲得するまで名前と条件を「???」で隠す
- 削除したタスク（prefs.json）だけが条件のバッジは、取っていなければ一覧と総数から外す（タスクを戻すと出てくる）
- 説明文（desc）に半角のカンマを書かない（yaml の区切りになって切れる）。数字は 3000 のように書く
- レベルは領域ごとに `Lv = floor(sqrt(累計XP / 100))`。称号は獲得バッジ数で決まる（config.yml の titles。all: true は出ているバッジを全部）
- 買い物: 買い物メモで「買った」にした物は、「買い物を記録」で logs に 1 行（`mode: shop`、`items` に買った物）として入る。
  名もなき家事の記録として数え、1 点 3 XP。換算時間（週の目標）には入れない。補充の項目との対応は routines/refill.yml の buy: と match:

```yaml
# ---- A. 継続 ----
- { id: first-step, name: はじめの一歩, icon: 🌱, tier: bronze, cat: 継続, desc: 初めて記録する, condition: { type: count, gte: 1 } }
- { id: streak-003, name: 三日坊主、克服, icon: 🔥, tier: bronze, cat: 継続, desc: 3 日続ける, condition: { type: streak, gte: 3 } }
- { id: streak-007, name: 一週間戦士, icon: 🔥, tier: bronze, cat: 継続, desc: 7 日続ける, condition: { type: streak, gte: 7 } }
- { id: streak-014, name: 半月の意地, icon: 🔥, tier: silver, cat: 継続, desc: 14 日続ける, condition: { type: streak, gte: 14 } }
- { id: streak-030, name: 一ヶ月の守護者, icon: 🔥, tier: gold, cat: 継続, desc: 30 日続ける, condition: { type: streak, gte: 30 } }
- { id: streak-060, name: 還らざる60日, icon: 🔥, tier: gold, cat: 継続, desc: 60 日続ける, condition: { type: streak, gte: 60 } }
- { id: streak-100, name: 百日行, icon: 💯, tier: platinum, cat: 継続, desc: 100 日続ける, condition: { type: streak, gte: 100 } }
- { id: streak-180, name: 半年の人, icon: 🌗, tier: platinum, cat: 継続, desc: 180 日続ける, condition: { type: streak, gte: 180 } }
- { id: streak-365, name: 一年、立っていた, icon: 👑, tier: platinum, cat: 継続, desc: 365 日続ける, condition: { type: streak, gte: 365 } }
- { id: pass-first, name: 潔い休息, icon: 🕊, tier: bronze, cat: 継続, desc: 初めてパスを使う, condition: { type: count, status: passed, gte: 1 } }
- { id: phoenix, name: 不死鳥, icon: ♻️, tier: silver, cat: 継続, desc: 途切れた翌日に再開する（3 回）, condition: { type: custom, key: resume, gte: 3 } }
- { id: core-month, name: 皆勤の月, icon: 🗓, tier: gold, cat: 継続, desc: core のタスクを 30 日続けて落とさない, condition: { type: custom, key: core_streak, gte: 30 } }
- { id: everyday-4w, name: 皆勤の記録者, icon: 📊, tier: silver, cat: 継続, desc: 4 週続けて毎日記録する, condition: { type: custom, key: everyday_weeks, gte: 4 } }
- { id: streak-021, name: 三週間の灯, icon: 🕯, tier: silver, cat: 継続, desc: 21 日続ける, condition: { type: streak, gte: 21 } }
- { id: streak-045, name: 四十五日の歩み, icon: 👣, tier: gold, cat: 継続, desc: 45 日続ける, condition: { type: streak, gte: 45 } }
- { id: streak-075, name: 人の噂も七十五日, icon: 🍃, tier: gold, cat: 継続, desc: 75 日続ける, condition: { type: streak, gte: 75 } }
- { id: days-010, name: 通算十日, icon: 📅, tier: bronze, cat: 継続, desc: 記録した日が通算 10 日（途切れてもよい）, condition: { type: custom, key: record_days, gte: 10 } }
- { id: days-030, name: 通算三十日, icon: 📅, tier: bronze, cat: 継続, desc: 記録した日が通算 30 日, condition: { type: custom, key: record_days, gte: 30 } }
- { id: days-100, name: 通算百日, icon: 📅, tier: silver, cat: 継続, desc: 記録した日が通算 100 日, condition: { type: custom, key: record_days, gte: 100 } }
- { id: since-365, name: 一周年, icon: 🎂, tier: gold, cat: 継続, desc: 最初の記録から 1 年たっても記録している, condition: { type: custom, key: since_first, n: 365 } }
- { id: full-month, name: 暦を埋める, icon: 📆, tier: silver, cat: 継続, desc: 暦の 1 か月を 1 日も欠かさず記録（パスも可）, condition: { type: custom, key: full_months, gte: 1 } }
- { id: seasons, name: 四季をめぐる, icon: 🍁, tier: gold, cat: 継続, desc: 春・夏・秋・冬のすべてで記録する, condition: { type: custom, key: seasons, gte: 4 } }
- { id: phoenix-first, name: 再起, icon: 🐣, tier: bronze, cat: 継続, desc: 途切れた翌日に再開する, condition: { type: custom, key: resume, gte: 1 } }
- { id: dow-all, name: 七曜, icon: 🌈, tier: bronze, cat: 継続, desc: 月曜から日曜まで、すべての曜日に記録する, condition: { type: custom, key: dow_cover, n: 1 } }

# ---- B. 洗い物 ----
- { id: dishes-first, name: 初洗い, icon: 🧽, tier: bronze, cat: 洗い物, desc: 洗い物を初めて記録, condition: { type: first, task: dishes } }
- { id: dishes-010, name: シンクの番人, icon: 🧽, tier: bronze, cat: 洗い物, desc: 洗い物 10 回, condition: { type: count, task: dishes, gte: 10 } }
- { id: dishes-025, name: 泡の住人, icon: 🧽, tier: silver, cat: 洗い物, desc: 洗い物 25 回, condition: { type: count, task: dishes, gte: 25 } }
- { id: dishes-050, name: 皿の守護者, icon: 🍽, tier: silver, cat: 洗い物, desc: 洗い物 50 回, condition: { type: count, task: dishes, gte: 50 } }
- { id: dishes-100, name: 食器戸棚の主, icon: 🍽, tier: gold, cat: 洗い物, desc: 洗い物 100 回, condition: { type: count, task: dishes, gte: 100 } }
- { id: dishes-250, name: 二百五十皿, icon: 🏆, tier: gold, cat: 洗い物, desc: 洗い物 250 回, condition: { type: count, task: dishes, gte: 250 } }
- { id: dishes-500, name: シンク帝国, icon: 👑, tier: platinum, cat: 洗い物, desc: 洗い物 500 回, condition: { type: count, task: dishes, gte: 500 } }
- { id: drain-master, name: 排水口の支配者, icon: 🌀, tier: silver, cat: 洗い物, desc: 排水口の掃除 10 回, condition: { type: count, tasks: [bath-drain-parts, drains-other, washbasin-drain-hair, kitchen-drain-pipe], gte: 10 } }
- { id: lightning, name: 電光石火, icon: ⚡️, tier: bronze, cat: 洗い物, desc: 見込みの半分以下の時間で洗い物を終える, condition: { type: custom, key: fast, task: dishes, gte: 1 } }
- { id: dish-mountain, name: 皿の山を前にして, icon: 🏔, tier: bronze, cat: 洗い物, desc: 30 分以上かかる洗い物をやり切る, condition: { type: custom, key: long, task: dishes, gte: 1 } }
- { id: mirror-sink, name: 鏡のシンク, icon: ✨, tier: silver, cat: 洗い物, desc: シンクの水垢磨き 20 回, condition: { type: count, task: sink-polish, gte: 20 } }
- { id: both-ends, name: 朝も夜も, icon: 🌗, tier: silver, cat: 洗い物, desc: 洗い物を朝と夜の両方で記録した日が 10 日, condition: { type: custom, key: both_slots, task: dishes, gte: 10 } }
- { id: both-ends-030, name: 朝も夜も、ひと月, icon: 🌗, tier: gold, cat: 洗い物, desc: 洗い物を朝と夜の両方で記録した日が 30 日, condition: { type: custom, key: both_slots, task: dishes, gte: 30 } }
- { id: lightning-010, name: 手際の人, icon: ⚡️, tier: silver, cat: 洗い物, desc: 見込みの半分以下の時間で洗い物を終える（10 回）, condition: { type: custom, key: fast, task: dishes, gte: 10 } }
- { id: dishes-lv2, name: 洗い場の新星, icon: 🌟, tier: bronze, cat: 洗い物, desc: 洗い物 Lv2, condition: { type: level, area: dishes, gte: 2 } }
- { id: dishes-lv3, name: 洗い場の職人, icon: 🧽, tier: silver, cat: 洗い物, desc: 洗い物 Lv3, condition: { type: level, area: dishes, gte: 3 } }
- { id: sink-first, name: 水垢に挑む, icon: 💧, tier: bronze, cat: 洗い物, desc: シンクの水垢磨きを初めてやり切る, condition: { type: first, task: sink-polish } }

# ---- C. 料理 ----
- { id: cook-first, name: 初仕込み, icon: 🍳, tier: bronze, cat: 料理, desc: 翌日分の仕込みを初めて記録, condition: { type: first, task: cooking-prep } }
- { id: prep-010, name: 仕込み見習い, icon: 🍳, tier: bronze, cat: 料理, desc: 仕込み 10 回, condition: { type: count, task: cooking-prep, gte: 10 } }
- { id: prep-050, name: 仕込み職人, icon: 🍳, tier: silver, cat: 料理, desc: 仕込み 50 回, condition: { type: count, task: cooking-prep, gte: 50 } }
- { id: cook-100, name: 台所の主, icon: 🍳, tier: gold, cat: 料理, desc: 料理の記録 100 回, condition: { type: count, area: cooking, gte: 100 } }
- { id: cook-250, name: 家庭料理人, icon: 👨‍🍳, tier: platinum, cat: 料理, desc: 料理の記録 250 回, condition: { type: count, area: cooking, gte: 250 } }
- { id: dinner-030, name: 夕食の人, icon: 🍲, tier: silver, cat: 料理, desc: 夜ご飯 30 回, condition: { type: count, task: dinner-cook, gte: 30 } }
- { id: breakfast-030, name: 朝食の人, icon: 🍞, tier: silver, cat: 料理, desc: 朝ごはん 30 回, condition: { type: count, task: breakfast-cook, gte: 30 } }
- { id: menu-020, name: 献立設計者, icon: 📅, tier: bronze, cat: 料理, desc: 翌日の献立を 20 回決める, condition: { type: count, task: menu-decide, gte: 20 } }
- { id: quick-prep, name: 段取りの人, icon: ⏱, tier: silver, cat: 料理, desc: 仕込みを見込みの半分の時間で終える（5 回）, condition: { type: custom, key: fast, task: cooking-prep, gte: 5 } }
- { id: cook-lv4, name: 味の設計者, icon: 🧂, tier: gold, cat: 料理, desc: 料理 Lv4, condition: { type: level, area: cooking, gte: 4 } }
- { id: dinner-first, name: 夕餉の支度, icon: 🍲, tier: bronze, cat: 料理, desc: 夜ご飯を初めて記録, condition: { type: first, task: dinner-cook } }
- { id: dinner-010, name: 夕食当番, icon: 🍲, tier: bronze, cat: 料理, desc: 夜ご飯 10 回, condition: { type: count, task: dinner-cook, gte: 10 } }
- { id: dinner-100, name: 百の夕餉, icon: 🍲, tier: gold, cat: 料理, desc: 夜ご飯 100 回, condition: { type: count, task: dinner-cook, gte: 100 } }
- { id: breakfast-first, name: 朝の一皿, icon: 🍞, tier: bronze, cat: 料理, desc: 朝ごはんを初めて記録, condition: { type: first, task: breakfast-cook } }
- { id: breakfast-010, name: 朝食当番, icon: 🍞, tier: bronze, cat: 料理, desc: 朝ごはん 10 回, condition: { type: count, task: breakfast-cook, gte: 10 } }
- { id: breakfast-100, name: 百の朝食, icon: 🥐, tier: gold, cat: 料理, desc: 朝ごはん 100 回, condition: { type: count, task: breakfast-cook, gte: 100 } }
- { id: cook-lv2, name: 台所の新星, icon: 🌟, tier: bronze, cat: 料理, desc: 料理 Lv2, condition: { type: level, area: cooking, gte: 2 } }
- { id: cook-lv3, name: 台所の職人, icon: 🔪, tier: silver, cat: 料理, desc: 料理 Lv3, condition: { type: level, area: cooking, gte: 3 } }
- { id: meals-day, name: 三つそろう日, icon: 🍱, tier: silver, cat: 料理, desc: 朝ごはん・夜ご飯・仕込みを同じ日に記録した日が 10 日, condition: { type: custom, key: tasks_day, tasks: [breakfast-cook, dinner-cook, cooking-prep], gte: 10 } }

# ---- D. 掃除 ----
- { id: clean-first, name: 初掃除, icon: 🧹, tier: bronze, cat: 掃除, desc: 掃除を初めて記録, condition: { type: first, area: cleaning } }
- { id: floor-025, name: 床の番人, icon: 🧹, tier: silver, cat: 掃除, desc: 床掃除 25 回, condition: { type: count, tasks: [floor-vacuum, floor-wipe], gte: 25 } }
- { id: bath-025, name: 浴室の防人, icon: 🚿, tier: silver, cat: 掃除, desc: 浴室の掃除 25 回, condition: { type: count, tasks: [bath-clean, bathroom-deep], gte: 25 } }
- { id: toilet-025, name: 白磁の守り手, icon: 🚽, tier: silver, cat: 掃除, desc: トイレ掃除 25 回, condition: { type: count, tasks: [toilet, toilet-deep], gte: 25 } }
- { id: windows-first, name: 光を通す者, icon: 🪟, tier: bronze, cat: 掃除, desc: 窓・サッシを初めて攻略, condition: { type: first, task: windows } }
- { id: hood-first, name: 換気扇、堕つ, icon: 🌀, tier: silver, cat: 掃除, desc: 換気扇本体を初めて攻略, condition: { type: first, task: range-hood } }
- { id: grates-first, name: 五徳の試練, icon: 🔥, tier: bronze, cat: 掃除, desc: 五徳の焦げ落としを完遂, condition: { type: first, task: stove-grates } }
- { id: grill-first, name: 魚焼きグリルの闇, icon: 🐟, tier: bronze, cat: 掃除, desc: グリルを完全清掃, condition: { type: first, task: grill } }
- { id: kitchen-trinity, name: キッチン三種の神器, icon: 🏅, tier: gold, cat: 掃除, desc: 換気扇・五徳・グリルを全制覇, condition: { type: combo, all_of: [hood-first, grates-first, grill-first] } }
- { id: fridge-first, name: 冷蔵庫の整理者, icon: ❄️, tier: bronze, cat: 掃除, desc: 冷蔵庫の全棚清掃を完遂, condition: { type: first, task: fridge-deep } }
- { id: aircon-first, name: エアコンの深呼吸, icon: 🌬, tier: bronze, cat: 掃除, desc: エアコンの吹出口と本体を掃除, condition: { type: first, task: aircon-body } }
- { id: washer-first, name: 洗濯槽リセット, icon: 🧺, tier: bronze, cat: 掃除, desc: 洗濯槽クリーナーを初めて回す, condition: { type: first, task: washer-tub } }
- { id: screens-first, name: 網戸の向こう, icon: 🕸, tier: bronze, cat: 掃除, desc: 網戸を初めて掃除, condition: { type: first, task: screens } }
- { id: balcony-first, name: ベランダ開拓, icon: 🪴, tier: bronze, cat: 掃除, desc: ベランダを初めて掃除, condition: { type: first, task: balcony } }
- { id: garden-first, name: 庭の番人, icon: 🌿, tier: bronze, cat: 掃除, desc: 庭の草取りを初めて記録, condition: { type: first, task: garden-weeding } }
- { id: mirror-first, name: 鏡よ鏡, icon: 🪞, tier: bronze, cat: 掃除, desc: 浴室の鏡のうろこ取りと曇り止めを初めてやり切る, condition: { type: first, task: bath-mirror } }
- { id: clean-lv3, name: 汚れの化学者, icon: 🧪, tier: gold, cat: 掃除, desc: 掃除 Lv3, condition: { type: level, area: cleaning, gte: 3 } }
- { id: clean-lv5, name: 予防設計者, icon: 🛡, tier: platinum, cat: 掃除, desc: 掃除 Lv5, condition: { type: level, area: cleaning, gte: 5 } }
- { id: all-places, name: 家中一巡, icon: 🌟, tier: gold, cat: 掃除, desc: 掃除メニューの全エリアを 30 日以内に 1 周, condition: { type: custom, key: all_places, days: 30 } }
- { id: bath-first, name: 湯船を磨く, icon: 🛁, tier: bronze, cat: 掃除, desc: 風呂掃除を初めて記録, condition: { type: first, task: bath-clean } }
- { id: toilet-first, name: トイレの友, icon: 🚽, tier: bronze, cat: 掃除, desc: トイレ掃除を初めて記録, condition: { type: first, tasks: [toilet, toilet-deep] } }
- { id: entrance-first, name: 玄関の顔, icon: 🚪, tier: bronze, cat: 掃除, desc: 玄関の掃除を初めて記録, condition: { type: first, tasks: [entrance-sweep, entrance-deep] } }
- { id: drum-care-first, name: ドラムの手入れ, icon: 🫧, tier: bronze, cat: 掃除, desc: ドラム式の手入れを初めてやる, condition: { type: first, task: laundry-filter } }
- { id: drain-filter-first, name: 排水フィルター開封, icon: 🔧, tier: bronze, cat: 掃除, desc: 洗濯機の排水フィルターを初めて洗う, condition: { type: first, task: washer-drain-filter } }
- { id: toilet-deep-first, name: トイレの奥の院, icon: ⛩, tier: bronze, cat: 掃除, desc: トイレの奥・タンク・換気口を初めて掃除, condition: { type: first, task: toilet-deep } }
- { id: menu-05, name: メニュー五品, icon: 🗒, tier: bronze, cat: 掃除, desc: 掃除メニューを 5 種類やる, condition: { type: custom, key: distinct, of: menu, gte: 5 } }
- { id: menu-15, name: メニュー十五品, icon: 🗒, tier: silver, cat: 掃除, desc: 掃除メニューを 15 種類やる, condition: { type: custom, key: distinct, of: menu, gte: 15 } }
- { id: menu-all, name: 掃除メニュー完全制覇, icon: 🏆, tier: platinum, cat: 掃除, desc: 掃除メニューを全種類やる（削除したものは除く）, condition: { type: custom, key: distinct, of: menu, all: true } }
- { id: big-03, name: 大物三つ, icon: 🐉, tier: silver, cat: 掃除, desc: 目安 60 日以上の大物メニューを 3 回やる, condition: { type: custom, key: menu_count, min_days: 60, gte: 3 } }
- { id: place-kitchen, name: キッチン制覇, icon: 🍳, tier: gold, cat: 掃除, desc: キッチンのメニューを全種類やる, condition: { type: custom, key: distinct, of: menu, place: キッチン, all: true } }
- { id: place-bath, name: 水回り制覇, icon: 🚿, tier: gold, cat: 掃除, desc: 風呂・洗面・トイレのメニューを全種類やる, condition: { type: custom, key: distinct, of: menu, place: 風呂・洗面・トイレ, all: true } }
- { id: place-living, name: 部屋制覇, icon: 🛋, tier: gold, cat: 掃除, desc: リビング・寝室のメニューを全種類やる, condition: { type: custom, key: distinct, of: menu, place: リビング・寝室, all: true } }
- { id: place-outside, name: 外まわり制覇, icon: 🌳, tier: silver, cat: 掃除, desc: 玄関・ベランダのメニューを全種類やる, condition: { type: custom, key: distinct, of: menu, place: 玄関・ベランダ, all: true } }
- { id: place-appliance, name: 家電制覇, icon: 🔌, tier: silver, cat: 掃除, desc: 家電のメニューを全種類やる, condition: { type: custom, key: distinct, of: menu, place: 家電, all: true } }
- { id: clean-lv2, name: 掃除の新星, icon: 🌟, tier: bronze, cat: 掃除, desc: 掃除 Lv2, condition: { type: level, area: cleaning, gte: 2 } }
- { id: water-trinity, name: 水回り三冠, icon: 💧, tier: gold, cat: 掃除, desc: 浴室の鏡・シンクの水垢・トイレの奥を全部やり切る, condition: { type: combo, all_of: [mirror-first, sink-first, toilet-deep-first] } }

# ---- E. 洗濯 ----
- { id: laundry-first, name: 初洗濯, icon: 👕, tier: bronze, cat: 洗濯, desc: 洗濯を初めて記録, condition: { type: first, area: laundry } }
- { id: wash-025, name: 回す人, icon: 🫧, tier: silver, cat: 洗濯, desc: 洗濯機を 25 回回す, condition: { type: count, task: laundry-wash, gte: 25 } }
- { id: dryfilter-030, name: ほこりの番人, icon: 🌬, tier: silver, cat: 洗濯, desc: 乾燥フィルターの綿ぼこりを 30 回取る（取り出しの手順）, condition: { type: count, task: fold-filter, gte: 30 } }
- { id: fold-025, name: たたむ人, icon: 🧺, tier: silver, cat: 洗濯, desc: 取り込んでたたむ 25 回, condition: { type: count, task: laundry-fold-store, gte: 25 } }
- { id: fold-100, name: たたみの達人, icon: 🧺, tier: gold, cat: 洗濯, desc: 取り込んでたたむ 100 回, condition: { type: count, task: laundry-fold-store, gte: 100 } }
- { id: daycare-010, name: 園の守り, icon: 🎒, tier: silver, cat: 洗濯, desc: 保育園のシーツ・タオルを 10 回, condition: { type: count, task: daycare-laundry, gte: 10 } }
- { id: laundry-lv3, name: 洗濯の人, icon: 👔, tier: gold, cat: 洗濯, desc: 洗濯 Lv3, condition: { type: level, area: laundry, gte: 3 } }
- { id: wash-010, name: 洗濯当番, icon: 🫧, tier: bronze, cat: 洗濯, desc: 洗濯乾燥を 10 回回す, condition: { type: count, task: laundry-wash, gte: 10 } }
- { id: wash-100, name: 百回の渦, icon: 🌀, tier: gold, cat: 洗濯, desc: 洗濯乾燥を 100 回回す, condition: { type: count, task: laundry-wash, gte: 100 } }
- { id: fold-010, name: たたみ上手, icon: 🧺, tier: bronze, cat: 洗濯, desc: 取り出してたたむ 10 回, condition: { type: count, task: laundry-fold-store, gte: 10 } }
- { id: daycare-first, name: 園の支度, icon: 🎒, tier: bronze, cat: 洗濯, desc: 保育園のシーツ・タオルを初めて記録, condition: { type: first, task: daycare-laundry } }
- { id: hang-first, name: 干すのも仕事, icon: 👕, tier: bronze, cat: 洗濯, desc: 乾燥にかけない物を干して記録, condition: { type: first, task: laundry-hang } }
- { id: laundry-lv2, name: 洗濯の新星, icon: 🌟, tier: bronze, cat: 洗濯, desc: 洗濯 Lv2, condition: { type: level, area: laundry, gte: 2 } }
- { id: laundry-cycle, name: 洗濯ひと巡り, icon: 🔁, tier: silver, cat: 洗濯, desc: 回すと取り出してたたむを同じ日に記録した日が 10 日, condition: { type: custom, key: tasks_day, tasks: [laundry-wash, laundry-fold-store], gte: 10 } }

# ---- F. 名もなき家事 ----
- { id: nameless-first, name: 見つけた, icon: 👁, tier: bronze, cat: 名もなき家事, desc: 名もなき家事を初めて記録, condition: { type: first, task: nameless-adhoc } }
- { id: nameless-010, name: 目が慣れてきた, icon: 👁, tier: bronze, cat: 名もなき家事, desc: 名もなき家事 10 件, condition: { type: count, task: nameless-adhoc, gte: 10 } }
- { id: nameless-025, name: 発見者, icon: 🔍, tier: silver, cat: 名もなき家事, desc: 名もなき家事 25 件, condition: { type: count, task: nameless-adhoc, gte: 25 } }
- { id: nameless-050, name: 家事の地図, icon: 🗺, tier: gold, cat: 名もなき家事, desc: 名もなき家事 50 件, condition: { type: count, task: nameless-adhoc, gte: 50 } }
- { id: garbage-050, name: ゴミの門番, icon: 🗑, tier: silver, cat: 名もなき家事, desc: ゴミまとめ 50 回, condition: { type: count, task: garbage, gte: 50 } }
- { id: mail-020, name: 郵便処理係, icon: 📮, tier: bronze, cat: 名もなき家事, desc: 郵便・書類・発送の処理 20 回, condition: { type: count, task: mail-papers, gte: 20 } }
- { id: refill-first, name: 初補充, icon: 🧴, tier: bronze, cat: 名もなき家事, desc: 洗剤・消耗品の補充を初めて記録, condition: { type: first, kind: refill } }
- { id: refill-020, name: 詰め替え職人, icon: 🧴, tier: bronze, cat: 名もなき家事, desc: 洗剤・消耗品の補充 20 回, condition: { type: count, kind: refill, gte: 20 } }
- { id: refill-050, name: 在庫番, icon: 📦, tier: silver, cat: 名もなき家事, desc: 洗剤・消耗品の補充 50 回, condition: { type: count, kind: refill, gte: 50 } }
- { id: steps-050, name: 小分け上手, icon: 🧩, tier: bronze, cat: 目標・記録, desc: 手順ごとの記録 50 回, condition: { type: custom, key: step_entries, gte: 50 } }
- { id: steps-200, name: 積み重ねの人, icon: 🧱, tier: silver, cat: 目標・記録, desc: 手順ごとの記録 200 回, condition: { type: custom, key: step_entries, gte: 200 } }
- { id: steps-full-010, name: 手順どおり, icon: ✅, tier: bronze, cat: 目標・記録, desc: 手順を全部たどってタスクを終える（10 回）, condition: { type: custom, key: steps_complete, gte: 10 } }
- { id: stock-012, name: 在庫の守り人, icon: 🧻, tier: silver, cat: 名もなき家事, desc: 消耗品の在庫チェック 12 回, condition: { type: count, task: supplies-check, gte: 12 } }
- { id: tidy-030, name: 片付けの人, icon: 🧹, tier: silver, cat: 名もなき家事, desc: 片付け 30 回, condition: { type: count, task: tidy-up, gte: 30 } }
- { id: nameless-100, name: 家事の百科, icon: 📚, tier: platinum, cat: 名もなき家事, desc: 名もなき家事 100 件, condition: { type: count, task: nameless-adhoc, gte: 100 } }
- { id: garbage-first, name: ゴミまとめ係, icon: 🗑, tier: bronze, cat: 名もなき家事, desc: ゴミまとめを初めて記録, condition: { type: first, task: garbage } }
- { id: garbage-out-first, name: ゴミ出し当番, icon: 🚮, tier: bronze, cat: 名もなき家事, desc: ゴミ出しを初めて記録, condition: { type: first, task: garbage-out } }
- { id: garbage-out-025, name: 収集日の人, icon: 🚛, tier: silver, cat: 名もなき家事, desc: ゴミ出し 25 回, condition: { type: count, task: garbage-out, gte: 25 } }
- { id: tidy-first, name: 片付け始め, icon: 🧸, tier: bronze, cat: 名もなき家事, desc: 片付けを初めて記録, condition: { type: first, task: tidy-up } }
- { id: tidy-010, name: 片付け上手, icon: 🧸, tier: bronze, cat: 名もなき家事, desc: 片付け 10 回, condition: { type: count, task: tidy-up, gte: 10 } }
- { id: refill-kinds-05, name: 補充五種, icon: 🧴, tier: bronze, cat: 名もなき家事, desc: 補充の項目を 5 種類記録, condition: { type: custom, key: distinct, of: refill, gte: 5 } }
- { id: refill-kinds-15, name: 補充十五種, icon: 🧴, tier: silver, cat: 名もなき家事, desc: 補充の項目を 15 種類記録, condition: { type: custom, key: distinct, of: refill, gte: 15 } }
- { id: refill-kinds-all, name: 在庫完全把握, icon: 📦, tier: gold, cat: 名もなき家事, desc: 補充の項目を全種類記録（削除したものは除く）, condition: { type: custom, key: distinct, of: refill, all: true } }
- { id: nameless-lv2, name: 名もなき新星, icon: 🌟, tier: bronze, cat: 名もなき家事, desc: 名もなき家事 Lv2, condition: { type: level, area: nameless, gte: 2 } }

# ---- G. 目標・記録 ----
- { id: target-first, name: 初達成, icon: 🎯, tier: bronze, cat: 目標・記録, desc: 週の目標を初めて達成, condition: { type: target_hit, gte: 1 } }
- { id: target-3, name: 三連, icon: 🎯, tier: silver, cat: 目標・記録, desc: 3 週連続で達成, condition: { type: target_hit, consecutive: 3 } }
- { id: target-10, name: 十連, icon: 🎯, tier: gold, cat: 目標・記録, desc: 10 週連続で達成, condition: { type: target_hit, consecutive: 10 } }
- { id: target-13, name: 四半期, icon: 🎯, tier: platinum, cat: 目標・記録, desc: 13 週連続で達成, condition: { type: target_hit, consecutive: 13 } }
- { id: overachieve, name: 超過達成, icon: 🚀, tier: silver, cat: 目標・記録, desc: 週の達成率 120% 超え, condition: { type: target_hit, ratio_gte: 1.2 } }
- { id: best-week, name: 自己ベスト, icon: 🏔, tier: bronze, cat: 目標・記録, desc: 週の換算時間の記録を更新, condition: { type: custom, key: best_week, gte: 1 } }
- { id: hours-010, name: 10時間の人, icon: ⏰, tier: bronze, cat: 目標・記録, desc: 累計 600 換算分, condition: { type: weighted_total, gte: 600 } }
- { id: hours-050, name: 50時間の人, icon: ⏰, tier: silver, cat: 目標・記録, desc: 累計 3000 換算分, condition: { type: weighted_total, gte: 3000 } }
- { id: hours-100, name: 100時間の人, icon: ⏰, tier: gold, cat: 目標・記録, desc: 累計 6000 換算分, condition: { type: weighted_total, gte: 6000 } }
- { id: hours-500, name: 500時間の人, icon: ⏰, tier: platinum, cat: 目標・記録, desc: 累計 30000 換算分, condition: { type: weighted_total, gte: 30000 } }
- { id: ramp-top, name: ランプ登頂, icon: 🧗, tier: gold, cat: 目標・記録, desc: 目標比率 100% の段階に到達, condition: { type: custom, key: ramp_top, gte: 1 } }
- { id: entries-050, name: 五十の記録, icon: 📝, tier: bronze, cat: 目標・記録, desc: 記録 50 件, condition: { type: count, gte: 50 } }
- { id: entries-100, name: 百の記録, icon: 📝, tier: bronze, cat: 目標・記録, desc: 記録 100 件, condition: { type: count, gte: 100 } }
- { id: entries-1000, name: 千の記録, icon: 📜, tier: gold, cat: 目標・記録, desc: 記録 1000 件, condition: { type: count, gte: 1000 } }
- { id: target-005, name: 五度目の達成, icon: 🎯, tier: silver, cat: 目標・記録, desc: 週の目標を通算 5 回達成, condition: { type: target_hit, gte: 5 } }
- { id: target-026, name: 半年分の達成, icon: 🎯, tier: gold, cat: 目標・記録, desc: 週の目標を通算 26 回達成, condition: { type: target_hit, gte: 26 } }
- { id: over-150, name: 大幅超過, icon: 🚀, tier: gold, cat: 目標・記録, desc: 週の達成率 150% 超え, condition: { type: target_hit, ratio_gte: 1.5 } }
- { id: hours-200, name: 200時間の人, icon: ⏰, tier: gold, cat: 目標・記録, desc: 累計 12000 換算分, condition: { type: weighted_total, gte: 12000 } }
- { id: big-day, name: 本気の日, icon: 💪, tier: bronze, cat: 目標・記録, desc: 1 日の換算時間が 120 分以上, condition: { type: custom, key: day_weighted, n: 120, gte: 1 } }
- { id: solid-days, name: 地道な三十日, icon: 🌾, tier: silver, cat: 目標・記録, desc: 換算 60 分以上の日が通算 30 日, condition: { type: custom, key: day_weighted, n: 60, gte: 30 } }
- { id: all-slots-day, name: 朝昼夜, icon: 🕰, tier: bronze, cat: 目標・記録, desc: 朝・昼・夜のすべてで記録した日がある, condition: { type: custom, key: all_slots_days, gte: 1 } }
- { id: all-slots-010, name: 一日中の人, icon: 🕰, tier: silver, cat: 目標・記録, desc: 朝・昼・夜のすべてで記録した日が 10 日, condition: { type: custom, key: all_slots_days, gte: 10 } }
- { id: morning-050, name: 朝の人, icon: 🌅, tier: silver, cat: 目標・記録, desc: 朝の記録 50 件, condition: { type: custom, key: slot_total, slot: morning, gte: 50 } }
- { id: night-100, name: 夜の人, icon: 🌙, tier: silver, cat: 目標・記録, desc: 夜の記録 100 件, condition: { type: custom, key: slot_total, slot: night, gte: 100 } }
- { id: backfill-010, name: 記憶の人, icon: 🧠, tier: bronze, cat: 目標・記録, desc: 過去の日に記録を足す 10 回, condition: { type: count, backfill: true, gte: 10 } }
- { id: steps-first, name: 一手ずつ, icon: 🧩, tier: bronze, cat: 目標・記録, desc: 手順を初めて記録, condition: { type: custom, key: step_entries, gte: 1 } }
- { id: steps-full-first, name: 手順をたどる, icon: ✅, tier: bronze, cat: 目標・記録, desc: 手順を全部たどってタスクを終える, condition: { type: custom, key: steps_complete, gte: 1 } }
- { id: steps-full-050, name: 手順の達人, icon: ✅, tier: silver, cat: 目標・記録, desc: 手順を全部たどってタスクを終える（50 回）, condition: { type: custom, key: steps_complete, gte: 50 } }
- { id: five-areas, name: 五冠の日, icon: 🏅, tier: silver, cat: 目標・記録, desc: 5 つの領域すべてを同じ日に記録, condition: { type: custom, key: trio, areas: [dishes, cooking, cleaning, laundry, nameless], gte: 1 } }
- { id: five-areas-030, name: 五冠の常連, icon: 🏅, tier: gold, cat: 目標・記録, desc: 5 つの領域すべてを記録した日が 30 日, condition: { type: custom, key: trio, areas: [dishes, cooking, cleaning, laundry, nameless], gte: 30 } }

# ---- H. 学び ----
- { id: learn-first, name: 最初の気づき, icon: 💡, tier: bronze, cat: 学び, desc: 「気づき」を初めて記録, condition: { type: count, learned: true, gte: 1 } }
- { id: learn-025, name: 気づきの蓄積, icon: 💡, tier: silver, cat: 学び, desc: 気づき 25 件, condition: { type: count, learned: true, gte: 25 } }
- { id: practice-050, name: 反復の人, icon: 🔁, tier: silver, cat: 学び, desc: コツを 50 回実践, condition: { type: count, practiced: true, gte: 50 } }
- { id: tip-mastered, name: 体に入った, icon: 🧠, tier: gold, cat: 学び, desc: 1 つのコツが最終段階（90 日）に到達, condition: { type: custom, key: tip_stage, gte: 1 } }
- { id: tip-ten, name: 十の習い, icon: 🧠, tier: platinum, cat: 学び, desc: 10 個のコツが最終段階に到達, condition: { type: custom, key: tip_stage, gte: 10 } }
- { id: master-one, name: 一領域を修める, icon: 🎓, tier: gold, cat: 学び, desc: どれかの領域で Lv5, condition: { type: level, any: true, gte: 5 } }
- { id: master-two, name: 二領域を修める, icon: 🎓, tier: platinum, cat: 学び, desc: 2 つの領域で Lv5, condition: { type: level, areas_gte: 2, gte: 5 } }
- { id: all-lv3, name: 全領域踏破, icon: 🏛, tier: gold, cat: 学び, desc: 全領域で Lv3 以上, condition: { type: level, all: true, gte: 3 } }
- { id: practice-first, name: 最初の実践, icon: 💡, tier: bronze, cat: 学び, desc: コツを初めて実践, condition: { type: count, practiced: true, gte: 1 } }
- { id: practice-010, name: 実践十回, icon: 🔁, tier: bronze, cat: 学び, desc: コツを 10 回実践, condition: { type: count, practiced: true, gte: 10 } }
- { id: tips-010, name: 十のコツ, icon: 📖, tier: bronze, cat: 学び, desc: 違うコツを 10 種類実践, condition: { type: custom, key: tips_distinct, gte: 10 } }
- { id: tips-030, name: 三十のコツ, icon: 📖, tier: silver, cat: 学び, desc: 違うコツを 30 種類実践, condition: { type: custom, key: tips_distinct, gte: 30 } }
- { id: tips-060, name: 六十のコツ, icon: 📚, tier: gold, cat: 学び, desc: 違うコツを 60 種類実践, condition: { type: custom, key: tips_distinct, gte: 60 } }
- { id: tip-stage2, name: 身につきはじめ, icon: 🌱, tier: bronze, cat: 学び, desc: 5 つのコツが 7 日の段階に上がる, condition: { type: custom, key: tip_stage, stage: 2, gte: 5 } }
- { id: learn-010, name: 気づき十, icon: 💡, tier: bronze, cat: 学び, desc: 気づき 10 件, condition: { type: count, learned: true, gte: 10 } }
- { id: learn-050, name: 気づきの帳面, icon: 📓, tier: gold, cat: 学び, desc: 気づき 50 件, condition: { type: count, learned: true, gte: 50 } }
- { id: mood-first, name: 気分を記す, icon: 🙂, tier: bronze, cat: 学び, desc: 気分を初めて記録, condition: { type: count, mood: true, gte: 1 } }
- { id: mood-030, name: 心の天気図, icon: 🌤, tier: silver, cat: 学び, desc: 気分を 30 回記録, condition: { type: count, mood: true, gte: 30 } }
- { id: all-lv2, name: 全領域 Lv2, icon: 🏛, tier: silver, cat: 学び, desc: 全領域で Lv2 以上, condition: { type: level, all: true, gte: 2 } }

# ---- I. 引き算 ----
- { id: partial-010, name: 70点主義, icon: 🧘, tier: silver, cat: 引き算, desc: 「70点で完了」を 10 回, condition: { type: count, status: partial, gte: 10 } }
- { id: partial-first, name: 70点デビュー, icon: 🧘, tier: bronze, cat: 引き算, desc: 「70点で完了」を初めて使う, condition: { type: count, status: partial, gte: 1 } }
- { id: partial-030, name: 70点の達人, icon: 🧘, tier: gold, cat: 引き算, desc: 「70点で完了」を 30 回, condition: { type: count, status: partial, gte: 30 } }
- { id: pass-005, name: 休むのも仕事, icon: 🛌, tier: silver, cat: 引き算, desc: パスを通算 5 回使う, condition: { type: count, status: passed, gte: 5 } }
- { id: light-05, name: 低空飛行, icon: 🪶, tier: bronze, cat: 引き算, desc: 換算 20 分以下でも記録した日が 5 日, condition: { type: custom, key: light_days, n: 20, gte: 5 } }
- { id: light-20, name: 細く長く, icon: 🪶, tier: silver, cat: 引き算, desc: 換算 20 分以下でも記録した日が 20 日, condition: { type: custom, key: light_days, n: 20, gte: 20 } }
- { id: fast-010, name: 手際よし, icon: ⚡️, tier: bronze, cat: 引き算, desc: どのタスクでも見込みの半分以下で終えた回数が 10 回, condition: { type: custom, key: fast_total, gte: 10 } }

# ---- J. 買い物（買い物メモで買って「買い物を記録」した物） ----
- { id: shop-first, name: はじめてのおつかい, icon: 🛒, tier: bronze, cat: 買い物, desc: 買い物メモで買った物を初めて記録する, condition: { type: custom, key: shop, of: items, gte: 1 } }
- { id: shop-items-010, name: カゴいっぱい, icon: 🧺, tier: bronze, cat: 買い物, desc: 買った物が通算 10 点, condition: { type: custom, key: shop, of: items, gte: 10 } }
- { id: shop-items-030, name: 両手に袋, icon: 🛍, tier: silver, cat: 買い物, desc: 買った物が通算 30 点, condition: { type: custom, key: shop, of: items, gte: 30 } }
- { id: shop-items-100, name: 百品目, icon: 🏪, tier: gold, cat: 買い物, desc: 買った物が通算 100 点, condition: { type: custom, key: shop, of: items, gte: 100 } }
- { id: shop-items-300, name: 家の物流, icon: 🚚, tier: platinum, cat: 買い物, desc: 買った物が通算 300 点, condition: { type: custom, key: shop, of: items, gte: 300 } }
- { id: shop-days-005, name: 歩いて買い出し, icon: 🚶, tier: bronze, cat: 買い物, desc: 買い物をした日が 5 日, condition: { type: custom, key: shop, of: days, gte: 5 } }
- { id: shop-days-020, name: 自転車で買い出し, icon: 🚲, tier: silver, cat: 買い物, desc: 買い物をした日が 20 日, condition: { type: custom, key: shop, of: days, gte: 20 } }
- { id: shop-days-050, name: 買い出しの達人, icon: 🚗, tier: gold, cat: 買い物, desc: 買い物をした日が 50 日, condition: { type: custom, key: shop, of: days, gte: 50 } }
- { id: shop-kinds-010, name: 十品目, icon: 🥕, tier: bronze, cat: 買い物, desc: 10 種類の物を買う, condition: { type: custom, key: shop, of: distinct, gte: 10 } }
- { id: shop-kinds-030, name: 品ぞろえ, icon: 🧾, tier: silver, cat: 買い物, desc: 30 種類の物を買う, condition: { type: custom, key: shop, of: distinct, gte: 30 } }
- { id: shop-staple, name: いつもの一品, icon: 🥛, tier: bronze, cat: 買い物, desc: 同じ物を 5 回買う, condition: { type: custom, key: shop, of: same, gte: 5 } }
- { id: shop-bulk, name: まとめ買い, icon: 📦, tier: silver, cat: 買い物, desc: 1 日に 10 点以上買う, condition: { type: custom, key: shop, of: bulk, n: 10, gte: 1 } }
- { id: shop-weeks-4, name: 毎週の買い出し, icon: 📅, tier: silver, cat: 買い物, desc: 4 週続けて買い物をする, condition: { type: custom, key: shop, of: weeks, gte: 4 } }
- { id: shop-refill, name: 補充の段取り, icon: 🧴, tier: bronze, cat: 買い物, desc: 洗剤や消耗品（補充の項目）を買い物メモで 3 点買う, condition: { type: custom, key: shop, of: refill, gte: 3 } }
- { id: shop-pairs, name: 在庫の循環, icon: 🔁, tier: silver, cat: 買い物, desc: 補充とその物の買い物を 14 日以内につなげる（3 回）, condition: { type: custom, key: shop, of: pairs, gte: 3 } }

# ---- K. シークレット（獲得するまで ??? ）----
- { id: dawn, name: 夜明け前の人, icon: 🌅, tier: secret, cat: シークレット, desc: 3:00〜5:29 の記録が 10 回, secret: true, condition: { type: custom, key: early, gte: 10 } }
- { id: trio, name: 三種そろい踏み, icon: 🎼, tier: secret, cat: シークレット, desc: 洗い物・料理・洗濯を同じ日に記録した日が 7 日, secret: true, condition: { type: custom, key: trio, areas: [dishes, cooking, laundry], gte: 7 } }
- { id: ten-a-day, name: 一日十件, icon: 🔟, tier: secret, cat: シークレット, desc: 1 日に 10 件記録する, secret: true, condition: { type: custom, key: day_entries, n: 10, gte: 1 } }
- { id: quiet-morning, name: 静かな朝, icon: 🌄, tier: secret, cat: シークレット, desc: 朝に 3 件以上記録した日が 5 日, secret: true, condition: { type: custom, key: morning_entries, n: 3, gte: 5 } }
- { id: weekend-lord, name: 週末の主, icon: 🛋, tier: secret, cat: シークレット, desc: 土日に 5 件以上記録した日が 4 日, secret: true, condition: { type: custom, key: weekend_days, n: 5, gte: 4 } }
- { id: twenty-a-day, name: 一日二十件, icon: 🌀, tier: secret, cat: シークレット, desc: 1 日に 20 件記録する, secret: true, condition: { type: custom, key: day_entries, n: 20, gte: 1 } }
- { id: zorome, name: ゾロ目の日, icon: 🎲, tier: secret, cat: シークレット, desc: 月と日がそろった日（11 月 11 日など）に記録, secret: true, condition: { type: custom, key: on_date, zorome: true, gte: 1 } }
- { id: new-year, name: 元日の人, icon: 🎍, tier: secret, cat: シークレット, desc: 1 月 1 日に記録, secret: true, condition: { type: custom, key: on_date, md: ['01-01'], gte: 1 } }
- { id: new-year-eve, name: 大晦日の人, icon: 🔔, tier: secret, cat: シークレット, desc: 12 月 31 日に記録, secret: true, condition: { type: custom, key: on_date, md: ['12-31'], gte: 1 } }
- { id: year-end, name: 年末の大掃除, icon: 🎊, tier: secret, cat: シークレット, desc: 12 月 25〜31 日に掃除メニューを 5 回, secret: true, condition: { type: custom, key: year_end, gte: 5 } }
- { id: shop-clean, name: 買い忘れゼロ, icon: ✅, tier: secret, cat: シークレット, desc: メモを全部買いきって記録する（3 回）, secret: true, condition: { type: custom, key: shop, of: clean, gte: 3 } }
```
