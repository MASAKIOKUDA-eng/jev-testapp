import type { Fetch, SystemOneRequestPayload } from "@typesafe-ai/sdk";

/**
 * API キー無しで画面を試すための偽の TypeSafe API。
 *
 * SDK の `fetch` オプションに差し込むので、アプリ側のコードは本番と同じ経路を通る。
 * 値は state とラベルのハッシュから決まる決定論的な乱数で、意味のある判定ではない。
 */
export const demoFetch: Fetch = async (input, init) => {
  const path = new URL(input).pathname;

  if (path === "/v1/models" && (init?.method ?? "GET") === "GET") {
    return json({
      models: [{ name: "demo-jev", description: "ローカルの疑似レスポンス（デモ用）", release_date: "2026-09-01" }],
    });
  }

  if (path === "/v1/systemone" && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as SystemOneRequestPayload;
    const seed = JSON.stringify(body.state);
    const answers: Record<string, unknown> = {};

    for (const [name, question] of Object.entries(body.questions)) {
      if (question.type === "noul") {
        answers[name] = { type: "noul", noul: round(unit(`${seed}|${JSON.stringify(question.instructions)}`)) };
      } else if (question.type === "choice") {
        const labels = Object.keys(question.criteria);
        // 並び順の影響を少しだけ再現するため、先頭の選択肢をわずかに優遇する。
        const weights = labels.map((label, index) => unit(`${seed}|${label}`) + (index === 0 ? 0.08 : 0));
        const probabilities = normalize(labels, weights);
        const best = labels.reduce((a, b) => (probabilities[a] >= probabilities[b] ? a : b));
        answers[name] = {
          type: "choice",
          choice: best,
          confidence: round(probabilities[best]),
          probabilities,
        };
      } else {
        const levels = question.criteria.map((_, index) => String(index));
        const peak = unit(`${seed}|${JSON.stringify(question.instructions)}`) * (levels.length - 1);
        const weights = levels.map((_, index) => Math.exp(-((index - peak) ** 2)));
        const probabilities = normalize(levels, weights);
        const expected = levels.reduce((sum, level) => sum + Number(level) * probabilities[level], 0);
        answers[name] = {
          type: "score",
          score: round(expected),
          confidence: round(Math.max(...Object.values(probabilities))),
          legend: Object.fromEntries(levels.map((level, index) => [level, question.criteria[index]])),
          probabilities,
        };
      }
    }

    // 実際の API ほど速くはないが、待ち時間の表示を確認できる程度に遅延させる。
    await new Promise((resolve) => setTimeout(resolve, 60 + (hash(seed) % 90)));
    return json({ model: "demo-jev", answers, usage: { input_tokens: Math.ceil(String(init.body).length / 4), output_tokens: 0 } });
  }

  return json({ error: { message: `demo: unknown endpoint ${path}` } }, 404);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function hash(text: string): number {
  // FNV-1a 32bit
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function unit(text: string): number {
  return hash(text) / 0xffffffff;
}

function normalize(keys: string[], weights: number[]): Record<string, number> {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(keys.map((key, index) => [key, round(weights[index] / total)]));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
