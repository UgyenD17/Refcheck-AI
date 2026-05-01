import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const reportDir = path.join(rootDir, "data", "reports");

export async function saveReport(report) {
  const id = `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    id,
    created_at: new Date().toISOString(),
    ...report
  };

  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, `${id}.json`), JSON.stringify(payload, null, 2));
  return payload;
}

export async function loadReport(id) {
  const safeId = String(id || "").replace(/[^a-zA-Z0-9-]/g, "");
  if (!safeId) {
    const error = new Error("Report id is required.");
    error.statusCode = 400;
    throw error;
  }

  try {
    return JSON.parse(await readFile(path.join(reportDir, `${safeId}.json`), "utf8"));
  } catch (error) {
    const wrapped = new Error("Report not found.");
    wrapped.statusCode = 404;
    wrapped.cause = error;
    throw wrapped;
  }
}
