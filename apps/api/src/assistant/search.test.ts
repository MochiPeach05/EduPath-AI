import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { EMBEDDING_DIMENSIONS } from "./protocol.js";
import {
  buildLexicalIndex, buildVectorIndex, foldText, fuseRankings, KnowledgeIndex, loadKnowledgeIndex, MIN_COSINE, tokenize,
  type KnowledgeChunkRow,
} from "./search.js";

const MODEL = "embeddinggemma";
/** The unit vector of one axis (one topic). */
const axis = (i: number, scale = 1) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, j) => (j === i ? scale : 0));
/** A unit vector at cosine `cosine` from axis `a`, the rest along axis `b`. */
const toward = (a: number, cosine: number, b: number) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, j) => (j === a ? cosine : j === b ? Math.sqrt(1 - cosine * cosine) : 0));

function chunk(id: string, sourceKind: string, sourceKey: string, title: string, content: string, embedding: number[] | null,
  embeddingModel: string | null = embedding ? MODEL : null, link: string | null = null): KnowledgeChunkRow {
  return { id, sourceKind, sourceKey, title, content, link, embedding, embeddingModel };
}

/** Axes: 0 databases, 1 data careers, 2 web, 3 Python, 4 transcripts, 5 nothing (off-topic), 6 incidents, 7 defence. */
const ROWS: KnowledgeChunkRow[] = [
  chunk("c-db", "course", "71ITIS30103", "Cơ sở dữ liệu (71ITIS30103)",
    "Học phần Cơ sở dữ liệu, mã 71ITIS30103, 3 tín chỉ: thiết kế lược đồ quan hệ, truy vấn SQL.", axis(0)),
  chunk("c-web", "course", "71ITSE30503", "Lập trình ứng dụng Web (71ITSE30503)",
    "Học phần Lập trình ứng dụng Web, mã 71ITSE30503, 3 tín chỉ: HTML, CSS, JavaScript.", axis(2)),
  chunk("k-data", "career", "NN007", "Kỹ sư dữ liệu (Data Engineer)",
    "Nghề Kỹ sư dữ liệu: xây dựng đường ống dữ liệu, kho dữ liệu, ETL và SQL.", toward(1, 0.9, 0)),
  chunk("r-py", "resource", "https://www.learnpython.org/", "Python cho người mới bắt đầu",
    "Khóa học miễn phí về lập trình Python cơ bản.", axis(3), MODEL, "https://www.learnpython.org/"),
  chunk("g-bd", "guide", "transcript", "Nhập bảng điểm", "Vào trang Hồ sơ, chọn Nhập bảng điểm và tải lên file PDF.", axis(4), MODEL, "#profile"),
  chunk("s-ir", "skill", "Ứng phó sự cố", "Kỹ năng Ứng phó sự cố", "Phát hiện và xử lý sự cố an ninh mạng.", axis(6)),
  chunk("c-qp", "course", "71NAD410044", "GDQP4: Kỹ thuật chiến đấu bộ binh",
    "Học phần giáo dục quốc phòng: kỹ thuật chiến đấu bộ binh và chiến thuật.", axis(7)),
  // Not embedded yet, embedded by another model (its vector equals axis 0!), and a vector of the wrong length.
  chunk("p-new", "guide", "survey", "Khảo sát định hướng", "Khảo sát định hướng gồm 10 câu hỏi về sở thích và thế mạnh.", null),
  chunk("o-old", "skill", "SQL", "Kỹ năng SQL", "Truy vấn dữ liệu bằng SQL.", axis(0), "nomic-embed-text"),
  chunk("w-len", "skill", "Docker", "Kỹ năng Docker", "Đóng gói ứng dụng bằng container Docker.", [1, 0, 0]),
];
const index = new KnowledgeIndex(ROWS, MODEL);
const ids = (hits: { id: string }[]) => hits.map((hit) => hit.id);

