import type {
  BatchItem,
  BatchRequest,
  JudgeRequest,
  JudgeResult,
  ScoreProbe,
  StatusResponse,
} from "../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);

interface Preset {
  name: string;
  a: string;
  b: string;
  aDesc?: string;
  bDesc?: string;
  words: string[];
}

const PRESETS: Preset[] = [
  { name: "夏 / 冬", a: "夏", b: "冬", words: ["花火", "こたつ", "スイカ", "雪だるま", "風鈴", "おでん", "海", "マフラー", "かき氷", "ラーメン", "青", "静けさ"] },
  { name: "ブーバ / キキ", a: "ブーバ", b: "キキ", aDesc: "丸くて柔らかい形", bDesc: "尖ってギザギザした形", words: ["マシュマロ", "稲妻", "雲", "サボテン", "ボール", "ナイフ", "もち", "星", "クッション", "ガラスの破片"] },
  { name: "犬 / 猫", a: "犬", b: "猫", words: ["忠実", "気まぐれ", "散歩", "こたつ", "フリスビー", "ツンデレ", "番犬", "肉球", "しっぽを振る", "マイペース"] },
  { name: "和 / 洋", a: "和", b: "洋", aDesc: "日本的・伝統的", bDesc: "西洋的", words: ["畳", "ソファ", "抹茶", "チーズ", "着物", "ドレス", "味噌汁", "スープ", "茶道", "ワイン"] },
  { name: "明るい / 暗い", a: "明るい", b: "暗い", words: ["朝", "深海", "ひまわり", "墓地", "笑顔", "雨", "ジャズ", "月", "カラオケ", "図書館"] },
  { name: "男性的 / 女性的", a: "男性的", b: "女性的", words: ["ピンク", "ネクタイ", "花束", "筋肉", "料理", "サッカー", "リボン", "工具"] },
];

// ---------------------------------------------------------------- 状態

let history: JudgeResult[] = [];
let lastBatch: BatchItem[] = [];
let batchSort: "input" | "leanA" | "bias" = "input";

// ---------------------------------------------------------------- 初期化

void init();

async function init() {
  renderPresets();
  setupTabs();
  $("single-form").addEventListener("submit", onSingleSubmit);
  $("batch-form").addEventListener("submit", onBatchSubmit);
  $("words").addEventListener("input", updateBatchCount);
  $("history-clear").addEventListener("click", () => {
    history = [];
    renderHistory();
  });
  input("words").value = PRESETS[0].words.join("\n");
  updateBatchCount();

  try {
    const status = await api<StatusResponse>("GET", "/api/status");
    const badge = $("mode-badge");
    badge.textContent = status.mode === "live" ? "LIVE: Jev API" : "DEMO: 疑似レスポンス";
    badge.className = `badge ${status.mode}`;
    badge.title =
      status.mode === "live"
        ? "入力内容は TypeSafe API へ送信されます。"
        : "TYPESAFE_API_KEY が未設定のため、ローカルの疑似レスポンスを返します。";
    input("model").placeholder = status.defaultModel;
    const models = await api<{ name: string; description: string }[]>("GET", "/api/models");
    $("model-list").innerHTML = models.map((m) => `<option value="${esc(m.name)}">${esc(m.description)}</option>`).join("");
  } catch (error) {
    $("mode-badge").textContent = "サーバーに接続できません";
    console.error(error);
  }
}

function renderPresets() {
  const wrap = $("presets");
  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = preset.name;
    button.addEventListener("click", () => {
      input("a-label").value = preset.a;
      input("b-label").value = preset.b;
      input("a-desc").value = preset.aDesc ?? "";
      input("b-desc").value = preset.bDesc ?? "";
      input("words").value = preset.words.join("\n");
      updateBatchCount();
    });
    wrap.append(button);
  }
}

function setupTabs() {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-tab]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      for (const other of buttons) {
        const selected = other === button;
        other.setAttribute("aria-selected", String(selected));
        $(`tab-${other.dataset.tab}`).hidden = !selected;
      }
    });
  }
}

// ---------------------------------------------------------------- API

async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

function baseRequest(): Omit<JudgeRequest, "word"> {
  return {
    optionA: { label: input("a-label").value, description: input("a-desc").value },
    optionB: { label: input("b-label").value, description: input("b-desc").value },
    context: input("context").value,
    model: input("model").value,
    probes: {
      swap: input("probe-swap").checked,
      noul: input("probe-noul").checked,
      score: input("probe-score").checked,
    },
  };
}

// ---------------------------------------------------------------- 単発判定

