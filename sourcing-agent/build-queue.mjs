import fs from "node:fs/promises";
import path from "node:path";
import { buildQueueCsv, parseBatchMarkdown, selectRepresentativeTasks } from "./queue-core.mjs";

function argumentsMap(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    values[key.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return values;
}

function safeName(value) {
  return String(value || "batch").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^_+|_+$/g, "") || "batch";
}

const args = argumentsMap(process.argv.slice(2));
if (!args.input) {
  console.error("用法：node sourcing-agent/build-queue.mjs --input <批量扫描.md> [--output sourcing-agent/data] [--limit 10]");
  process.exitCode = 1;
} else {
  const inputPath = path.resolve(String(args.input));
  const outputDir = path.resolve(String(args.output || "sourcing-agent/data"));
  const limit = Math.max(1, Number(args.limit || 10));
  const markdown = await fs.readFile(inputPath, "utf8");
  const queue = parseBatchMarkdown(markdown);
  if (!queue.tasks.length) throw new Error("输入文件中没有可用的符合要求商品。");
  const sampleTasks = selectRepresentativeTasks(queue.tasks, Math.min(limit, queue.tasks.length));
  const baseName = safeName(queue.batch.batchId || path.basename(inputPath, path.extname(inputPath)));
  const allQueue = { ...queue, selection: { strategy: "all", count: queue.tasks.length } };
  const sampleQueue = {
    ...queue,
    summary: { ...queue.summary, parsedProductCount: sampleTasks.length, pendingEnrichmentCount: sampleTasks.length },
    selection: { strategy: "representative", requestedLimit: limit, count: sampleTasks.length },
    tasks: sampleTasks,
  };
  await fs.mkdir(outputDir, { recursive: true });
  const outputs = {
    allJson: path.join(outputDir, `${baseName}-all.json`),
    sampleJson: path.join(outputDir, `${baseName}-sample-${sampleTasks.length}.json`),
    sampleCsv: path.join(outputDir, `${baseName}-sample-${sampleTasks.length}.csv`),
  };
  await Promise.all([
    fs.writeFile(outputs.allJson, `${JSON.stringify(allQueue, null, 2)}\n`, "utf8"),
    fs.writeFile(outputs.sampleJson, `${JSON.stringify(sampleQueue, null, 2)}\n`, "utf8"),
    fs.writeFile(outputs.sampleCsv, `\uFEFF${buildQueueCsv(sampleTasks)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify({ input: inputPath, outputDir, parsed: queue.tasks.length, selected: sampleTasks.length, outputs }, null, 2));
}