describe("foldText and tokenize", () => {
  it("folds case, diacritics, đ and spaces, so 'Cơ sở dữ liệu' and 'co so du lieu' give the same terms", () => {
    expect(foldText("  Cơ sở   DỮ LIỆU  ")).toBe("co so du lieu");
    expect(foldText("Đồ án ĐẠI HỌC")).toBe("do an dai hoc");
    expect(foldText("Cơ sở dữ liệu".normalize("NFD"))).toBe("co so du lieu");
    expect(tokenize("Cơ sở dữ liệu")).toEqual(["co", "so", "du", "lieu", "co so", "so du", "du lieu"]);
    expect(tokenize("co so du lieu")).toEqual(tokenize("Cơ sở dữ liệu"));
    expect(tokenize("CƠ SỞ DỮ LIỆU".normalize("NFD"))).toEqual(tokenize("Cơ sở dữ liệu"));
    // "kĩ"/"kỹ", "kì"/"kỳ": both spellings are in use.
    expect(tokenize("kĩ năng, học kì")).toEqual(tokenize("Kỹ năng, học kỳ"));
  });

  it("keeps course codes, C# and C++ whole", () => {
    expect(tokenize("Môn 71ITSE30103 và DQP0061")).toEqual(["mon", "71itse30103", "dqp0061", "mon 71itse30103"]);
    expect(tokenize("Lập trình C# và C++")).toEqual(["lap", "trinh", "c#", "c++", "lap trinh", "trinh c#"]);
  });

  it("drops stopwords by their accented form, so the syllables they fold to stay", () => {
    expect(tokenize("Có cơ sở")).toEqual(["co", "so", "co so"]);
    expect(tokenize("những hệ thống nhúng")).toEqual(["he", "thong", "nhung", "he thong", "thong nhung"]);
    expect(tokenize("tôi")).toEqual([]);
    expect(tokenize("tối ưu")).toEqual(["toi", "uu", "toi uu"]);
    expect(tokenize("đó là đồ án")).toEqual(["do", "an", "do an"]);
    expect(tokenize("thì thi")).toEqual(["thi"]);
    // Typed without diacritics, only forms no catalog word folds to are dropped ("co" may be "cơ").
    expect(tokenize("co so du lieu la gi")).toEqual(tokenize("Cơ sở dữ liệu là gì"));
  });

  it("keeps 'học' in phrases only, and 'mấy' does not turn 'học mấy' into 'học máy'", () => {
    expect(tokenize("Em nên học gì?")).toEqual([]);
    expect(tokenize("học phần")).toEqual(["phan", "hoc phan"]);
    expect(tokenize("Học máy")).toEqual(["may", "hoc may"]);
    expect(tokenize("khoa học dữ liệu")).toEqual(["khoa", "du", "lieu", "khoa hoc", "hoc du", "du lieu"]);
    expect(tokenize("Môn này học mấy tín chỉ?")).toEqual(["mon", "tin", "chi", "tin chi"]);
    expect(tokenize("hoc phan")).toEqual(tokenize("học phần"));
    expect(tokenize("Như thế nào là thế mạnh?")).toEqual(["manh", "the manh"]);
  });

  it("breaks phrases at punctuation and stopwords, not inside HTML/CSS or front-end", () => {
    expect(tokenize("Java, Web")).toEqual(["java", "web"]);
    expect(tokenize("Lập trình cho web")).toEqual(["lap", "trinh", "web", "lap trinh"]);
    expect(tokenize("HTML/CSS front-end. Vue.js")).toEqual(["html", "css", "front", "end", "vue", "js", "html css", "css front", "front end", "vue js"]);
  });
});

describe("buildLexicalIndex", () => {
  it("ranks by BM25: the chunk about the question first, a rare term over a common one, no match left out", () => {
    const lexical = buildLexicalIndex([
      { id: "a", title: "Cơ sở dữ liệu", text: "Thiết kế cơ sở dữ liệu quan hệ và truy vấn SQL." },
      { id: "b", title: "Phân tích dữ liệu", text: "Làm sạch và trực quan hóa dữ liệu." },
      { id: "c", title: "Lập trình web", text: "HTML, CSS và JavaScript." },
      { id: "d", title: "Xử lý luồng dữ liệu", text: "Kafka và Spark." },
    ]);
    const hits = lexical.search("Cơ sở dữ liệu là gì?", 10);
    expect(ids(hits)).toEqual(["a", "b", "d"]);
    expect(hits[0]!.score).toBeGreaterThan(2 * hits[1]!.score);
    expect(hits[1]!.terms).toEqual(["du", "lieu", "du lieu"]);
    // "dữ liệu" is in three documents, "kafka" in one.
    expect(ids(lexical.search("dữ liệu kafka", 10))[0]).toBe("d");
    expect(ids(lexical.search("dữ liệu", 1))).toHaveLength(1);
    expect(ids(lexical.search("dữ liệu", 10, (id) => id !== "a"))).not.toContain("a");
    expect(lexical.search("nấu ăn", 10)).toEqual([]);
  });

  it("matches a course code exactly, in any case", () => {
    const lexical = buildLexicalIndex([
      { id: "kt", title: "Kỹ thuật lập trình (71ITSE30103)", text: "Học phần 3 tín chỉ." },
      { id: "oop", title: "Lập trình hướng đối tượng (71ITSE30203)", text: "Học phần 3 tín chỉ." },
    ]);
    expect(ids(lexical.search("71itse30103 là môn gì", 10))).toEqual(["kt"]);
    expect(ids(lexical.search("Môn 71ITSE30203", 10))).toEqual(["oop"]);
  });

  it("boosts the words of the question written as one phrase", () => {
    const lexical = buildLexicalIndex([
      { id: "scattered", title: "Kỹ năng", text: "web lập trình" },
      { id: "phrase", title: "Kỹ năng", text: "lập trình web" },
    ]);
    const hits = lexical.search("Lập trình web", 10);
    expect(ids(hits)).toEqual(["phrase", "scattered"]);
    expect(hits[0]!.terms).toContain("trinh web");
    expect(hits[1]!.terms).not.toContain("trinh web");
  });

  it("weighs a title term over the same term in the text", () => {
    const lexical = buildLexicalIndex([
      { id: "kubernetes", title: "Kubernetes", text: "Docker" },
      { id: "docker", title: "Docker", text: "Kubernetes" },
    ]);
    expect(ids(lexical.search("docker", 10))).toEqual(["docker", "kubernetes"]);
    expect(ids(lexical.search("Kubernetes", 10))).toEqual(["kubernetes", "docker"]);
  });
});