async function onSingleSubmit(event: Event) {
  event.preventDefault();
  const word = input("word").value.trim();
  if (!word) return;
  const target = $("single-result");
  const button = (event.target as HTMLFormElement).querySelector("button")!;
  button.disabled = true;
  target.innerHTML = `<div class="card muted">「${esc(word)}」を判定しています…</div>`;
  try {
    const result = await api<JudgeResult>("POST", "/api/judge", { ...baseRequest(), word });
    target.innerHTML = renderResult(result);
    history.unshift(result);
    renderHistory();
    input("word").select();
  } catch (error) {
    target.innerHTML = `<div class="card error">${esc(String((error as Error).message))}</div>`;
  } finally {
    button.disabled = false;
  }
}

function renderResult(r: JudgeResult): string {
  const a = r.optionA.label;
  const b = r.optionB.label;
  const s = r.summary;
  const verdictLabel = s.verdict === "tie" ? "どちらとも言えない" : s.verdict === "A" ? a : b;
  const verdictClass = s.verdict === "tie" ? "tie" : s.verdict.toLowerCase();

  const rows: string[] = [];
  rows.push(
    probeRow(
      "choice",
      "A, B の順で提示",
      r.choice.pA,
      r.choice.pB,
      `選択: <b>${esc(r.choice.chosen === "A" ? a : b)}</b> / confidence ${pct(r.choice.confidence)}`,
    ),
  );
  if (r.choiceSwapped) {
    rows.push(
      probeRow(
        "choice（入替）",
        "B, A の順で提示",
        r.choiceSwapped.pA,
        r.choiceSwapped.pB,
        `選択: <b>${esc(r.choiceSwapped.chosen === "A" ? a : b)}</b> / confidence ${pct(r.choiceSwapped.confidence)}`,
      ),
    );
  }
  if (r.noul) {
    rows.push(
      probeRow(
        "noul",
        "A・B を別々に Yes/No で質問",
        r.noul.leanA,
        1 - r.noul.leanA,
        `「${esc(a)}をイメージさせる」${pct(r.noul.a)} / 「${esc(b)}をイメージさせる」${pct(r.noul.b)}`,
      ),
    );
  }
  if (r.score) {
    rows.push(
      probeRow(
        "score",
        "5段階スケール",
        r.score.leanA,
        1 - r.score.leanA,
        `期待スコア ${r.score.score.toFixed(2)} / 4 / confidence ${pct(r.score.confidence)}${scoreDist(r.score, a, b)}`,
      ),
    );
  }

  const bias =
    s.positionBias === null
      ? ""
      : `<div class="stat"><span>位置バイアス</span><b class="${Math.abs(s.positionBias) >= 0.1 ? "warn" : ""}">${signed(s.positionBias)}</b></div>`;

  return `
    <article class="card result">
      <div class="verdict">
        <div class="word">「${esc(r.word)}」</div>
        <div class="arrow">→</div>
        <div class="answer ${verdictClass}">${esc(verdictLabel)}</div>
        <span class="pill ${s.consistent ? "ok" : "warn"}">${s.consistent ? "全プローブ一致" : "ゆらぎあり"}</span>
      </div>
      ${balance(s.leanA, a, b, true)}
      <div class="stats">
        <div class="stat"><span>${esc(a)} 寄り度</span><b>${pct(s.leanA)}</b></div>
        ${bias}
        <div class="stat"><span>応答時間</span><b>${r.latencyMs} ms</b></div>
        <div class="stat"><span>入力トークン</span><b>${r.inputTokens ?? "—"}</b></div>
        <div class="stat"><span>モデル</span><b>${esc(r.model)}</b></div>
      </div>
      <h3>プローブ別の結果</h3>
      <div class="probes">${rows.join("")}</div>
      <details>
        <summary>Jev に送ったリクエスト</summary>
        <pre>${esc(JSON.stringify(r.request, null, 2))}</pre>
      </details>
      <details>
        <summary>Jev から返ってきた answers</summary>
        <pre>${esc(JSON.stringify(r.rawAnswers, null, 2))}</pre>
      </details>
      ${r.mode === "demo" ? `<p class="muted small">※ デモモードの疑似値です。Jev の本当の判定ではありません。</p>` : ""}
    </article>`;
}

function probeRow(name: string, hint: string, pA: number, pB: number, detail: string): string {
  const total = pA + pB || 1;
  return `
    <div class="probe">
      <div class="probe-head"><b>${esc(name)}</b><span class="muted">${esc(hint)}</span></div>
      <div class="bar">
        <div class="bar-a" style="width:${(pA / total) * 100}%">${pct(pA)}</div>
        <div class="bar-b" style="width:${(pB / total) * 100}%">${pct(pB)}</div>
      </div>
      <div class="probe-detail">${detail}</div>
    </div>`;
}

