# AutoShiftMaker 詳細設計書

## 1. フロントエンド詳細設計（app.js）
### 1.1 初期化
- DOM要素を取得し、現在年月を対象月に初期設定。
- `loadPatterns()` でローカルストレージから勤務体系を復元。
- `renderPatterns()`, `renderWorkers()` を実行して初期描画。

### 1.2 勤務体系管理
- `addPattern` クリック時:
  - 入力検証（名称、週上限、時刻範囲）。
  - 一意ID付き勤務体系オブジェクトを生成し配列へ追加。
  - `savePatterns()` で保存後、再描画。
- 削除ボタン押下時:
  - 対象勤務体系を配列から除外。
  - 全勤務者の `patternIds` から該当IDを除外。
  - `patternIds` が空になった勤務者は一覧から除外。
  - 保存・再描画・メッセージ表示。

### 1.3 勤務者管理
- `addWorker` クリック時:
  - 入力検証（氏名、勤務体系選択）。
  - `workers` へ `{ name, patternIds }` を追加し再描画。
- 削除ボタン押下時:
  - 対象勤務者を `workers` から除外して再描画。

### 1.4 シフト作成実行
- `generate` クリック時:
  - 入力値を収集して `generateSchedule()` へ渡す。
  - `renderSchedule()` で成功/失敗表示を切り替え。

## 2. シフト作成詳細設計（scheduler.js）
### 2.1 補助関数
- `buildHourRange(startHour, endHour)`:
  - 勤務時間帯を時刻配列へ展開（跨日対応）。
- `daysInMonth(year, monthIndex)`:
  - 対象月の日数取得。
- `normalizeWorkerPatternIds(worker)`:
  - `patternIds` と旧 `patternId` の互換処理。

### 2.2 事前検証
- 対象月形式、勤務者配列、勤務体系配列、連続勤務上限、必要人数配列を検証。
- 勤務体系ごとに時間帯配列を前計算し `patternMap` を生成。
- 勤務者ごとに勤務可能勤務体系を解決し、内部データへ変換。

### 2.3 割当アルゴリズム
- 日単位の再帰探索 `assignDay(dayIndex, state)` を実行。
- 各日で以下を判定:
  - 強制休み対象日ではないこと。
  - 連続勤務上限未満であること。
  - 週内勤務体系上限に達していないこと。
- 需要の高い時間帯に寄与する勤務者・勤務体系を優先して探索。
- `allRequirementsMet()` で必要人数充足を判定。
- `canStillMeetWithRemainingWorkers()` で枝刈り。

### 2.4 状態遷移
- 勤務割当時:
  - 連続勤務日数を加算。
  - 週内勤務体系回数を加算。
  - 夜勤の場合、2日後を `forcedOffDays` に登録。
- 非割当時:
  - 連続勤務日数を0へリセット。

### 2.5 出力整形
- 成功時:
  - 日付・勤務者・勤務体系名を `assignments` として返却。
- 失敗時:
  - `success: false` とエラーメッセージを返却。

## 3. 既知の仕様制約
- 勤務者情報はブラウザ再読込で消える（永続化しない）。
- サーバー処理やDB連携は実装しない。