describe("buildVectorIndex", () => {
  it("ranks by cosine, normalises at load and skips null, wrong-length, zero and non-finite vectors", () => {
    const vectors = buildVectorIndex([
      { id: "near", vector: toward(0, 0.6, 1) },
      { id: "same", vector: axis(0, 5) },
      { id: "none", vector: null },
      { id: "short", vector: [1, 0, 0] },
      { id: "zero", vector: axis(0, 0) },
      { id: "nan", vector: [Number.NaN, ...axis(0).slice(1)] },
    ]);
    expect(vectors.size).toBe(2);
    const hits = vectors.search(axis(0, 3), 10);
    expect(ids(hits)).toEqual(["same", "near"]);
    expect(hits[0]!.score).toBeCloseTo(1, 5);
    expect(hits[1]!.score).toBeCloseTo(0.6, 5);
    expect(vectors.search(axis(0), 1)).toHaveLength(1);
    expect(vectors.search(axis(0), 10, (id) => id !== "same").map((hit) => hit.id)).toEqual(["near"]);
    expect(vectors.search([1, 0, 0], 10)).toEqual([]);
    expect(vectors.search(null, 10)).toEqual([]);
  });
});

describe("fuseRankings", () => {
  it("sums 1 / (k + rank), so agreement between rankings wins", () => {
    // a: 1/61 + 1/62, c: 1/63 + 1/61, b: 1/62, d: 1/63.
    expect(fuseRankings([["a", "b", "c"], ["c", "a", "d"]])).toEqual(["a", "c", "b", "d"]);
    // A small k favours the first places, the usual 60 the agreement.
    expect(fuseRankings([["a", "b"], ["c", "x", "y", "b"]], 0)).toEqual(["a", "c", "b", "x", "y"]);
    expect(fuseRankings([["a", "b"], ["c", "x", "y", "b"]])).toEqual(["b", "a", "c", "x", "y"]);
  });

  it("breaks ties by the best rank, then the earlier ranking; counts a repeated id once", () => {
    expect(fuseRankings([["x"], ["y"]])).toEqual(["x", "y"]);
    expect(fuseRankings([["y"], ["x"]])).toEqual(["y", "x"]);
    expect(fuseRankings([["a", "b"], ["b", "a"]])).toEqual(["a", "b"]);
    expect(fuseRankings([["a", "a", "b"]])).toEqual(["a", "b"]);
    expect(fuseRankings([])).toEqual([]);
  });
});

