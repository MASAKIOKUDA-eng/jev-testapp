import { choice, noul, score, type TypeSafeClient } from "@typesafe-ai/sdk";
import type {
  ChoiceProbe,
  JudgeRequest,
  JudgeResult,
  JudgeSummary,
  Mode,
  NoulProbe,
  OptionInput,
  ProbeOptions,
  ScoreProbe,
  Side,
} from "../shared/types.js";

export const DEFAULT_PROBES: ProbeOptions = { swap: true, noul: true, score: true };

/** この幅以内なら「どちらとも言えない」とみなす。 */
const TIE_MARGIN = 0.05;

export class ValidationError extends Error {}

interface NormalizedRequest {
  word: string;
  optionA: OptionInput;
  optionB: OptionInput;
  context?: string;
  model?: string;
  probes: ProbeOptions;
}

export function normalizeRequest(input: Partial<JudgeRequest>): NormalizedRequest {
  const word = typeof input.word === "string" ? input.word.trim() : "";
  if (!word) throw new ValidationError("単語を入力してください。");
  if (word.length > 200) throw new ValidationError("単語は200文字以内にしてください。");

  const optionA = normalizeOption(input.optionA, "A");
  const optionB = normalizeOption(input.optionB, "B");
  if (optionA.label === optionB.label) {
    throw new ValidationError("選択肢AとBには異なる名前を付けてください。");
  }

  const context = input.context?.trim() || undefined;
  const model = input.model?.trim() || undefined;
  return {
    word,
    optionA,
    optionB,
    context,
    model,
    probes: { ...DEFAULT_PROBES, ...(input.probes ?? {}) },
  };
}

function normalizeOption(option: OptionInput | undefined, side: Side): OptionInput {
  const label = typeof option?.label === "string" ? option.label.trim() : "";
  if (!label) throw new ValidationError(`選択肢${side}の名前を入力してください。`);
  if (label.length > 100) throw new ValidationError(`選択肢${side}は100文字以内にしてください。`);
  const description = option?.description?.trim() || undefined;
  return description ? { label, description } : { label };
}

/** 選択肢を「名前（説明）」の形で文章に埋め込む。 */
function describe(option: OptionInput): string {
  return option.description ? `「${option.label}」（${option.description}）` : `「${option.label}」`;
}

/** Jev へ送る state と questions を組み立てる。 */
export function buildQuestions(req: NormalizedRequest) {
  const { optionA: a, optionB: b, probes } = req;

  const state: Record<string, string> = { word: req.word };
  if (req.context) state.context = req.context;

  const choiceInstructions =
    "state の word（単語）から、より強くイメージ・連想されるのはどちらかを選ぶ。" +
    (req.context ? "判断は state の context を前提にする。" : "");

  const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul> | ReturnType<typeof score>> = {
    choice: choice(choiceInstructions, {
      [a.label]: a.description ?? null,
      [b.label]: b.description ?? null,
    }),
  };

  if (probes.swap) {
    // 同じ質問で選択肢の並び順だけを入れ替える。
    questions.choice_swapped = choice(choiceInstructions, {
      [b.label]: b.description ?? null,
      [a.label]: a.description ?? null,
    });
  }

  if (probes.noul) {
    questions.noul_a = noul(`この単語は${describe(a)}をイメージさせる。`);
    questions.noul_b = noul(`この単語は${describe(b)}をイメージさせる。`);
  }

  if (probes.score) {
    questions.scale = score(
      `この単語から受けるイメージが、${describe(a)}と${describe(b)}の間のどこに位置するかを評価する。`,
      [
        `明らかに「${a.label}」`,
        `やや「${a.label}」`,
        "どちらとも言えない",
        `やや「${b.label}」`,
        `明らかに「${b.label}」`,
      ],
    );
  }

  return { state, questions };
}

// SDK の answers はリクエストした質問に応じて型付けされるが、
// 質問セットを動的に組み立てているのでここでは構造だけを見て読み取る。
interface RawChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
interface RawScore {
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}
interface RawNoul {
  noul: number;
}

