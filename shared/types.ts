/** サーバーとクライアントで共有する型定義。 */

/** 判定の選択肢（A または B）。 */
export interface OptionInput {
  /** 選択肢の名前。Jev の choice ラベルとしてそのまま使う。 */
  label: string;
  /** 選択肢の補足説明（任意）。Jev の criteria の説明として渡す。 */
  description?: string;
}

/** 同じ単語に対して同時に投げる追加プローブ。 */
export interface ProbeOptions {
  /** A/B の並び順を入れ替えた choice も投げ、位置バイアスを見る。 */
  swap: boolean;
  /** 「A をイメージさせる」「B をイメージさせる」を noul で個別に投げる。 */
  noul: boolean;
  /** A〜B の 5 段階スケールを score で投げる。 */
  score: boolean;
}

export interface JudgeRequest {
  word: string;
  optionA: OptionInput;
  optionB: OptionInput;
  /** 判断の前提（例:「日本人の一般的な感覚で」）。任意。 */
  context?: string;
  model?: string;
  probes?: Partial<ProbeOptions>;
}

export interface BatchRequest extends Omit<JudgeRequest, "word"> {
  words: string[];
}

export type Side = "A" | "B";

/** choice 質問の結果。 */
export interface ChoiceProbe {
  /** Jev が選んだ側。 */
  chosen: Side;
  /** A を選ぶ確率。 */
  pA: number;
  /** B を選ぶ確率。 */
  pB: number;
  /** Jev が返した confidence。 */
  confidence: number;
}

/** 5 段階スケール（0 = 明らかに A, 4 = 明らかに B）の結果。 */
export interface ScoreProbe {
  /** 期待スコア（0〜4、小数あり）。 */
  score: number;
  /** A 寄り度合い（1 - score / 4）。 */
  leanA: number;
  confidence: number;
  /** 各レベルの確率。キーは "0"〜"4"。 */
  probabilities: Record<string, number>;
}

export interface NoulProbe {
  /** 「A をイメージさせる」が真である確率。 */
  a: number;
  /** 「B をイメージさせる」が真である確率。 */
  b: number;
  /** a / (a + b)。両方 0 のときは 0.5。 */
  leanA: number;
}

/** 各プローブを総合した判定。 */
export interface JudgeSummary {
  /** 総合してどちら寄りか。 */
  verdict: Side | "tie";
  /** 各プローブの A 寄り度合いの平均（0〜1）。 */
  leanA: number;
  /** すべてのプローブが同じ側を指したか。 */
  consistent: boolean;
  /** 並び順による差（順番通りの pA - 入れ替え時の pA）。swap 未実施なら null。 */
  positionBias: number | null;
  /** 集計に使ったプローブごとの A 寄り度合い。 */
  signals: { name: string; leanA: number }[];
}

export interface JudgeResult {
  word: string;
  optionA: OptionInput;
  optionB: OptionInput;
  model: string;
  mode: Mode;
  latencyMs: number;
  inputTokens: number | null;
  choice: ChoiceProbe;
  choiceSwapped: ChoiceProbe | null;
  noul: NoulProbe | null;
  score: ScoreProbe | null;
  summary: JudgeSummary;
  /** 実際に Jev へ送ったリクエスト（学習用に表示する）。 */
  request: unknown;
  /** Jev から返ってきた answers をそのまま保持する。 */
  rawAnswers: unknown;
}

export interface BatchItem {
  word: string;
  result?: JudgeResult;
  error?: string;
}

export type Mode = "live" | "demo";

export interface StatusResponse {
  mode: Mode;
  defaultModel: string;
}