describe("KnowledgeIndex", () => {
  it("searches by words only without a vector", () => {
    const hits = index.search({ text: "Môn cơ sở dữ liệu học gì?", vector: null });
    expect(hits[0]).toMatchObject({ id: "c-db", sourceKind: "course", sourceKey: "71ITIS30103", title: "Cơ sở dữ liệu (71ITIS30103)", link: null });
    expect(hits.every((hit) => hit.via.join() === "lexical")).toBe(true);
  });

  it("searches by meaning only without words, from MIN_COSINE", () => {
    const hits = index.search({ vector: axis(0) });
    // k-data is at cosine 0.44; o-old's other-model vector equals the query but does not count.
    expect(ids(hits)).toEqual(["c-db", "k-data"]);
    expect(hits.map((hit) => hit.via)).toEqual([["vector"], ["vector"]]);
    expect(hits[0]!.score).toBeCloseTo(1 / 61, 10);
    expect(ids(index.search({ text: "Em nên học gì?", vector: toward(0, MIN_COSINE + 0.01, 5) }))).toEqual(["c-db"]);
    expect(index.search({ text: "Em nên học gì?", vector: toward(0, MIN_COSINE - 0.01, 5) })).toEqual([]);
  });

  it("fuses words and meaning: chunks found by both come first", () => {
    const hits = index.search({ text: "Kỹ sư dữ liệu làm gì?", vector: axis(0) });
    // Words: k-data, o-old, c-db, w-len; meaning: c-db, k-data. o-old is second by words alone.
    expect(hits.map((hit) => [hit.id, hit.via.join("+")])).toEqual([
      ["k-data", "lexical+vector"], ["c-db", "lexical+vector"], ["o-old", "lexical"], ["w-len", "lexical"],
    ]);
    expect(hits[0]!.score).toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(hits[1]!.score).toBeCloseTo(1 / 63 + 1 / 61, 12);
  });

  it("finds nothing for an off-topic question although folded syllables collide", () => {
    const question = "Cách nấu phở bò ngon";
    // "phở" folds like "phó" (Ứng phó sự cố), "bò" like "bộ" (bộ binh): words alone find them…
    expect(ids(index.search({ text: question, vector: null })).sort()).toEqual(["c-qp", "s-ir"]);
    // …but both are far in meaning from the question.
    expect(index.search({ text: question, vector: axis(5) })).toEqual([]);
  });

  it("keeps a word match far in meaning for a question without diacritics, a shared code or a chunk not embedded", () => {
    const far = axis(5);
    // c-db and k-data share "dữ liệu" only; o-old (other model) and p-new ("sở thích") cannot be judged by meaning.
    expect(ids(index.search({ text: "Dữ liệu và sở thích cá nhân", vector: far })).sort()).toEqual(["o-old", "p-new"]);
    expect(ids(index.search({ text: "du lieu va so thich ca nhan", vector: far }))).toEqual(expect.arrayContaining(["c-db", "k-data"]));
    expect(ids(index.search({ text: "Môn 71ITIS30103 là gì?", vector: far }))).toEqual(["c-db"]);
  });

  it("keeps a chunk far in meaning that holds every word of the question and one of its phrases", () => {
    const standards = new KnowledgeIndex([
      chunk("k26", "graduation", "K26:2", "Tiêu chuẩn xét tốt nghiệp K26 (phần 2/5)",
        "Môn của nhóm bắt buộc: Cơ sở dữ liệu, Triết học Mác - Lênin. Chuẩn đầu ra tiếng Anh: bậc 3.", axis(0)),
      chunk("av1", "course", "71ENG110013", "Anh văn 1 (71ENG110013)", "Học phần tiếng Anh, 3 tín chỉ.", axis(1)),
    ], MODEL);
    // Both are far from the question in meaning; Anh văn 1 lacks "chuẩn đầu ra".
    expect(standards.search({ text: "Chuẩn đầu ra tiếng Anh", vector: axis(2) }).map((hit) => [hit.id, hit.via])).toEqual([["k26", ["lexical"]]]);
    expect(standards.search({ text: "Tiếng Anh giao tiếp", vector: axis(2) })).toEqual([]);
  });

  it("filters by source kind", () => {
    expect(ids(index.search({ text: "dữ liệu", vector: null, kinds: ["career"] }))).toEqual(["k-data"]);
    expect(ids(index.search({ text: "dữ liệu", vector: null, excludeKinds: ["course", "skill"] }))).toEqual(["k-data"]);
    expect(ids(index.search({ vector: axis(0), kinds: ["career", "guide"] }))).toEqual(["k-data"]);
    expect(ids(index.search({ text: "học Python", vector: axis(3), kinds: ["resource"] }))).toEqual(["r-py"]);
    expect(index.search({ text: "học Python", vector: axis(3), kinds: ["resource"] })[0]!.link).toBe("https://www.learnpython.org/");
  });

  it("ignores embeddings of another model or length, and a query vector of another length", () => {
    expect(index.stats()).toEqual({ chunks: 10, embedded: 7 });
    expect(ids(index.search({ vector: axis(0) }))).not.toContain("o-old");
    expect(index.search({ vector: [1, 0, 0] })).toEqual([]);
    expect(index.search({ text: "container Docker", vector: [1, 0, 0] }).map((hit) => [hit.id, hit.via])).toEqual([["w-len", ["lexical"]]]);
  });

  it("limits the results, reads a chunk by its key and keeps the first of a repeated id", () => {
    expect(index.search({ text: "kỹ năng học phần", vector: null, k: 10 })).toHaveLength(7);
    expect(index.search({ text: "kỹ năng học phần", vector: null })).toHaveLength(6);
    expect(index.search({ text: "dữ liệu SQL", vector: null, k: 1 })).toHaveLength(1);
    expect(index.search({ text: "dữ liệu", vector: null, k: 0 })).toEqual([]);
    expect(index.search({ text: "dữ liệu", vector: null, minLexicalScore: 1000 })).toEqual([]);
    expect(index.byKey("course", "71ITIS30103")?.id).toBe("c-db");
    expect(index.byKey("skill", "71ITIS30103")).toBeUndefined();
    const twice = new KnowledgeIndex([ROWS[0]!, { ...ROWS[0]!, title: "Bản sau" }], MODEL);
    expect(twice.stats()).toEqual({ chunks: 1, embedded: 1 });
    expect(twice.byKey("course", "71ITIS30103")?.title).toBe("Cơ sở dữ liệu (71ITIS30103)");
  });
});