function readChoice(answer: RawChoice, a: OptionInput, b: OptionInput): ChoiceProbe {
  const pA = answer.probabilities[a.label] ?? 0;
  const pB = answer.probabilities[b.label] ?? 0;
  return {
    chosen: answer.choice === a.label ? "A" : "B",
    pA,
    pB,
    confidence: answer.confidence,
  };
}

function readScore(answer: RawScore): ScoreProbe {
  const levels = 4;
  return {
    score: answer.score,
    leanA: clamp01(1 - answer.score / levels),
    confidence: answer.confidence,
    probabilities: { ...answer.probabilities },
  };
}

function readNoul(a: RawNoul, b: RawNoul): NoulProbe {
  const total = a.noul + b.noul;
  return { a: a.noul, b: b.noul, leanA: total > 0 ? a.noul / total : 0.5 };
}

export function summarize(
  choiceProbe: ChoiceProbe,
  swapped: ChoiceProbe | null,
  noulProbe: NoulProbe | null,
  scoreProbe: ScoreProbe | null,
): JudgeSummary {
  const signals: { name: string; leanA: number }[] = [{ name: "choice", leanA: shareA(choiceProbe) }];
  if (swapped) signals.push({ name: "choice（入替）", leanA: shareA(swapped) });
  if (noulProbe) signals.push({ name: "noul", leanA: noulProbe.leanA });
  if (scoreProbe) signals.push({ name: "score", leanA: scoreProbe.leanA });

  const leanA = signals.reduce((sum, s) => sum + s.leanA, 0) / signals.length;
  const sides = signals.map((s) => sideOf(s.leanA));
  const consistent = sides.every((side) => side === sides[0]);

  return {
    verdict: sideOf(leanA),
    leanA,
    consistent,
    positionBias: swapped ? choiceProbe.pA - swapped.pA : null,
    signals,
  };
}

/** A と B の確率を A の割合に正規化する（他に確率が割り振られても比較できるように）。 */
function shareA(probe: ChoiceProbe): number {
  const total = probe.pA + probe.pB;
  return total > 0 ? probe.pA / total : 0.5;
}

function sideOf(leanA: number): Side | "tie" {
  if (Math.abs(leanA - 0.5) <= TIE_MARGIN) return "tie";
  return leanA > 0.5 ? "A" : "B";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** 1 つの単語について Jev に 1 回問い合わせ、全プローブの結果をまとめて返す。 */
export async function judge(
  client: TypeSafeClient,
  input: Partial<JudgeRequest>,
  mode: Mode,
): Promise<JudgeResult> {
  const req = normalizeRequest(input);
  const { state, questions } = buildQuestions(req);
  const request = { model: req.model ?? client.defaultModel, state, questions };

  const started = performance.now();
  const response = await client.systemOne(request);
  const latencyMs = Math.round(performance.now() - started);

  const answers = response.answers as Record<string, unknown>;
  const { optionA: a, optionB: b } = req;

  const choiceProbe = readChoice(answers.choice as RawChoice, a, b);
  const swapped = answers.choice_swapped ? readChoice(answers.choice_swapped as RawChoice, a, b) : null;
  const noulProbe =
    answers.noul_a && answers.noul_b ? readNoul(answers.noul_a as RawNoul, answers.noul_b as RawNoul) : null;
  const scoreProbe = answers.scale ? readScore(answers.scale as RawScore) : null;

  return {
    word: req.word,
    optionA: a,
    optionB: b,
    model: response.model,
    mode,
    latencyMs,
    inputTokens: response.usage?.input_tokens ?? null,
    choice: choiceProbe,
    choiceSwapped: swapped,
    noul: noulProbe,
    score: scoreProbe,
    summary: summarize(choiceProbe, swapped, noulProbe, scoreProbe),
    request,
    rawAnswers: answers,
  };
}
