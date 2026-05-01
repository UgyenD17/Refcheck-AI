import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCall, analyzeClip } from "./rag/analyzer.js";
import { loadRules } from "./rag/ruleStore.js";
import { loadReport, saveReport } from "./reports.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4"
};
const MAX_JSON_BYTES = 12 * 1024 * 1024;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) chunks.push(chunk);
  for (const chunk of chunks) size += chunk.length;
  if (size > MAX_JSON_BYTES) {
    const error = new Error("Request is too large. Try a shorter clip or fewer sampled frames.");
    error.statusCode = 413;
    throw error;
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const contentType = CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
    if (path.extname(filePath) === ".mp4") {
      const fileStat = await stat(filePath);
      const range = req.headers.range;

      if (range) {
        const [startPart, endPart] = range.replace(/bytes=/, "").split("-");
        const start = Number.parseInt(startPart, 10);
        const end = endPart ? Number.parseInt(endPart, 10) : fileStat.size - 1;

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          "Content-Type": contentType
        });
        createReadStream(filePath, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        "Accept-Ranges": "bytes",
        "Content-Length": fileStat.size,
        "Content-Type": contentType
      });
      createReadStream(filePath).pipe(res);
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, app: "RefCheck AI" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/rules/soccer/status") {
      const rules = await loadRules("soccer");
      sendJson(res, 200, { sport: "soccer", chunks: rules.length });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/analyze-call") {
      const input = await readJson(req);
      const result = await analyzeCall(input);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/analyze-clip") {
      const input = await readJson(req);
      const analysis = await analyzeClip(input);
      const report = await saveReport({
        type: "clip_review",
        sport: input.sport,
        original_call: input.original_call,
        play_description: input.play_description || "",
        clip: input.clip || {},
        analysis
      });
      sendJson(res, 200, report);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/reports/")) {
      const reportId = url.pathname.split("/").pop();
      const report = await loadReport(reportId);
      sendJson(res, 200, report);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, {
      error: error.message || "Unexpected server error"
    });
  }
});

server.listen(port, host, () => {
  console.log(`RefCheck AI running at http://${host}:${port}`);
});
