import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APIConnectionError, APIError, TypeSafeClient, TypeSafeError } from "@typesafe-ai/sdk";
import express, { type NextFunction, type Request, type Response } from "express";
import type { BatchItem, BatchRequest, JudgeRequest, Mode, StatusResponse } from "../shared/types.js";
import { demoFetch } from "./demoFetch.js";
import { judge, ValidationError } from "./judge.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BATCH = 100;
const BATCH_CONCURRENCY = 4;

const hasKey = Boolean(process.env.TYPESAFE_API_KEY?.trim());
const mode: Mode = hasKey && process.env.JEV_DEMO !== "1" ? "live" : "demo";

// デモモードでは偽の fetch を差し込み、キーはダミーにする。
const client =
  mode === "live" ? new TypeSafeClient() : new TypeSafeClient({ apiKey: "demo", fetch: demoFetch, defaultModel: "demo-jev" });

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/api/status", (_req, res) => {
  const body: StatusResponse = { mode, defaultModel: client.defaultModel };
  res.json(body);
});

app.get("/api/models", async (_req, res, next) => {
  try {
    res.json(await client.models.list());
  } catch (error) {
    next(error);
  }
});

app.post("/api/judge", async (req: Request<unknown, unknown, JudgeRequest>, res, next) => {
  try {
    res.json(await judge(client, req.body, mode));
  } catch (error) {
    next(error);
  }
});

app.post("/api/batch", async (req: Request<unknown, unknown, BatchRequest>, res, next) => {
  try {
    const { words, ...rest } = req.body ?? ({} as BatchRequest);
    const list = [...new Set((Array.isArray(words) ? words : []).map((w) => String(w).trim()).filter(Boolean))];
    if (list.length === 0) throw new ValidationError("単語を1つ以上入力してください。");
    if (list.length > MAX_BATCH) throw new ValidationError(`一度に判定できるのは${MAX_BATCH}語までです。`);

    // 1 語 = 1 リクエスト（state が単語ごとに違うため）。同時実行数を絞って順に投げる。
    const items: BatchItem[] = list.map((word) => ({ word }));
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        try {
          item.result = await judge(client, { ...rest, word: item.word }, mode);
        } catch (error) {
          if (error instanceof ValidationError) throw error;
          item.error = describeError(error).message;
        }
      }
    };
    await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));
    res.json(items);
  } catch (error) {
    next(error);
  }
});

function describeError(error: unknown): { status: number; message: string } {
  if (error instanceof ValidationError) return { status: 400, message: error.message };
  if (error instanceof APIError) {
    const detail = typeof error.body === "string" ? error.body : JSON.stringify(error.body);
    return { status: 502, message: `TypeSafe API エラー (${error.status}): ${detail}` };
  }
  if (error instanceof APIConnectionError) return { status: 502, message: `TypeSafe API に接続できません: ${error.message}` };
  if (error instanceof TypeSafeError) return { status: 500, message: error.message };
  return { status: 500, message: error instanceof Error ? error.message : String(error) };
}

app.use("/api", (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const { status, message } = describeError(error);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: message });
});

// ビルド済みのフロントエンドがあれば配信する（開発時は Vite が配信する）。
const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/client");
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Jev イメージ判定ラボ: http://localhost:${PORT} (mode: ${mode})`);
  if (mode === "demo") console.log("TYPESAFE_API_KEY が未設定のためデモモードで起動しました。");
});