describe("loadKnowledgeIndex", () => {
  function fakeDb(model: string) {
    const state = {
      version: { chunks: 2, updated: "2026-10-28 10:00:00.000001+07", embedded: 1 } as { chunks: number; updated: string | null; embedded: number },
      rows: [
        chunk("a", "course", "71ITIS30103", "Cơ sở dữ liệu", "Học phần Cơ sở dữ liệu.", axis(0), model),
        chunk("b", "guide", "transcript", "Nhập bảng điểm", "Tải lên file PDF.", null),
      ] as unknown[],
    };
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      expect(params).toEqual([model]);
      return { rows: sql.includes("max(updated_at)") ? [state.version] : state.rows };
    });
    const reads = () => query.mock.calls.filter(([sql]) => !sql.includes("max(updated_at)")).length;
    return { db: { query } as unknown as Pick<DatabasePool, "query">, state, query, reads };
  }

  it("reads the rows again only when the version changed", async () => {
    const { db, state, query, reads } = fakeDb("cache-model-1");
    const first = await loadKnowledgeIndex(db, "cache-model-1");
    expect(first.stats()).toEqual({ chunks: 2, embedded: 1 });
    expect(await loadKnowledgeIndex(db, "cache-model-1")).toBe(first);
    expect(reads()).toBe(1);
    expect(query).toHaveBeenCalledTimes(3);

    // The worker embedded "b": more embedded rows and a newer updated_at.
    state.rows = [state.rows[0], chunk("b", "guide", "transcript", "Nhập bảng điểm", "Tải lên file PDF.", axis(4), "cache-model-1")];
    state.version = { chunks: 2, updated: "2026-10-28 10:05:00.000002+07", embedded: 2 };
    const second = await loadKnowledgeIndex(db, "cache-model-1");
    expect(second).not.toBe(first);
    expect(second.stats()).toEqual({ chunks: 2, embedded: 2 });
    expect(await loadKnowledgeIndex(db, "cache-model-1")).toBe(second);
    expect(reads()).toBe(2);

    // Each part of the version counts: the row count alone…
    state.version = { ...state.version, chunks: 3 };
    expect(await loadKnowledgeIndex(db, "cache-model-1")).not.toBe(second);
    expect(reads()).toBe(3);
  });

  it("shares one read between concurrent calls and reads non-array embeddings as missing", async () => {
    const { db, state, reads } = fakeDb("cache-model-2");
    state.rows = [{ ...chunk("a", "course", "X1", "A", "a", null), embedding: "{0.1,0.2}", embeddingModel: "cache-model-2" }];
    const [one, two] = await Promise.all([loadKnowledgeIndex(db, "cache-model-2"), loadKnowledgeIndex(db, "cache-model-2")]);
    expect(one).toBe(two);
    expect(reads()).toBe(1);
    expect(one.stats()).toEqual({ chunks: 1, embedded: 0 });
  });

  it("reads again for another model", async () => {
    const { db, reads } = fakeDb("cache-model-3");
    const first = await loadKnowledgeIndex(db, "cache-model-3");
    const other = fakeDb("cache-model-4");
    other.state.version = { chunks: 2, updated: "2026-10-28 10:00:00.000001+07", embedded: 1 };
    const second = await loadKnowledgeIndex(other.db, "cache-model-4");
    expect(second).not.toBe(first);
    expect(reads() + other.reads()).toBe(2);
  });
});
