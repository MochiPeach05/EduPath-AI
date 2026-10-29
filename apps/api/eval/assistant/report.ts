// docs/assistant-evaluation.md from the raw results of run.ts (meta, questions, retrieval, prompts and generation JSON
// in its output directory). Every answer is scored again here (score.ts), so a corrected expectation needs no new answer.
// Run alone to write the report again: npx tsx eval/assistant/report.ts --out=<the directory run.ts wrote>
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codesIn } from "../../src/assistant/validate.js";
import { EVAL_FUNCTIONS, type EvalFunction, type EvalQuestion } from "./questions.js";
import type { Condition, GenerationRow, RetrievalRow } from "./run.js";
import { scoreAnswer } from "./score.js";

type GenerationSettings = { think: boolean; options: Record<string, number> };
type Meta = {
  startedAt: string; finishedAt?: string; promptVersion: string; systemPromptSha: string; assemblyDrift: string[];
  ollama: { version: string; chat: { name: string; digest: string; parameter_size?: string; quantization_level?: string }; embedding: { name: string; digest: string; parameter_size?: string; quantization_level?: string } };
  options: { A: GenerationSettings; B: GenerationSettings; C: GenerationSettings; numGpu: number };
  search: { knowledgeResults: number; resourceResults: number; ownStandardResults: number; rrfK: number; minCosine: number };
  index: { chunks: number; embedded: number; refresh: { inserted: number; updated: number; deleted: number; total: number }; refreshMs: number;
    embedding: { embedded: number; batches: number; ms: number }; kinds: { kind: string; chunks: number; embedded: number }[] };
  catalog: {
    curricula: string[]; plans: string[]; standards: number; standardCohorts?: string[]; careers: number; skills: number; fields: number;
    ownStandard: { id: string; name: string | null } | null;
  };
  resources: { present: boolean; checkedAt: string | null; skills: number; resources: number };
  queryEmbedding: { questions: number; batchMs: number; singleMs: number[] };
  hardware: { gpu: string; cpu: string; ramGb: number };
  diagnostics?: {
    gapSkills: string[]; resourceSearch: { question: string; withQuestion: string[]; namesOnly: string[] };
    intentProbes: { text: string; intents: string[] }[]; testCareers: string[];
  };
};
type PromptInfo = {
  prepareMs: number; intents: string[]; sources: { n: number; kind: string; title: string }[]; knowledge: { kind: string; key: string }[];
  allowedUrls: string[]; knownCodes: string[]; hashA?: string; hashB?: string; hashC?: string;
};

const FUNCTION_NAMES: Record<EvalFunction, string> = {
  "CHAT-01": "Giải thích khoảng trống kỹ năng",
  "CHAT-02": "Tư vấn lộ trình học tập",
  "CHAT-03": "Hỏi đáp (danh mục, hướng dẫn)",
  "CHAT-04": "Lý do đề xuất môn học",
  "CHAT-05": "Tài nguyên tự học",
  out_of_scope: "Ngoài phạm vi",
};
const CONDITION_NAMES: Record<Condition, string> = {
  A: "A, không ngữ cảnh", B: "B, RAG không thinking", C: "C, RAG có thinking (chạy thật)", A0: "A0, câu hỏi trần",
};
const BASIS_NAMES: Record<string, string> = { personal: "sinh viên giả lập", catalog: "danh mục CSDL local", guide: "hướng dẫn cổng", none: "—" };
const MODE_NAMES = { lexical: "Từ khóa (BM25)", vector: "Vector (EmbeddingGemma)", hybrid: "Kết hợp (RRF)" } as const;
const KIND_NAMES: Record<string, string> = {
  guide: "hướng dẫn", career: "nghề", field: "lĩnh vực", skill: "kỹ năng", course: "học phần", curriculum: "CTĐT", plan: "KHĐT",
  graduation: "tiêu chuẩn tốt nghiệp", resource: "tài nguyên tự học",
};

