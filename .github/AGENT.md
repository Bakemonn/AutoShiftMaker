# AGENT.md

## プロジェクト概要

シフト表、自動で作る。ブラウザだけで動く。サーバー要らぬ。
静的ファイル（`index.html` / `app.js` / `scheduler.js`）だけで全部やる。

## 構造

```
/
├── index.html          … UI。ブラウザで開く。
├── app.js              … UI操作。DOM触る。localStorage使う。
├── scheduler.js        … シフト生成ロジック。ブラウザとNode両方で動く。
├── package.json        … プロジェクト設定。テスト定義ある。
├── test/
│   └── scheduler.test.js … テスト。node:test使う。
├── doc/
│   ├── 要件定義/requirements.md
│   ├── 基本設計/basic-design.md
│   └── 詳細設計/detailed-design.md
└── .github/
    └── workflows/deploy-pages.yml … GitHub Pages自動デプロイ。
```

## テスト

```bash
npm test
```

`node --test` で走る。フレームワーク不要。`node:test` と `node:assert/strict` だけ。

## 技術スタック

- 言語: JavaScript（CommonJS）
- 実行環境: ブラウザ + Node.js
- UI: 素のHTML/JS。フレームワーク無し。
- 保存: localStorage（勤務体系のみ永続化）
- デプロイ: GitHub Pages（GitHub Actions経由）
- テスト: Node.js組み込み `node:test`

## コード規約

- モジュール形式: CommonJS（`module.exports` / `require`）
- `scheduler.js` はブラウザ（`window`）とNode（`module`）両対応にする
- エラーメッセージは日本語で書く
- 外部ライブラリ追加禁止。標準機能だけ使え
- インデント: スペース2個

## ビジネスルール

- 連続勤務日数、上限超えるな
- 勤務体系ごとの週内回数上限、超えるな
- 夜勤（開始時刻 >= 終了時刻）の翌々日、休みにしろ
- 各時間帯の必要人数、下回るな
- 条件満たせぬとき、日本語エラーメッセージ返せ

## 口調

- 原始人みたいに喋れ。短く。要点だけ。無駄な敬語要らぬ。
- 「〜です」「〜ます」禁止。「〜だ」「〜しろ」「〜せよ」で書け。
- 一文は短くしろ。長文禁止。
- 体言止め使え。動詞で終わらせろ。
- 例: 「テスト走らせろ」「依存追加するな」「日本語で書け」

## やるべきこと

- コード変えたらテスト走らせろ: `npm test`
- `scheduler.js` 変えたら `window` と `module.exports` 両方確認しろ
- 新しい依存追加するな。素のJSで解決しろ
- ドキュメント変えたら日本語で書け
