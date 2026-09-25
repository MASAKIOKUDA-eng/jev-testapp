# Jev イメージ判定ラボ

TypeSafe の System One モデル **Jev** の挙動を理解するためのテストアプリです。
ある単語（例:「花火」）から「A」と「B」（例:「夏」と「冬」）のどちらをイメージするかを Jev に判定させ、その結果を見比べます。

## できること

- **単語を判定**: 1つの単語について、Jev の3種類の質問（choice / noul / score）を同時に投げ、結果を並べて表示します。
  - 総合判定（A 寄り度合い）と、質問ごとの判定が一致しているか（「一致」か「ゆらぎ」か）
  - 位置バイアス: 選択肢の並び順を B, A に入れ替えたときに、A の確率がどれだけ変わるか
  - 応答時間、入力トークン数、Jev に送ったリクエストと返ってきた answers の生 JSON
- **まとめて判定**: 単語リスト（最大100語）を一括で判定し、表で比較します。A 寄り順・位置バイアスが大きい順に並べ替えられ、CSV / JSON で書き出せます。
- **プリセット**: 夏/冬、ブーバ/キキ、犬/猫、和/洋、明るい/暗い、男性的/女性的
- **前提・補足説明**: 「日本の一般的な大人の感覚で」のような前提や、選択肢の説明を付けたときに判定がどう変わるかを試せます。
- **デモモード**: API キーが無くても、ローカルの疑似レスポンスで画面を確認できます（値に意味はありません）。

## 仕組み

1つの単語につき Jev の `POST /v1/systemone` を **1回だけ** 呼びます。state（単語と前提）は1回だけ送り、次の質問はすべて同じ state に対して独立・並列に評価されます。

| 質問名 | 種類 | 見ていること |
|---|---|---|
| `choice` | choice | A と B のどちらをイメージするか（本命の判定） |
| `choice_swapped` | choice | 選択肢を B, A の順に並べ替えた同じ質問（位置バイアスを見る） |
| `noul_a` / `noul_b` | noul | 「A をイメージさせる」「B をイメージさせる」を別々に聞いたときの確率 |
| `scale` | score | 「明らかに A」〜「明らかに B」の5段階のどこに当たるか |

各質問の結果を「A 寄り度合い（0〜1）」に揃え、その平均を総合判定にしています（0.5 ± 0.05 は「拮抗」）。

- choice: P(A) / (P(A) + P(B))
- noul: noul_a / (noul_a + noul_b)
- score: 1 − score / 4

判定ロジックは [`server/judge.ts`](server/judge.ts) にまとまっています。

## セットアップ

Node.js 20.12 以上が必要です。

```bash
npm install
cp .env.example .env   # TYPESAFE_API_KEY を設定する（空ならデモモード）
npm run dev            # http://localhost:5173
```

API キーは [TypeSafe Console](https://console.typesafe.ai/settings/keys) で発行します。キーを使うのはサーバー側だけで、ブラウザには渡りません。

本番相当で動かす場合:

```bash
npm run build
npm start              # http://localhost:8787
```

### 環境変数

| 変数 | 説明 |
|---|---|
| `TYPESAFE_API_KEY` | TypeSafe の API キー。未設定ならデモモードで起動します |
| `TYPESAFE_DEFAULT_MODEL` | 既定のモデル（既定値は `jev-latest`）。画面から都度変更することもできます |
| `JEV_DEMO` | `1` にすると、キーがあってもデモモードで起動します |
| `PORT` | サーバーのポート（既定値は `8787`） |

## 開発

```bash
npm test          # vitest（外部 API には接続しません）
npm run typecheck
```

## 構成

```
server/
  index.ts      Express サーバー（/api/status, /api/models, /api/judge, /api/batch）
  judge.ts      質問の組み立てと、結果の正規化・集計
  demoFetch.ts  デモモード用の疑似 TypeSafe API（SDK の fetch に差し込む）
shared/types.ts サーバーとクライアントで共有する型
client/         画面（Vite + TypeScript、フレームワークなし）
tests/          単体テスト
```

## 参考

- [Introducing System One models and Jev（TypeSafe）](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [Jevで要件定義書をレビューするアプリを作った（Qiita）](https://qiita.com/miso_taku/items/b5e2150055933b51fba3)
- [@typesafe-ai/sdk](https://github.com/typesafe-ai/typesafe-sdk-js)