const decimal = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const two = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
/** Thousands grouped by a space, as the other docs write them ("7 254 token"); vi-VN groups with "." and never uses it as the decimal point. */
const spaced = (text: string) => text.replace(/\./g, " ");
const n1 = (value: number | null) => (value === null || !Number.isFinite(value) ? "—" : spaced(decimal.format(value)));
const n0 = (value: number | null) => (value === null || !Number.isFinite(value) ? "—" : spaced(whole.format(value)));
const pct = (count: number, total: number) => (total ? `${count}/${total} (${Math.round((100 * count) / total)}%)` : "—");
const seconds = (millis: number | null) => (millis === null ? "—" : `${spaced(decimal.format(millis / 1000))} giây`);
function quantile(values: readonly number[], q: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}
const median = (values: readonly number[]) => quantile(values, 0.5);
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const dateText = (iso: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
/** A short form of the expected answer: each group's first alternatives. */
const expectText = (question: EvalQuestion) => {
  if (!question.expect.length) return question.function === "out_of_scope" ? "từ chối, không link" : "—";
  const text = question.expect.map((group) => group.slice(0, 2).join(" / ")).join(" + ");
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
};
/** An answer as a block quote, cut at `max` characters. */
function quote(text: string, max = 420): string {
  const short = text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")} …` : text;
  return short.split("\n").filter((line) => line.trim()).map((line) => `> ${line}`).join("\n");
}

/**
 * Every answer scored again with the current questions (score.ts): the check context is the prompt's (B, C) or the
 * question and its conversation (A, A0).
 */
function rescore(rows: readonly GenerationRow[], questions: ReadonlyMap<string, EvalQuestion>, prompts: Readonly<Record<string, PromptInfo>>): GenerationRow[] {
  return rows.flatMap((row) => {
    const item = questions.get(row.id);
    const prompt = prompts[row.id];
    if (!item || !prompt) return [];
    const withData = row.condition === "B" || row.condition === "C";
    const context = withData
      ? { sourceCount: prompt.sources.length, allowedUrls: prompt.allowedUrls, knownCodes: prompt.knownCodes }
      : { sourceCount: 0, allowedUrls: [], knownCodes: codesIn([item.question, ...item.history.map((turn) => turn.content)].join("\n")) };
    return [{ ...row, score: scoreAnswer(item, row.answer, context, !withData) }];
  });
}

export async function writeReport(outDir: string, docFile: string | URL): Promise<void> {
  const read = async <T>(name: string): Promise<T> => JSON.parse(await readFile(join(outDir, name), "utf8")) as T;
  const meta = await read<Meta>("meta.json");
  const everyQuestion = await read<EvalQuestion[]>("questions.json");
  const questions = everyQuestion.filter((item) => item.generate);
  const variants = everyQuestion.filter((item) => !item.generate);
  const retrieval = await read<RetrievalRow[]>("retrieval.json");
  const prompts = await read<Record<string, PromptInfo>>("prompts.json");
  const byQuestion = new Map(questions.map((item) => [item.id, item]));
  const generation = rescore(await read<GenerationRow[]>("generation.json").catch(() => [] as GenerationRow[]), byQuestion, prompts);
  const rows = new Map(generation.map((row) => [`${row.id}|${row.condition}`, row]));
  const answer = (id: string, condition: Condition) => rows.get(`${id}|${condition}`) ?? null;
  const present = (["A", "B", "C"] as const).filter((condition) => generation.some((row) => row.condition === condition));
  const raw = generation.some((row) => row.condition === "A0");
  const answered = present.length ? questions.filter((item) => present.every((condition) => answer(item.id, condition))) : [];
  const inScope = answered.filter((item) => item.function !== "out_of_scope");
  const outOfScope = answered.filter((item) => item.function === "out_of_scope");
  const lines: string[] = [];
  const push = (...items: string[]) => lines.push(...items);

  /* ---- numbers ---- */
  const general = retrieval.filter((row) => row.expect.length && row.scope === "general");
  const originals = general.filter((row) => row.variant === "original");
  const own = retrieval.filter((row) => row.expect.length && row.scope === "own_standard");
  const modes = ["lexical", "vector", "hybrid"] as const;
  type Mode = (typeof modes)[number];
  const recall = (list: RetrievalRow[], mode: Mode) => list.filter((row) => row.modes[mode].rank !== null).length;
  const mrr = (list: RetrievalRow[], mode: Mode) => (list.length ? list.reduce((sum, row) => sum + (row.modes[mode].rank ? 1 / row.modes[mode].rank! : 0), 0) / list.length : 0);
  const top1 = (list: RetrievalRow[], mode: Mode) => list.filter((row) => row.modes[mode].rank === 1).length;
  const scored = (condition: Condition, list: EvalQuestion[]) => list.map((item) => answer(item.id, condition)).filter((row): row is GenerationRow => row !== null);
  const correct = (condition: Condition, list: EvalQuestion[]) => scored(condition, list).filter((row) => row.score.correct === true).length;
  const links = (condition: Condition, list: EvalQuestion[]) => scored(condition, list).reduce((sum, row) => sum + row.score.inventedLinks.length, 0);
  const linkAnswers = (condition: Condition, list: EvalQuestion[]) => scored(condition, list).filter((row) => row.score.inventedLinks.length).length;
  const codes = (condition: Condition, list: EvalQuestion[]) => scored(condition, list).reduce((sum, row) => sum + row.score.unknownCodes.length, 0);
  const codeAnswers = (condition: Condition, list: EvalQuestion[]) => scored(condition, list).filter((row) => row.score.unknownCodes.length).length;
  const cited = (condition: Condition, list: EvalQuestion[]) => scored(condition, list).filter((row) => row.score.cited.length > 0).length;
  const refused = (condition: Condition) => scored(condition, outOfScope).filter((row) => row.score.refused).length;
  const wall = (condition: Condition) => scored(condition, answered).map((row) => row.metrics.wallMs);
  const metric = (condition: Condition, pick: (row: GenerationRow) => number | null | undefined) =>
    scored(condition, answered).map(pick).filter((value): value is number => typeof value === "number");
  const speed = (condition: Condition, tokens: (row: GenerationRow) => number | null, millis: (row: GenerationRow) => number | null) =>
    metric(condition, (row) => { const t = tokens(row); const m = millis(row); return t && m ? t / (m / 1000) : null; });
  const contextRows = retrieval.filter((row) => row.inContext !== null);
  const contextHits = contextRows.filter((row) => row.inContext).length;
  const ragConditions = present.filter((condition) => condition !== "A");
  const shipped: Condition = present.includes("C") ? "C" : "B";
  const settings = (condition: "A" | "B" | "C") => meta.options[condition]
    ? `${meta.options[condition].think ? "thinking bật" : "thinking tắt"}, num_predict ${String(meta.options[condition].options.num_predict)}` : "—";

  /* ---- header and summary ---- */
  push("# Đánh giá chất lượng Trợ lý AI (STU-CHAT-01..05)", "",
    "Tài liệu này đo chất lượng Trợ lý AI ở hai bước: **truy xuất** (tìm đúng dữ liệu) và **câu trả lời** (đúng, có nguồn, không bịa). "
    + "Mọi con số dưới đây do `apps/api/eval/assistant/run.ts` tính và ghi tự động; thiết kế của trợ lý ở `docs/assistant.md`.", "",
    `Lần chạy: ${dateText(meta.startedAt)}, prompt ${meta.promptVersion}. Người dùng yêu cầu ngày 28/10/2026: "triển khai giai đoạn 1, 2, 3 luôn" (giai đoạn 3 là đánh giá chất lượng). `
    + "Từ ngày 29/10/2026 trợ lý chạy với thinking của Gemma (assistant-v2, người dùng: \"nên bật thinking không theo tôi là có đó\"), nên cấu hình chạy thật là **C**.", "");
  if (meta.assemblyDrift.length) push("**Cảnh báo:** khi chạy, `prepareAssistantAnswer` (chat.ts) đã khác phần bộ chạy đánh giá lặp lại; số liệu RAG có thể lệch so với hệ thống thật.", "");
  const stale = generation.filter((row) => {
    const info = prompts[row.id];
    const hash = row.condition === "A" ? info?.hashA : row.condition === "B" ? info?.hashB : row.condition === "C" ? info?.hashC : undefined;
    return hash !== undefined && hash !== row.promptHash;
  });
  if (stale.length) push(`**Cảnh báo:** ${stale.length} câu trả lời được viết từ prompt khác prompt hiện tại (kho tri thức hoặc mã nguồn đã đổi sau lần hỏi Gemma); chạy lại \`run.ts\` để hỏi lại các câu này.`, "");
  push("## Tóm tắt", "");
  if (general.length) {
    push(`- **Truy xuất** (${general.length} câu có đoạn đúng, gồm ${general.length - originals.length} biến thể không dấu, tên tiếng Anh và diễn đạt khác; 6 đoạn): `
      + `recall@6 từ khóa ${pct(recall(general, "lexical"), general.length)}, vector ${pct(recall(general, "vector"), general.length)}, kết hợp ${pct(recall(general, "hybrid"), general.length)}.`);
  }
  if (inScope.length) {
    push(`- **Câu trả lời đúng** (${inScope.length} câu trong phạm vi): ${present.map((condition) => `${CONDITION_NAMES[condition]} ${pct(correct(condition, inScope), inScope.length)}`).join("; ")}.`,
      `- **Link bịa:** ${present.map((condition) => `${condition} ${links(condition, answered)} link (${linkAnswers(condition, answered)} câu)`).join(", ")}. **Mã học phần lạ:** ${present.map((condition) => `${condition} ${codes(condition, answered)} mã (${codeAnswers(condition, answered)} câu)`).join(", ")}.`,
      `- **Dẫn nguồn:** ${ragConditions.map((condition) => `${condition} ${pct(cited(condition, inScope), inScope.length)}`).join(", ")} câu trả lời giữ ít nhất một số nguồn [n] hợp lệ.`,
      `- **Ngoài phạm vi:** từ chối đúng ${present.map((condition) => `${condition} ${refused(condition)}/${outOfScope.length}`).join(", ")}.`,
      `- **Thời gian trả lời** (trung vị, gồm hàng đợi GPU): ${present.map((condition) => `${condition} ${seconds(median(wall(condition)))}`).join(", ")}.`);
  } else {
    push("- Chưa có câu trả lời nào: lần chạy chỉ đo truy xuất (`--skip-generation`).");
  }
  push("");

  /* ---- method ---- */
  const counts = EVAL_FUNCTIONS.map((fn) => ({ fn, list: questions.filter((item) => item.function === fn) }));
  const kinds = meta.index.kinds.map((row) => `${KIND_NAMES[row.kind] ?? row.kind} ${row.chunks}`).join(", ");
  push("## Cách đánh giá", "", "### Dữ liệu",
    `- **Kho tri thức:** dựng lại bằng \`refreshKnowledge\` từ danh mục của CSDL local, ${meta.index.chunks} đoạn (${kinds}); ${meta.index.embedded}/${meta.index.chunks} đoạn có vector EmbeddingGemma.`,
    `- **Danh mục local:** CTĐT ${meta.catalog.curricula.join(", ")} (ngành Công nghệ thông tin), KHĐT ${meta.catalog.plans.join(", ")}, ${meta.catalog.standards} tiêu chuẩn tốt nghiệp${meta.catalog.standardCohorts?.length ? ` (${meta.catalog.standardCohorts.join(", ")})` : ""},${meta.catalog.careers} nghề, ${meta.catalog.fields} lĩnh vực, ${meta.catalog.skills} kỹ năng.`,
    meta.resources.present
      ? `- **Tài nguyên tự học:** \`learning-resources.json\` (kiểm tra link ngày ${meta.resources.checkedAt ?? "?"}), ${meta.resources.skills} kỹ năng, ${meta.resources.resources} tài nguyên.`
      : "- **Tài nguyên tự học:** `learning-resources.json` chưa có khi chạy, nên câu hỏi CHAT-05 về tài nguyên được ghi là chưa đánh giá được.",
    "- **Sinh viên:** sinh viên giả lập K29, chuyên ngành Công nghệ phần mềm (`roadmap/test-fixture.ts`): bảng điểm, kết quả đánh giá năng lực, khảo sát và một Lộ trình AI đều là dữ liệu bịa. Bộ chạy không đọc bảng dữ liệu sinh viên nào.",
    meta.catalog.ownStandard
      ? `- **Tiêu chuẩn tốt nghiệp của sinh viên:** chọn như hệ thống thật (\`resolveCohortStandard\`, K29, CNPM, ngành CNTT) trong CSDL local: ${meta.catalog.ownStandard.name ?? meta.catalog.ownStandard.id}. Trợ lý chỉ đọc tiêu chuẩn này (tìm riêng, tối đa ${meta.search.ownStandardResults} phần).`
      : "- **Tiêu chuẩn tốt nghiệp của sinh viên:** CSDL local không có tiêu chuẩn K29 CNPM, nên trợ lý không có đoạn tiêu chuẩn nào.",
    "", "### Bộ câu hỏi", "",
    "| Chức năng | Số câu | Đáp án lấy từ |", "| --- | --- | --- |",
    ...counts.filter(({ list }) => list.length).map(({ fn, list }) => `| ${fn === "out_of_scope" ? "Ngoài phạm vi" : `STU-${fn} ${FUNCTION_NAMES[fn]}`} | ${list.length} | ${[...new Set(list.map((item) => BASIS_NAMES[item.basis] ?? item.basis))].join(", ")} |`),
    `| **Tổng** | **${questions.length}** | ${questions.filter((item) => item.history.length).length} câu nối tiếp (có hội thoại trước) |`, "",
    "- **Câu hỏi danh mục** được sinh từ CSDL local bằng luật (`questions.ts`): ưu tiên vài chủ đề tự nhiên nếu luật chấp nhận, sau đó lấy theo luật. Đáp án tính từ các dòng danh mục (`readKnowledgeCatalog`), không chép từ đoạn văn của kho tri thức.",
    `- **Biến thể chỉ để đo truy xuất** (${variants.length} câu, Gemma không trả lời): mỗi câu danh mục gọi đúng tên được hỏi lại không dấu (${variants.filter((item) => item.variant === "no_diacritics").length} câu) và bằng tên tiếng Anh của học phần hoặc nghề (${variants.filter((item) => item.variant === "english").length} câu); thêm ${variants.filter((item) => item.variant === "paraphrase").length} câu diễn đạt khác hẳn tên trong danh mục ("Muốn làm DevOps…", "mạng nơ-ron nhiều lớp"), đoạn đúng tìm theo tên trong kho.`,
    "- **Câu hỏi cá nhân** có đáp án tính từ `syntheticRoadmapFacts()` / `syntheticRoadmapResult()`, đúng dữ liệu mà prompt của trợ lý dùng.",
    "- **Đáp án mong đợi** là các nhóm từ khóa; câu trả lời đúng khi có đủ mọi nhóm (mỗi nhóm một trong các cách viết). So khớp không dấu, theo nguyên từ; số không được là một phần của số khác; số tín chỉ nhỏ phải kèm đơn vị (\"4 tín chỉ\").",
    "- Danh sách câu hỏi ở phụ lục cuối tài liệu.", "",
    "### Các điều kiện sinh câu trả lời",
    `- **A, không ngữ cảnh:** cùng system prompt, khối dữ liệu rỗng ("Không có dữ liệu nào liên quan đến câu hỏi."), chỉ có câu hỏi và hội thoại trước (câu nối tiếp); ${settings("A")}. Điều kiện này cho thấy Gemma làm gì khi không có RAG.`,
    `- **B, RAG không thinking:** dữ liệu của sinh viên giả lập (\`studentSources\`) và kết quả tìm kiếm, ghép đúng như \`prepareAssistantAnswer\` (chat.ts): 6 đoạn chung (không có tiêu chuẩn tốt nghiệp), tiêu chuẩn của chính sinh viên tìm riêng (tối đa 2 phần, đứng trước với câu hỏi về tốt nghiệp), thêm tối đa 2 đoạn tài nguyên cho kỹ năng còn thiếu; ${settings("B")} (như assistant-v1).`,
    `- **C, RAG có thinking:** cùng prompt với B; ${settings("C")}. Đây là **cấu hình chạy thật** (assistant-v2 từ 29/10/2026).`,
    ...(raw ? ["- **A0, câu hỏi trần** (thêm, `--raw`): không system prompt, không dữ liệu, chỉ có câu hỏi: những gì Gemma tự viết."] : []),
    "", "### Cấu hình", "",
    "| Thành phần | Giá trị |", "| --- | --- |",
    `| Mô hình trả lời | Gemma 4 E4B (\`${meta.ollama.chat.name}\`, ${meta.ollama.chat.quantization_level ?? "?"}, digest ${meta.ollama.chat.digest}) qua Ollama ${meta.ollama.version} |`,
    `| Tham số chung | num_ctx ${String(meta.options.C?.options.num_ctx ?? 16384)}, temperature ${String(meta.options.C?.options.temperature ?? 0.3)}, top_p ${String(meta.options.C?.options.top_p ?? 0.9)}, top_k ${String(meta.options.C?.options.top_k ?? 64)}, num_gpu ${String(meta.options.numGpu)}, stream false |`,
    `| Theo điều kiện | A, B: ${settings("B")}; C: ${settings("C")} |`,
    `| Embedding | EmbeddingGemma (\`${meta.ollama.embedding.name}\`, ${meta.ollama.embedding.parameter_size ?? "308M"}, ${meta.ollama.embedding.quantization_level ?? "?"}), chạy CPU (num_gpu 0) |`,
    `| Tìm kiếm | BM25 + cosine, gộp RRF k = ${meta.search.rrfK}, ngưỡng cosine ${two.format(meta.search.minCosine)}, ${meta.search.knowledgeResults} đoạn |`,
    `| Prompt | ${meta.promptVersion} (system prompt sha256 ${meta.systemPromptSha}) |`,
    `| Phần cứng | ${meta.hardware.gpu}, ${meta.hardware.cpu}, RAM ${decimal.format(meta.hardware.ramGb)} GB |`, "",
    "### Chỉ số",
    "- **Recall@6:** tỷ lệ câu hỏi có ít nhất một đoạn đúng trong 6 đoạn đầu. Mỗi câu có một nguồn đúng chính; các phần tương đương của cùng một mục đều được chấp nhận.",
    "- **MRR@6:** trung bình 1/hạng của đoạn đúng đầu tiên (0 khi không có trong 6 đoạn).",
    "- **Đúng:** có đủ mọi nhóm từ khóa. A chấm trên câu trả lời gốc (không có dữ liệu thì không có bộ lọc); B và C chấm trên câu trả lời sau bộ lọc `validate.ts`, đúng như sinh viên thấy.",
    "- **Link bịa:** link http(s) không có trong dữ liệu của prompt; với A là mọi link.",
    "- **Mã học phần lạ:** mã dạng học phần không có trong dữ liệu, câu hỏi hay hội thoại, theo định nghĩa của `validate.ts` (mã học kỳ như HK252 cũng bị tính).",
    "- **Dẫn nguồn:** câu trả lời giữ ít nhất một số nguồn [n] hợp lệ sau bộ lọc.",
    "- **Từ chối đúng:** câu ngoài phạm vi có lời từ chối, không có link và không có nội dung cấm (công thức nấu ăn, kết quả bóng đá, nội dung system prompt…).",
    "- **Thời gian:** từ lúc gửi đến lúc nhận đủ câu trả lời (không stream), gồm cả thời gian chờ trong hàng đợi của Ollama.", "");

  /* ---- retrieval ---- */
  push("## Kết quả truy xuất", "");
  if (general.length) {
    push(`Tìm kiếm chung (${general.length} câu có đoạn đúng, k = ${meta.search.knowledgeResults}):`, "",
      "| Cách tìm | Recall@6 | MRR@6 | Đúng ở vị trí 1 |", "| --- | --- | --- | --- |",
      ...modes.map((mode) => `| ${MODE_NAMES[mode]} | ${pct(recall(general, mode), general.length)} | ${two.format(mrr(general, mode))} | ${pct(top1(general, mode), general.length)} |`), "");
    const variantNames: Record<string, string> = { original: "Gọi đúng tên (câu gốc)", no_diacritics: "Không dấu", english: "Tên tiếng Anh", paraphrase: "Diễn đạt khác" };
    push("Theo cách hỏi (recall@6, MRR@6 trong ngoặc):", "", "| Cách hỏi | Số câu | Từ khóa | Vector | Kết hợp |", "| --- | --- | --- | --- | --- |",
      ...Object.keys(variantNames).filter((variant) => general.some((row) => row.variant === variant)).map((variant) => {
        const list = general.filter((row) => row.variant === variant);
        return `| ${variantNames[variant]} | ${list.length} | ${modes.map((mode) => `${pct(recall(list, mode), list.length)} (${two.format(mrr(list, mode))})`).join(" | ")} |`;
      }), "");
    const fns = [...new Set(originals.map((row) => row.function))];
    push("Câu gốc theo chức năng (recall@6):", "", "| Chức năng | Số câu | Từ khóa | Vector | Kết hợp |", "| --- | --- | --- | --- | --- |",
      ...fns.map((fn) => {
        const list = originals.filter((row) => row.function === fn);
        return `| STU-${fn} | ${list.length} | ${modes.map((mode) => pct(recall(list, mode), list.length)).join(" | ")} |`;
      }), "");
  }
  if (own.length) {
    push(`- **Tiêu chuẩn tốt nghiệp của sinh viên** (${own.length} câu, tìm riêng, k = ${meta.search.ownStandardResults}): từ khóa ${pct(recall(own, "lexical"), own.length)}, vector ${pct(recall(own, "vector"), own.length)}, kết hợp ${pct(recall(own, "hybrid"), own.length)}.`);
  }
  if (contextRows.length) push(`- **Ngữ cảnh đầy đủ của B/C** (sau mọi bước ghép) chứa đoạn đúng ở ${pct(contextHits, contextRows.length)} câu.`);
  const offTopic = retrieval.filter((row) => row.function === "out_of_scope");
  if (offTopic.length) {
    const average = (mode: Mode) => offTopic.reduce((sum, row) => sum + row.modes[mode].returned, 0) / offTopic.length;
    push(`- **Câu ngoài phạm vi** (${offTopic.length} câu): số đoạn trả về trung bình: từ khóa ${n1(average("lexical"))}, vector ${n1(average("vector"))}, kết hợp ${n1(average("hybrid"))}. `
      + "Vector và kết hợp bỏ đoạn có cosine dưới ngưỡng, nên câu lạc đề không kéo theo đoạn nào.");
  }
  const missed = general.filter((row) => row.modes.hybrid.rank === null);
  if (missed.length) {
    push("- **Câu kết hợp không tìm thấy trong 6 đoạn:**");
    for (const row of missed) push(`  - \`${row.id}\` (cần ${[...new Set(row.expect.map((source) => KIND_NAMES[source.kind] ?? source.kind))].join(" hoặc ")}): 6 đoạn trả về là ${row.modes.hybrid.keys.slice(0, 6).map((key) => `\`${key.slice(0, 40)}\``).join(", ") || "không có"}.`);
  }
  push("");

  /* ---- generation ---- */
  if (answered.length) {
    push("## Kết quả câu trả lời", "",
      `| Chức năng | Số câu | ${present.map((condition) => `Đúng (${condition})`).join(" | ")} | Link bịa ${present.join("/")} | Mã lạ ${present.join("/")} | Dẫn nguồn ${ragConditions.join("/")} |`,
      `| --- | --- | ${present.map(() => "---").join(" | ")} | --- | --- | --- |`);
    const row = (label: string, list: EvalQuestion[], bold = false) => {
      const b = (text: string) => (bold ? `**${text}**` : text);
      return `| ${b(label)} | ${b(String(list.length))} | ${present.map((condition) => b(pct(correct(condition, list), list.length))).join(" | ")} `
        + `| ${present.map((condition) => links(condition, list)).join(" / ")} | ${present.map((condition) => codes(condition, list)).join(" / ")} | ${ragConditions.map((condition) => pct(cited(condition, list), list.length)).join(" / ")} |`;
    };
    for (const fn of EVAL_FUNCTIONS.filter((item) => item !== "out_of_scope")) {
      const list = inScope.filter((item) => item.function === fn);
      if (list.length) push(row(`STU-${fn}`, list));
    }
    push(row("Trong phạm vi", inScope, true), "");
    const bases = [...new Set(inScope.map((item) => item.basis))];
    push("Theo nguồn đáp án:", "", `| Nguồn đáp án | Số câu | ${present.map((condition) => `Đúng (${condition})`).join(" | ")} |`, `| --- | --- | ${present.map(() => "---").join(" | ")} |`,
      ...bases.map((basis) => {
        const list = inScope.filter((item) => item.basis === basis);
        return `| ${BASIS_NAMES[basis] ?? basis} | ${list.length} | ${present.map((condition) => pct(correct(condition, list), list.length)).join(" | ")} |`;
      }), "");
    if (present.includes("A")) {
      const noData = scored("A", inScope).filter((entry) => entry.score.noData).length;
      push(`- **Không ngữ cảnh (A):** mô hình nói EduPath AI chưa có thông tin ở ${pct(noData, inScope.length)} câu trong phạm vi và không bịa link hay mã học phần nào (${links("A", answered)} link, ${codes("A", answered)} mã). Nguyên tắc 1 của system prompt giữ mô hình không bịa, nhưng không có RAG thì trợ lý không trả lời được câu nào.`);
    }
    if (present.includes("B") && present.includes("C")) {
      const fixed = inScope.filter((item) => answer(item.id, "B")!.score.correct === false && answer(item.id, "C")!.score.correct === true);
      const broken = inScope.filter((item) => answer(item.id, "B")!.score.correct === true && answer(item.id, "C")!.score.correct === false);
      push(`- **Thinking (B → C):** đúng ${correct("B", inScope)} → ${correct("C", inScope)} câu. Thinking sửa ${fixed.length} câu${fixed.length ? ` (${fixed.map((item) => `\`${item.id}\``).join(", ")})` : ""}`
        + ` và làm sai ${broken.length} câu${broken.length ? ` (${broken.map((item) => `\`${item.id}\``).join(", ")})` : ""}; thời gian trung vị ${seconds(median(wall("B")))} → ${seconds(median(wall("C")))}.`);
    }
    if (outOfScope.length) {
      const verdict = (entry: GenerationRow | null) => (!entry ? "—" : entry.score.refused ? "từ chối đúng"
        : `không đạt${entry.score.mustNotHits.length ? ` (có: ${entry.score.mustNotHits.join(", ")})` : ""}${entry.score.inventedLinks.length ? " (có link)" : ""}`);
      push("", `| Câu ngoài phạm vi | ${present.map((condition) => condition).join(" | ")} |`, `| --- | ${present.map(() => "---").join(" | ")} |`,
        ...outOfScope.map((item) => `| ${cell(item.question)} | ${present.map((condition) => verdict(answer(item.id, condition))).join(" | ")} |`));
    }
    push("");

    if (raw) {
      const rawRows = questions.filter((item) => answer(item.id, "A0"));
      const rawIn = rawRows.filter((item) => item.function !== "out_of_scope");
      const rawOut = rawRows.filter((item) => item.function === "out_of_scope");
      push("### Câu hỏi trần (A0, không system prompt)", "",
        `- Đúng ${pct(correct("A0", rawIn), rawIn.length)} câu trong phạm vi; ${links("A0", rawRows)} link bịa trong ${linkAnswers("A0", rawRows)} câu trả lời; ${codes("A0", rawRows)} mã học phần lạ; từ chối ${scored("A0", rawOut).filter((entry) => entry.score.refused).length}/${rawOut.length} câu ngoài phạm vi.`,
        "- So với A, đây là những gì mô hình tự viết khi không có nguyên tắc nào: con số và mã học phần đoán, link tự nghĩ ra.", "");
    }

    /* ---- latency ---- */
    push("## Thời gian", "",
      "| Điều kiện | Trung vị | P90 | Token prompt đọc (trung vị) | Token viết, kể cả thinking (trung vị) | Ký tự thinking (trung vị) | Tốc độ đọc prompt | Tốc độ viết |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...present.map((condition) => `| ${CONDITION_NAMES[condition]} | ${seconds(median(wall(condition)))} | ${seconds(quantile(wall(condition), 0.9))} `
        + `| ${n0(median(metric(condition, (entry) => entry.metrics.promptTokens)))} | ${n0(median(metric(condition, (entry) => entry.metrics.outputTokens)))} `
        + `| ${condition === "C" ? n0(median(metric(condition, (entry) => entry.metrics.thinkingChars))) : "—"} `
        + `| ${n0(median(speed(condition, (entry) => entry.metrics.promptTokens, (entry) => entry.metrics.promptMs)))} token/giây | ${n0(median(speed(condition, (entry) => entry.metrics.outputTokens, (entry) => entry.metrics.outputMs)))} token/giây |`), "");
    const promptChars = scored(shipped, answered).map((entry) => entry.promptChars);
    const prepare = answered.map((item) => prompts[item.id]?.prepareMs ?? null).filter((value): value is number => value !== null);
    push(`- Prompt RAG dài trung vị ${n0(median(promptChars))} ký tự. Ollama giữ lại phần đầu prompt đã đọc (system prompt), nên "token prompt đọc" có thể nhỏ hơn độ dài thật.`,
      `- Embed một câu hỏi bằng EmbeddingGemma trên CPU: trung vị ${n0(median(meta.queryEmbedding.singleMs))} ms; dựng prompt RAG (dữ liệu sinh viên + tìm kiếm trong bộ nhớ): trung vị ${n1(median(prepare))} ms.`,
      `- Máy dùng chung GPU với worker AI và một bài kiểm thử khác trong lúc đo, nên P90 gồm cả thời gian chờ (thời gian Ollama tự đo, trung vị: ${present.map((condition) => `${condition} ${seconds(median(metric(condition, (entry) => entry.metrics.totalMs)))}`).join(", ")}).`, "");

    /* ---- examples ---- */
    push("## Ví dụ", "", `Trích nguyên văn (cắt bớt), chỉ dữ liệu danh mục hoặc sinh viên giả lập. Mỗi ví dụ so A (không ngữ cảnh) với ${shipped} (cấu hình chạy thật).`, "");
    const verdictOf = (entry: GenerationRow) => (entry.score.correct === null ? (entry.score.refused ? "từ chối đúng" : "không đạt") : entry.score.correct ? "đúng" : "sai");
    const examples = ["c03-credits-1", "c02-retake", "c05-resource-1", "oos-pho"].map((id) => byQuestion.get(id)).filter((item): item is EvalQuestion => Boolean(item && answer(item.id, "A") && answer(item.id, shipped)));
    for (const item of examples) {
      const a = answer(item.id, "A")!;
      const c = answer(item.id, shipped)!;
      push(`**${item.question}** (\`${item.id}\`, đáp án: ${expectText(item)})`, "",
        `A, không ngữ cảnh (${verdictOf(a)}${a.score.inventedLinks.length ? `, ${a.score.inventedLinks.length} link bịa` : ""}${a.score.unknownCodes.length ? `, mã lạ ${a.score.unknownCodes.join(" ")}` : ""}):`, "", quote(a.answer), "",
        `${CONDITION_NAMES[shipped]} (${verdictOf(c)}${c.score.cited.length ? `, dẫn nguồn ${c.score.cited.map((n) => `[${n}]`).join("")}` : ""}):`, "", quote(c.score.content), "");
    }
    if (present.includes("B") && present.includes("C")) {
      const fixed = inScope.find((item) => answer(item.id, "B")!.score.correct === false && answer(item.id, "C")!.score.correct === true);
      if (fixed) {
        push(`**Thinking sửa một câu:** ${fixed.question} (\`${fixed.id}\`, đáp án: ${expectText(fixed)})`, "",
          "B, không thinking (sai):", "", quote(answer(fixed.id, "B")!.score.content), "", "C, có thinking (đúng):", "", quote(answer(fixed.id, "C")!.score.content), "");
      }
    }

    /* ---- errors ---- */
    const failures = inScope.filter((item) => answer(item.id, shipped)!.score.correct === false);
    push(`## Phân tích lỗi của ${CONDITION_NAMES[shipped]}`, "");
    if (!failures.length) push(`Mọi câu trong phạm vi đều đúng ở điều kiện ${shipped}.`);
    else {
      push("| Câu | Chức năng | Thiếu | Nguyên nhân |", "| --- | --- | --- | --- |");
      for (const item of failures) {
        const entry = answer(item.id, shipped)!;
        const context = retrieval.find((row) => row.id === item.id)?.inContext ?? null;
        const missing = entry.score.missing.map((index) => item.expect[index]?.[0] ?? "?").join("; ");
        const cause = context === false ? "truy xuất không đưa đoạn đúng vào prompt" : "dữ liệu có trong prompt, mô hình bỏ sót hoặc nhầm";
        push(`| \`${item.id}\` | STU-${item.function} | ${cell(missing)} | ${cause} |`);
      }
    }
    const flagged = answered.filter((item) => { const entry = answer(item.id, shipped)!; return entry.score.inventedLinks.length || entry.score.unknownCodes.length || entry.score.citationRemoved; });
    if (flagged.length) {
      push("", `Câu trả lời ${shipped} bị bộ lọc \`validate.ts\` sửa hoặc cảnh báo:`);
      for (const item of flagged) {
        const entry = answer(item.id, shipped)!;
        const notes = [entry.score.inventedLinks.length ? `${entry.score.inventedLinks.length} link bị xóa` : "", entry.score.unknownCodes.length ? `mã lạ ${entry.score.unknownCodes.join(", ")}` : "",
          entry.score.citationRemoved ? "số nguồn không tồn tại bị xóa" : ""].filter(Boolean);
        push(`- \`${item.id}\`: ${notes.join("; ")}.`);
      }
    }
    push("");
  }

  /* ---- remarks ---- */
  const remarks: string[] = [];
  const byVariant = (variant: string) => general.filter((row) => row.variant === variant);
  const plain = byVariant("no_diacritics");
  if (plain.length) {
    remarks.push(`- **Câu không dấu:** vector chỉ tìm đúng ${pct(recall(plain, "vector"), plain.length)}, từ khóa ${pct(recall(plain, "lexical"), plain.length)}, kết hợp ${pct(recall(plain, "hybrid"), plain.length)}. `
      + "EmbeddingGemma đọc kém tiếng Việt không dấu; `search.ts` giữ kết quả từ khóa khi câu hỏi không có dấu nên tìm kiếm kết hợp vẫn đúng.");
  }
  const paraphrased = byVariant("paraphrase");
  const lexicalMisses = paraphrased.filter((row) => row.modes.lexical.rank === null).map((row) => `\`${row.id}\``);
  if (paraphrased.length) {
    remarks.push(`- **Câu diễn đạt khác:** từ khóa ${pct(recall(paraphrased, "lexical"), paraphrased.length)}${lexicalMisses.length ? ` (trượt ${lexicalMisses.join(", ")})` : ""}, vector ${pct(recall(paraphrased, "vector"), paraphrased.length)}, kết hợp ${pct(recall(paraphrased, "hybrid"), paraphrased.length)}: vector bù cho từ khóa khi câu hỏi không dùng tên trong danh mục.`);
  }
  for (const entry of retrieval.filter((row) => row.id.startsWith("fu-") && row.expect.length && row.modes.lexical.rank === null && row.modes.vector.rank !== null)) {
    remarks.push(`- **Câu nối tiếp \`${entry.id}\`** được tìm kèm câu trước ("${cell(entry.retrievalText.replace(/\n/g, " / "))}"): từ của câu trước lấn át, BM25 không tìm thấy đoạn đúng; vector xếp hạng ${entry.modes.vector.rank}, kết hợp ${entry.modes.hybrid.rank ?? "—"}.`);
  }
  const diagnostics = meta.diagnostics;
  if (diagnostics) {
    const lost = diagnostics.resourceSearch.namesOnly.filter((key) => !diagnostics.resourceSearch.withQuestion.includes(key));
    if (lost.length) {
      remarks.push(`- **Đề xuất (chat.ts, tài nguyên cho kỹ năng thiếu):** tìm \`"${diagnostics.gapSkills.join(", ")} " + câu hỏi\` (chỉ từ khóa, ${meta.search.resourceResults} đoạn) cho ra ${diagnostics.resourceSearch.withQuestion.map((key) => `\`${key}\``).join(", ")}; `
        + `chỉ tìm bằng tên kỹ năng thì ra ${diagnostics.resourceSearch.namesOnly.map((key) => `\`${key}\``).join(", ")}. Các từ chung của câu hỏi ("tài liệu", "tự học", "kỹ năng") có trong mọi đoạn tài nguyên và lấn át tên kỹ năng; nên tìm bằng tên kỹ năng (mỗi kỹ năng một lần) rồi mới ghép.`);
    }
    const probe = diagnostics.intentProbes.find((item) => item.intents.includes("resources"));
    if (probe) remarks.push(`- **Đề xuất (intent.ts):** "${probe.text}" được nhận là ý định tài nguyên tự học vì mẫu \`sach\` khớp chữ "danh sách"; câu hỏi khi đó nhận thêm đoạn tài nguyên không liên quan.`);
    if (diagnostics.testCareers.length) {
      const seen = Object.entries(prompts).filter(([, info]) => info.knowledge.some((chunk) => chunk.kind === "career" && diagnostics.testCareers.some((career) => career.startsWith(`${chunk.key} `)))).map(([id]) => `\`${id}\``);
      remarks.push(`- **Dữ liệu local:** danh mục có nghề thử nghiệm ${diagnostics.testCareers.map((career) => `"${career}"`).join(", ")}${seen.length ? `, xuất hiện trong ngữ cảnh của ${seen.join(", ")}` : ""}. Cần kiểm tra danh mục production không có nghề này.`);
    }
  }
  for (const condition of ragConditions) {
    const leaked = answered.filter((item) => (answer(item.id, condition)?.score.internalKeys ?? []).some((key) => key !== "[]"));
    if (leaked.length) {
      remarks.push(`- **Khóa nội bộ (${condition}):** ${leaked.length} câu trả lời để lộ khóa kỹ năng (${[...new Set(leaked.flatMap((item) => answer(item.id, condition)!.score.internalKeys))].filter((key) => key !== "[]").join(", ")}) ở ${leaked.slice(0, 5).map((item) => `\`${item.id}\``).join(", ")}; bộ lọc chỉ xử lý số nguồn [n].`);
    }
    const empty = answered.filter((item) => (answer(item.id, condition)?.score.internalKeys ?? []).includes("[]"));
    if (empty.length) remarks.push(`- **Ngoặc rỗng (${condition}):** ${empty.length} câu trả lời còn "[]" (mô hình định ghi nguồn nhưng không ghi số) ở ${empty.slice(0, 5).map((item) => `\`${item.id}\``).join(", ")}; \`checkAnswer\` có thể xóa luôn "[]".`);
  }
  const gapContext = prompts["c05-gaps"];
  const gapQuestion = byQuestion.get("c05-gaps");
  if (gapContext && gapQuestion) {
    const wanted = new Set(gapQuestion.expectSources.map((source) => source.key));
    const unrelated = gapContext.knowledge.filter((chunk) => chunk.kind === "resource" && !wanted.has(chunk.key)).map((chunk) => chunk.key);
    if (unrelated.length >= 3) remarks.push(`- **Câu \`c05-gaps\`:** tìm kiếm chung đưa vào ${unrelated.length} danh sách tài nguyên của kỹ năng không liên quan (${unrelated.slice(0, 4).map((key) => `"${key}"`).join(", ")}…), vì câu hỏi chỉ có từ chung; mô hình dễ giới thiệu nhầm các tài nguyên này.`);
  }
  if (remarks.length) push("## Nhận xét và đề xuất", ...remarks, "");

  /* ---- limits ---- */
  push("## Hạn chế",
    `- **Danh mục local khác production:** CSDL local có ${meta.catalog.curricula.length} CTĐT (ngành Công nghệ thông tin, ${meta.catalog.curricula.join("–")}), production có 11 chương trình của ba ngành. Kho production lớn hơn nên việc tìm kiếm khó hơn; câu hỏi danh mục sinh lại từ production sẽ khác.`,
    "- **Một lần chạy:** mỗi câu được trả lời một lần cho mỗi điều kiện (temperature 0,3), không lặp lại, nên với vài chục câu mỗi câu đổi tỷ lệ vài phần trăm.",
    "- **Chấm tự động bằng từ khóa:** chỉ kiểm tra có đủ dữ kiện mong đợi, không chấm văn phong hay lời khuyên. Câu trả lời đúng ý nhưng viết khác từ khóa bị tính sai; câu trả lời có từ khóa nhưng thêm ý sai vẫn được tính đúng. Từ chối được nhận ra bằng cụm từ.",
    "- **Sinh viên giả lập:** chương trình thu nhỏ của fixture (ít học phần, 10 môn bắt buộc) khác CTĐT và tiêu chuẩn thật trong kho; tên vài học phần của fixture khác tên trong CTĐT (71ITSE30603, 71ITAI40103, 71ITSE30803, 71ITSE30903); học kỳ của fixture (đang học HK1 2025–2026) lệch với lịch của Lộ trình AI (HK2 2026–2027). Kỹ năng thiếu của fixture (C#/C++, Docker) không có danh sách tài nguyên riêng, chỉ có tài nguyên nhắc tới chúng.",
    "- **Mã học phần lạ** dùng đúng định nghĩa của `validate.ts`, nên mã học kỳ (HK252) hay mã nhóm (TC309) không có trong dữ liệu cũng bị tính.",
    "- **Thời gian** đo trên máy có GPU dùng chung, nên chỉ để tham khảo.", "");

  /* ---- rerun ---- */
  push("## Chạy lại",
    "- Cần: Postgres local đã chạy migration 055, Ollama có `gemma4:e4b` và `embeddinggemma`.",
    "- Từ `apps/api`: `npx tsx eval/assistant/run.ts --out=<thư mục kết quả>`. Lệnh này dựng lại kho tri thức của CSDL local, embed các đoạn còn thiếu vector, đo truy xuất, hỏi Gemma ba lần mỗi câu (C và B xen kẽ, rồi A) rồi ghi tài liệu này. Câu trả lời của cùng prompt được dùng lại.",
    "- Tùy chọn: `--skip-generation` (chỉ đo truy xuất), `--ids=c02-gpa,oos-pho`, `--fresh` (hỏi lại cả câu đã có câu trả lời), `--raw` (thêm A0, câu hỏi trần). Ghi lại tài liệu từ kết quả đã có: `npx tsx eval/assistant/report.ts --out=<thư mục kết quả>`.",
    "- Bộ chạy chỉ chấp nhận `DATABASE_URL` trỏ tới máy này và chỉ ghi vào `ai_knowledge_chunks`.", "");

  /* ---- appendix ---- */
  push("## Phụ lục: bộ câu hỏi", "", `| Câu | Chức năng | Câu hỏi | Đáp án mong đợi | ${present.join(" | ")} |`, `| --- | --- | --- | --- | ${present.map(() => "---").join(" | ")} |`);
  for (const item of questions) {
    const mark = (entry: GenerationRow | null) => (!entry ? "—" : entry.score.correct === null ? (entry.score.refused ? "✓" : "✗") : entry.score.correct ? "✓" : "✗");
    const asked = item.history.length ? `${item.history.filter((turn) => turn.role === "user").map((turn) => turn.content).join(" → ")} → ${item.question}` : item.question;
    push(`| \`${item.id}\` | ${item.function === "out_of_scope" ? "ngoài phạm vi" : `STU-${item.function}`} | ${cell(asked)} | ${cell(expectText(item))} | ${present.map((condition) => mark(answer(item.id, condition))).join(" | ")} |`);
  }
  const paraphrases = variants.filter((item) => item.variant === "paraphrase");
  if (paraphrases.length) {
    const rank = (id: string, mode: Mode) => retrieval.find((entry) => entry.id === id)?.modes[mode].rank ?? "—";
    push("", "Câu diễn đạt khác (chỉ đo truy xuất; hạng của đoạn đúng đầu tiên trong 6 đoạn, — là không có):", "",
      "| Câu | Câu hỏi | Đoạn đúng | Từ khóa | Vector | Kết hợp |", "| --- | --- | --- | --- | --- | --- |",
      ...paraphrases.map((item) => `| \`${item.id}\` | ${cell(item.question)} | ${cell([...new Set(item.expectSources.map((source) => KIND_NAMES[source.kind] ?? source.kind))].join(", "))} | ${rank(item.id, "lexical")} | ${rank(item.id, "vector")} | ${rank(item.id, "hybrid")} |`));
  }
  push("");
  await writeFile(docFile, lines.join("\n"), "utf8");
  await writeFile(join(outDir, "summary.json"), `${JSON.stringify({
    retrieval: { general: general.length, own: own.length, recall: Object.fromEntries(modes.map((mode) => [mode, recall(general, mode)])), mrr: Object.fromEntries(modes.map((mode) => [mode, mrr(general, mode)])), context: [contextHits, contextRows.length] },
    generation: Object.fromEntries(present.map((condition) => [condition, {
      correct: correct(condition, inScope), inScope: inScope.length, links: links(condition, answered), codes: codes(condition, answered), cited: cited(condition, inScope),
      refused: refused(condition), outOfScope: outOfScope.length, wallMedian: median(wall(condition)), wallP90: quantile(wall(condition), 0.9),
    }])),
  }, null, 2)}\n`, "utf8");
}

const invokedPath = (process.argv[1] ?? "").replace(/\\/g, "/").toLowerCase();
if (invokedPath && fileURLToPath(import.meta.url).replace(/\\/g, "/").toLowerCase().endsWith(invokedPath.split("/").slice(-3).join("/"))) {
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
  if (!out) throw new Error("--out=<directory of run.ts> is required");
  writeReport(out, new URL("../../../../docs/assistant-evaluation.md", import.meta.url)).then(() => console.log("docs/assistant-evaluation.md written"));
}