function scoreDist(score: ScoreProbe, a: string, b: string): string {
  const labels = [`明らかに${a}`, `やや${a}`, "中間", `やや${b}`, `明らかに${b}`];
  const cells = labels
    .map((label, index) => {
      const p = score.probabilities[String(index)] ?? 0;
      return `<div class="dist-cell"><div class="dist-bar" style="height:${Math.max(p * 100, 2)}%"></div><span>${esc(label)}</span><small>${pct(p)}</small></div>`;
    })
    .join("");
  return `<div class="dist">${cells}</div>`;
}

function balance(leanA: number, a: string, b: string, large = false): string {
  return `
    <div class="balance ${large ? "large" : ""}" title="${esc(a)} ${pct(leanA)} / ${esc(b)} ${pct(1 - leanA)}">
      ${large ? `<span class="end a">${esc(a)}</span>` : ""}
      <div class="track"><div class="fill" style="width:${leanA * 100}%"></div><div class="mid"></div></div>
      ${large ? `<span class="end b">${esc(b)}</span>` : ""}
    </div>`;
}

function renderHistory() {
  $("history-wrap").hidden = history.length === 0;
  $("history").innerHTML = history
    .map((r) => {
      const s = r.summary;
      const label = s.verdict === "tie" ? "拮抗" : s.verdict === "A" ? r.optionA.label : r.optionB.label;
      return `
        <div class="history-row">
          <span class="h-word">${esc(r.word)}</span>
          <span class="muted small">${esc(r.optionA.label)} / ${esc(r.optionB.label)}</span>
          ${balance(s.leanA, r.optionA.label, r.optionB.label)}
          <span class="h-verdict ${s.verdict.toLowerCase()}">${esc(label)}</span>
          <span class="pill ${s.consistent ? "ok" : "warn"}">${s.consistent ? "一致" : "ゆらぎ"}</span>
        </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------- 一括判定

function parseWords(): string[] {
  return [
    ...new Set(
      input("words")
        .value.split(/[\n,、]/)
        .map((w) => w.trim())
        .filter(Boolean),
    ),
  ];
}

function updateBatchCount() {
  const count = parseWords().length;
  $("batch-count").textContent = `${count}語`;
}

async function onBatchSubmit(event: Event) {
  event.preventDefault();
  const words = parseWords();
  if (words.length === 0) return;
  const target = $("batch-result");
  const button = (event.target as HTMLFormElement).querySelector("button")!;
  button.disabled = true;
  target.innerHTML = `<div class="card muted">${words.length}語を判定しています…</div>`;
  try {
    const body: BatchRequest = { ...baseRequest(), words };
    lastBatch = await api<BatchItem[]>("POST", "/api/batch", body);
    batchSort = "input";
    renderBatch();
  } catch (error) {
    target.innerHTML = `<div class="card error">${esc(String((error as Error).message))}</div>`;
  } finally {
    button.disabled = false;
  }
}

function renderBatch() {
  const target = $("batch-result");
  const ok = lastBatch.filter((i) => i.result).map((i) => i.result!);
  if (lastBatch.length === 0) {
    target.innerHTML = "";
    return;
  }
  const first = ok[0];
  const a = first?.optionA.label ?? "A";
  const b = first?.optionB.label ?? "B";
  const count = (pred: (r: JudgeResult) => boolean) => ok.filter(pred).length;
  const avgLatency = ok.length ? Math.round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length) : 0;
  const biases = ok.map((r) => r.summary.positionBias).filter((v): v is number => v !== null);
  const avgBias = biases.length ? biases.reduce((s, v) => s + Math.abs(v), 0) / biases.length : null;

  const items = [...lastBatch];
  if (batchSort === "leanA") items.sort((x, y) => (y.result?.summary.leanA ?? -1) - (x.result?.summary.leanA ?? -1));
  if (batchSort === "bias")
    items.sort((x, y) => Math.abs(y.result?.summary.positionBias ?? 0) - Math.abs(x.result?.summary.positionBias ?? 0));

  const rows = items
    .map((item) => {
      if (!item.result) {
        return `<tr><td>${esc(item.word)}</td><td colspan="8" class="error">${esc(item.error ?? "失敗")}</td></tr>`;
      }
      const r = item.result;
      const s = r.summary;
      const label = s.verdict === "tie" ? "拮抗" : s.verdict === "A" ? a : b;
      return `
        <tr>
          <td class="t-word">${esc(r.word)}</td>
          <td><span class="h-verdict ${s.verdict.toLowerCase()}">${esc(label)}</span></td>
          <td class="t-balance">${balance(s.leanA, a, b)}<small>${pct(s.leanA)}</small></td>
          <td>${pct(r.choice.pA)}</td>
          <td>${r.choiceSwapped ? pct(r.choiceSwapped.pA) : "—"}</td>
          <td>${r.noul ? `${pct(r.noul.a)} / ${pct(r.noul.b)}` : "—"}</td>
          <td>${r.score ? r.score.score.toFixed(2) : "—"}</td>
          <td><span class="pill ${s.consistent ? "ok" : "warn"}">${s.consistent ? "一致" : "ゆらぎ"}</span></td>
          <td class="${s.positionBias !== null && Math.abs(s.positionBias) >= 0.1 ? "warn" : ""}">${s.positionBias === null ? "—" : signed(s.positionBias)}</td>
        </tr>`;
    })
    .join("");

  target.innerHTML = `
    <div class="card">
      <div class="stats">
        <div class="stat"><span>${esc(a)} 寄り</span><b class="a">${count((r) => r.summary.verdict === "A")}</b></div>
        <div class="stat"><span>${esc(b)} 寄り</span><b class="b">${count((r) => r.summary.verdict === "B")}</b></div>
        <div class="stat"><span>拮抗</span><b>${count((r) => r.summary.verdict === "tie")}</b></div>
        <div class="stat"><span>ゆらぎあり</span><b class="warn">${count((r) => !r.summary.consistent)}</b></div>
        <div class="stat"><span>平均|位置バイアス|</span><b>${avgBias === null ? "—" : pct(avgBias)}</b></div>
        <div class="stat"><span>平均応答時間</span><b>${avgLatency} ms</b></div>
      </div>
      <div class="row end">
        <label class="muted small">並び替え
          <select id="batch-sort">
            <option value="input" ${batchSort === "input" ? "selected" : ""}>入力順</option>
            <option value="leanA" ${batchSort === "leanA" ? "selected" : ""}>${esc(a)} 寄り順</option>
            <option value="bias" ${batchSort === "bias" ? "selected" : ""}>位置バイアスが大きい順</option>
          </select>
        </label>
        <button class="ghost" id="dl-csv">CSV</button>
        <button class="ghost" id="dl-json">JSON</button>
      </div>
      <div class="table-wrap">
        <table class="batch">
          <thead><tr>
            <th>単語</th><th>総合判定</th><th>${esc(a)} ← → ${esc(b)}</th>
            <th>choice P(${esc(a)})</th><th>入替 P(${esc(a)})</th><th>noul ${esc(a)} / ${esc(b)}</th>
            <th>score (0=${esc(a)}〜4=${esc(b)})</th><th>一貫性</th><th>位置バイアス</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${first?.mode === "demo" ? `<p class="muted small">※ デモモードの疑似値です。Jev の本当の判定ではありません。</p>` : ""}
    </div>`;

  $<HTMLSelectElement>("batch-sort").addEventListener("change", (e) => {
    batchSort = (e.target as HTMLSelectElement).value as typeof batchSort;
    renderBatch();
  });
  $("dl-csv").addEventListener("click", () => download("jev-batch.csv", toCsv(ok), "text/csv"));
  $("dl-json").addEventListener("click", () =>
    download("jev-batch.json", JSON.stringify(lastBatch, null, 2), "application/json"),
  );
}

function toCsv(results: JudgeResult[]): string {
  const header = [
    "word", "optionA", "optionB", "verdict", "leanA", "consistent", "positionBias",
    "choice_pA", "choice_pB", "choice_confidence", "swapped_pA", "noul_a", "noul_b",
    "score", "score_confidence", "latencyMs", "model",
  ];
  const cell = (v: unknown) => {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = results.map((r) =>
    [
      r.word, r.optionA.label, r.optionB.label, r.summary.verdict, r.summary.leanA, r.summary.consistent,
      r.summary.positionBias, r.choice.pA, r.choice.pB, r.choice.confidence, r.choiceSwapped?.pA,
      r.noul?.a, r.noul?.b, r.score?.score, r.score?.confidence, r.latencyMs, r.model,
    ]
      .map(cell)
      .join(","),
  );
  // Excel で文字化けしないよう BOM を付ける。
  return `﻿${[header.join(","), ...lines].join("\n")}`;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- ユーティリティ

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function signed(v: number): string {
  const p = Math.round(v * 100);
  return `${p > 0 ? "+" : ""}${p}pt`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
