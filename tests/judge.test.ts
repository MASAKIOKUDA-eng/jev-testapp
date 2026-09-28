import { TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import { demoFetch } from "../server/demoFetch.js";
import { buildQuestions, judge, normalizeRequest, summarize, ValidationError } from "../server/judge.js";

const base = { optionA: { label: "夏" }, optionB: { label: "冬" } };

describe("normalizeRequest", () => {
  it("空の単語を拒否する", () => {
    expect(() => normalizeRequest({ ...base, word: "  " })).toThrow(ValidationError);
  });

  it("同じ名前の選択肢を拒否する", () => {
    expect(() => normalizeRequest({ word: "海", optionA: { label: "夏" }, optionB: { label: " 夏 " } })).toThrow(
      ValidationError,
    );
  });

  it("プローブの既定値はすべて有効", () => {
    expect(normalizeRequest({ ...base, word: "海" }).probes).toEqual({ swap: true, noul: true, score: true });
  });
});

describe("buildQuestions", () => {
  it("有効なプローブに応じて質問を組み立てる", () => {
    const { state, questions } = buildQuestions(normalizeRequest({ ...base, word: "海", context: "日本の感覚で" }));
    expect(state).toEqual({ word: "海", context: "日本の感覚で" });
    expect(Object.keys(questions).sort()).toEqual(["choice", "choice_swapped", "noul_a", "noul_b", "scale"]);
    expect(Object.keys((questions.choice as { criteria: object }).criteria)).toEqual(["夏", "冬"]);
    expect(Object.keys((questions.choice_swapped as { criteria: object }).criteria)).toEqual(["冬", "夏"]);
  });

  it("プローブを無効にすると choice だけになる", () => {
    const { questions } = buildQuestions(
      normalizeRequest({ ...base, word: "海", probes: { swap: false, noul: false, score: false } }),
    );
    expect(Object.keys(questions)).toEqual(["choice"]);
  });
});

describe("summarize", () => {
  it("すべて A を指せば一致して A と判定する", () => {
    const s = summarize(
      { chosen: "A", pA: 0.9, pB: 0.1, confidence: 0.9 },
      { chosen: "A", pA: 0.8, pB: 0.2, confidence: 0.8 },
      { a: 0.9, b: 0.1, leanA: 0.9 },
      { score: 0.4, leanA: 0.9, confidence: 0.8, probabilities: {} },
    );
    expect(s.verdict).toBe("A");
    expect(s.consistent).toBe(true);
    expect(s.positionBias).toBeCloseTo(0.1);
  });

  it("プローブが食い違えばゆらぎありにする", () => {
    const s = summarize(
      { chosen: "A", pA: 0.7, pB: 0.3, confidence: 0.7 },
      { chosen: "B", pA: 0.3, pB: 0.7, confidence: 0.7 },
      null,
      null,
    );
    expect(s.consistent).toBe(false);
    expect(s.verdict).toBe("tie");
  });
});

describe("judge", () => {
  it("SDK レスポンスを正規化する", async () => {
    const fakeFetch: Fetch = async () =>
      new Response(
        JSON.stringify({
          model: "jev-test",
          usage: { input_tokens: 42, output_tokens: 0 },
          answers: {
            choice: { type: "choice", choice: "冬", confidence: 0.8, probabilities: { 夏: 0.2, 冬: 0.8 } },
            choice_swapped: { type: "choice", choice: "冬", confidence: 0.7, probabilities: { 冬: 0.7, 夏: 0.3 } },
            noul_a: { type: "noul", noul: 0.1 },
            noul_b: { type: "noul", noul: 0.9 },
            scale: { type: "score", score: 3.6, confidence: 0.6, legend: {}, probabilities: { "3": 0.4, "4": 0.6 } },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const client = new TypeSafeClient({ apiKey: "test", fetch: fakeFetch });
    const result = await judge(client, { ...base, word: "こたつ" }, "live");

    expect(result.model).toBe("jev-test");
    expect(result.inputTokens).toBe(42);
    expect(result.choice).toEqual({ chosen: "B", pA: 0.2, pB: 0.8, confidence: 0.8 });
    expect(result.choiceSwapped?.pA).toBe(0.3);
    expect(result.noul?.leanA).toBeCloseTo(0.1);
    expect(result.score?.leanA).toBeCloseTo(0.1);
    expect(result.summary.verdict).toBe("B");
    expect(result.summary.consistent).toBe(true);
    expect(result.summary.positionBias).toBeCloseTo(-0.1);
  });

  it("デモ用 fetch でも同じ経路で動く", async () => {
    const client = new TypeSafeClient({ apiKey: "demo", fetch: demoFetch, defaultModel: "demo-jev" });
    const first = await judge(client, { ...base, word: "花火" }, "demo");
    const second = await judge(client, { ...base, word: "花火" }, "demo");
    expect(first.model).toBe("demo-jev");
    expect(first.summary.leanA).toBe(second.summary.leanA);
    expect(first.summary.leanA).toBeGreaterThanOrEqual(0);
    expect(first.summary.leanA).toBeLessThanOrEqual(1);
  });
});
