// Search of the shared knowledge index of Trợ lý AI (STU-CHAT-01..05, 2026-10-28): which chunks of ai_knowledge_chunks
// (catalog text: courses, skills, careers, programs, training plans, graduation standards, guides, self-study resources)
// go into the prompt of an answer. The index holds about 500–1500 chunks, so the search is exact and in memory, without
// pgvector: words are ranked by BM25 over folded tokens and their bigrams (a Vietnamese word is mostly two syllables:
// "cơ sở", "dữ liệu"), meaning by the cosine of EmbeddingGemma vectors, and the two rankings are fused by Reciprocal Rank
// Fusion. A chunk far from the question in meaning is left out even when it shares a word with it, so an off-topic
// question finds few or no chunks instead of random ones.
import type { DatabasePool } from "../db/pool.js";
import { EMBEDDING_DIMENSIONS } from "./protocol.js";

type Db = Pick<DatabasePool, "query">;

/** Chunks an answer gets when the caller does not say. */
export const DEFAULT_RESULTS = 6;
/** The usual k of Reciprocal Rank Fusion: a chunk ranked r adds 1 / (60 + r) per ranking. */
export const RRF_K = 60;
/** Usual BM25 parameters; a title term counts twice (a chunk's title names what it is about). */
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const TITLE_WEIGHT = 2;
/**
 * Cosine from which a chunk is close in meaning to the question. Measured on 2026-10-28 with EmbeddingGemma (the prompts
 * of protocol.ts) over 310 chunks of the local catalog and 60 questions: the chunk that answers an accented question
 * scored 0.43–0.76 (median 0.63), long list chunks (a graduation standard, a program block) 0.55–0.69; the best chunk
 * for 29 of 30 off-topic questions 0.15–0.38 (median 0.26), the highest for questions shaped like study ones ("Học nấu
 * ăn ở đâu?", "Kỹ năng nấu ăn ngon"). At 0.3, 6 of the 30 still got chunks; at 0.4 only "Chơi game gì vui?" did (Game
 * Developer, 0.43). On the 389 chunks of knowledge.ts, 0.4 kept the answers of 11 study questions and found nothing for
 * 6 off-topic ones.
 */
export const MIN_COSINE = 0.4;
/** Each ranking takes part in the fusion with at least this many chunks. */
const FUSION_DEPTH = 40;

/** Lower case without diacritics, đ → d, single spaces: "Cơ sở  Dữ liệu" → "co so du lieu". */
export const foldText = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();

/**
 * Words dropped from questions and chunks, compared WITH their diacritics: folded, many would hide a word that matters
 * ("có" → "co" as in "cơ sở", "những" → "nhung" as in "nhúng", "tôi" → "toi" as in "tối ưu", "đó" → "do" as in "đồ án",
 * "thì" → "thi", "nên" → "nen" as in "nền tảng", "cần" → "can" as in "căn bản"). "mấy" goes too: "học mấy tín chỉ" is
 * not "học máy".
 */
const STOPWORDS = new Set([
  "là", "và", "của", "các", "có", "cho", "trong", "với", "những", "được", "một", "này", "đó", "thì", "mình", "bạn", "tôi", "em",
  "gì", "nào", "nên", "cần", "mấy", "ạ", "à", "ơi", "nhé", "nhỉ", "nha", "vậy", "ở", "để", "về", "hay", "hoặc", "hỏi", "muốn",
  "nếu", "khi", "đã", "đang", "sẽ", "rất", "cũng", "nhưng", "mà", "như", "đi", "đâu", "nhiêu", "rồi", "nữa", "giúp", "xin",
]);
/**
 * Words too common in questions to count alone that still make phrases: "học" in "học phần", "học kỳ", "học máy",
 * "khoa học", "tự học"; "làm" in "làm việc"; "sao" in "sao lưu"; "không" in "không gian"; "thế" in "thế mạnh".
 */
const PHRASE_ONLY = new Set(["học", "làm", "sao", "không", "thế"]);
/** The same for words typed without any diacritic, limited to forms no catalog word folds to ("co" may be "cơ"). */
const PLAIN_STOPWORDS = new Set(["la", "va", "cua", "cac", "duoc", "mot", "gi", "nao", "em", "voi", "nay", "cho"]);
const PLAIN_PHRASE_ONLY = new Set(["hoc", "lam", "sao", "khong", "the"]);
/** Bigrams do not cross punctuation: "Java, Web" makes no phrase "java web" ("HTML/CSS" and "front-end" still do). */
const CLAUSE_BREAK = /[\n\r,;:!?()[\]{}"“”‘’«»…•|]+|\.(?=\s|$)|\s[-–—]\s|[–—]/u;
/** Letters and digits; "c#", "c++" and course codes ("71itse30103", "dqp0061") stay whole. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:#|\+\+)?/gu;
/** A syllable written with y or i after its consonant ("kỹ"/"kĩ", "kỳ"/"kì", "lý"/"lí", "quy"/"qui") reads the same. */
const Y_SYLLABLE = /^(?:[bcdghklmnpqrstvx]|ch|gh|kh|ng|nh|ph|th|tr|qu)y$/;
/** A Latin letter with a diacritic (NFC): the question was typed with its accents. */
const DIACRITIC = /[À-ɏ̀-ͯḀ-ỿ]/u;

/** One word of a text: its folded term, or null for a stopword; phraseOnly words make bigrams only. */
function wordTerm(word: string): { term: string; phraseOnly: boolean } | null {
  const plain = !/[^\x00-\x7f]/.test(word);
  if (STOPWORDS.has(word) || (plain && PLAIN_STOPWORDS.has(word))) return null;
  const folded = foldText(word);
  return {
    term: Y_SYLLABLE.test(folded) ? `${folded.slice(0, -1)}i` : folded,
    phraseOnly: PHRASE_ONLY.has(word) || (plain && PLAIN_PHRASE_ONLY.has(word)),
  };
}

/**
 * The search terms of a text: its folded words in order ("Cơ sở dữ liệu" → co, so, du, lieu), then the bigrams of
 * neighbouring words ("co so", "so du", "du lieu"), repeats kept (they are term frequencies). A stopword or punctuation
 * between two words breaks the phrase.
 */
export function tokenize(text: string): string[] {
  const words: string[] = [];
  const bigrams: string[] = [];
  for (const clause of text.normalize("NFC").toLowerCase().split(CLAUSE_BREAK)) {
    let previous: string | null = null;
    for (const [word] of clause.matchAll(WORD)) {
      const term = wordTerm(word);
      if (term && !term.phraseOnly) words.push(term.term);
      if (term && previous) bigrams.push(`${previous} ${term.term}`);
      previous = term?.term ?? null;
    }
  }
  return [...words, ...bigrams];
}

/** A word of letters and digits names one thing exactly: a course code, "av7" (Anh văn 7), "k29", "b1". */
const isCode = (term: string) => !term.includes(" ") && /\p{L}/u.test(term) && /\p{N}/u.test(term);

export type LexicalHit = {
  id: string;
  score: number;
  /** The query terms the document contains. */
  terms: string[];
};
export type LexicalIndex = {
  readonly size: number;
  /**
   * Documents sharing a term with the query, best BM25 score first (ties in document order), at most k (Infinity: all),
   * among the ids `filter` accepts.
   */
  search(query: string, k: number, filter?: (id: string) => boolean): LexicalHit[];
};

/** BM25 over the terms of tokenize(); title terms count TITLE_WEIGHT times. */
export function buildLexicalIndex(docs: readonly { id: string; title: string; text: string }[]): LexicalIndex {
  const ids = docs.map((doc) => doc.id);
  const lengths: number[] = [];
  const postings = new Map<string, { doc: number; tf: number }[]>();
  docs.forEach((doc, at) => {
    const title = tokenize(doc.title);
    const text = tokenize(doc.text);
    const counts = new Map<string, number>();
    for (const term of title) counts.set(term, (counts.get(term) ?? 0) + TITLE_WEIGHT);
    for (const term of text) counts.set(term, (counts.get(term) ?? 0) + 1);
    lengths.push(title.length * TITLE_WEIGHT + text.length);
    for (const [term, tf] of counts) {
      const list = postings.get(term);
      if (list) list.push({ doc: at, tf });
      else postings.set(term, [{ doc: at, tf }]);
    }
  });
  const size = ids.length;
  const averageLength = lengths.reduce((sum, length) => sum + length, 0) / size || 1;

  return {
    size,
    search(query, k, filter) {
      const scores = new Float64Array(size);
      const matched: string[][] = Array.from({ length: size }, () => []);
      for (const term of new Set(tokenize(query))) {
        const list = postings.get(term);
        if (!list) continue;
        const idf = Math.log(1 + (size - list.length + 0.5) / (list.length + 0.5));
        for (const { doc, tf } of list) {
          scores[doc]! += idf * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * lengths[doc]! / averageLength));
          matched[doc]!.push(term);
        }
      }
      const hits: LexicalHit[] = [];
      for (let at = 0; at < size; at++) {
        if (scores[at]! > 0 && (!filter || filter(ids[at]!))) hits.push({ id: ids[at]!, score: scores[at]!, terms: matched[at]! });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}

/** `vector` scaled to length 1 as Float32Array; null when it is missing, of another length, not finite or zero. */
function unitVector(vector: readonly number[] | null | undefined, dimensions: number): Float32Array | null {
  if (!Array.isArray(vector) || vector.length !== dimensions) return null;
  let norm = 0;
  for (const value of vector) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    norm += value * value;
  }
  if (!(norm > 0)) return null;
  const scale = 1 / Math.sqrt(norm);
  return Float32Array.from(vector, (value) => value * scale);
}

export type VectorHit = { id: string; score: number };
export type VectorIndex = {
  /** Documents with a usable vector. */
  readonly size: number;
  /**
   * Documents by cosine similarity to `query`, best first (ties in document order), at most k (Infinity: all), among
   * the ids `filter` accepts; none when the query vector is unusable (null, another length, not finite).
   */
  search(query: readonly number[] | null | undefined, k: number, filter?: (id: string) => boolean): VectorHit[];
};

/** Vectors normalised once at load into one Float32Array; null and wrong-length vectors are skipped. */
export function buildVectorIndex(docs: readonly { id: string; vector: readonly number[] | null }[], dimensions = EMBEDDING_DIMENSIONS): VectorIndex {
  const ids: string[] = [];
  const data = new Float32Array(docs.length * dimensions);
  for (const doc of docs) {
    const unit = unitVector(doc.vector, dimensions);
    if (!unit) continue;
    data.set(unit, ids.length * dimensions);
    ids.push(doc.id);
  }
  return {
    size: ids.length,
    search(query, k, filter) {
      const unit = unitVector(query, dimensions);
      if (!unit) return [];
      const hits: VectorHit[] = [];
      ids.forEach((id, at) => {
        if (filter && !filter(id)) return;
        let dot = 0;
        for (let i = 0, offset = at * dimensions; i < dimensions; i++) dot += data[offset + i]! * unit[i]!;
        hits.push({ id, score: dot });
      });
      return hits.sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}

/** RRF scores: 1 / (k + rank) summed over the rankings; a repeated id counts once per ranking. */
function fuse(rankings: readonly (readonly string[])[], k: number): { id: string; score: number }[] {
  const fused = new Map<string, { score: number; best: number; ranking: number }>();
  rankings.forEach((ranking, index) => {
    const seen = new Set<string>();
    for (const id of ranking) {
      if (seen.has(id)) continue;
      seen.add(id);
      const rank = seen.size;
      const entry = fused.get(id);
      if (!entry) fused.set(id, { score: 1 / (k + rank), best: rank, ranking: index });
      else {
        entry.score += 1 / (k + rank);
        if (rank < entry.best) {
          entry.best = rank;
          entry.ranking = index;
        }
      }
    }
  });
  return [...fused]
    .sort(([idA, a], [idB, b]) => b.score - a.score || a.best - b.best || a.ranking - b.ranking || (idA < idB ? -1 : idA > idB ? 1 : 0))
    .map(([id, { score }]) => ({ id, score }));
}

/**
 * Reciprocal Rank Fusion: ids by fused score. Ties go to the better best rank, then to the earlier ranking, then to the
 * smaller id.
 */
export function fuseRankings(rankings: readonly (readonly string[])[], k = RRF_K): string[] {
  return fuse(rankings, k).map((item) => item.id);
}

export type KnowledgeChunk = { id: string; sourceKind: string; sourceKey: string; title: string; content: string; link: string | null };
export type KnowledgeChunkRow = KnowledgeChunk & { embedding: readonly number[] | null; embeddingModel: string | null };
export type KnowledgeHit = KnowledgeChunk & {
  /** The fused RRF score. */
  score: number;
  /** The rankings that found the chunk: its words, its meaning or both. */
  via: ("lexical" | "vector")[];
};
export type KnowledgeQuery = {
  /** The question (or any text) searched by words; nothing when it has no term. */
  text?: string | null | undefined;
  /** The question's EmbeddingGemma vector; null (embedding failed) searches by words only. */
  vector?: readonly number[] | null | undefined;
  /** Chunks returned at most (DEFAULT_RESULTS). */
  k?: number | undefined;
  /** Only these source kinds, and never these. */
  kinds?: readonly string[] | undefined;
  excludeKinds?: readonly string[] | undefined;
  /** A word match needs at least this BM25 score (default 0: any shared term). */
  minLexicalScore?: number | undefined;
  /** Cosine from which a chunk is close in meaning (MIN_COSINE). */
  minCosine?: number | undefined;
};

const chunkKey = (sourceKind: string, sourceKey: string) => `${sourceKind}\u0000${sourceKey}`;

/** The chunks of the index in memory: BM25 over title + content, vectors of the active embedding model only. */
export class KnowledgeIndex {
  private readonly chunks = new Map<string, KnowledgeChunk>();
  private readonly keys = new Map<string, KnowledgeChunk>();
  private readonly lexical: LexicalIndex;
  private readonly vectors: VectorIndex;

  constructor(rows: readonly KnowledgeChunkRow[], readonly model: string) {
    const kept: KnowledgeChunkRow[] = [];
    for (const row of rows) {
      if (this.chunks.has(row.id)) continue;
      const chunk = { id: row.id, sourceKind: row.sourceKind, sourceKey: row.sourceKey, title: row.title, content: row.content, link: row.link };
      this.chunks.set(row.id, chunk);
      this.keys.set(chunkKey(row.sourceKind, row.sourceKey), chunk);
      kept.push(row);
    }
    this.lexical = buildLexicalIndex(kept.map((row) => ({ id: row.id, title: row.title, text: row.content })));
    this.vectors = buildVectorIndex(kept.map((row) => ({ id: row.id, vector: row.embeddingModel === model ? row.embedding : null })));
  }

  /**
   * The chunks for a question: by words when the text has terms, by meaning when a usable vector is given, fused by RRF.
   * A chunk under minCosine is dropped even when it shares words with an accented question: folded syllables collide
   * ("phở bò" → "pho bo" as in "ứng phó", "bộ binh") and a shared word often has another sense ("quan trọng" /
   * "trọng số"), so the meaning decides. Word matches stay when there is nothing to judge them by (no vector, or the
   * chunk is not embedded yet), when the question has no diacritics (EmbeddingGemma reads "co so du lieu" poorly: 0.27
   * against the course "Cơ sở dữ liệu", 0.63 with accents), when a shared term is a code ("71itse30103", "av7") and when
   * the chunk holds every word of the question and one of its phrases (the English requirement inside a graduation
   * standard that is mostly a course list: cosine 0.28 for "Chuẩn đầu ra tiếng Anh").
   */
  search(query: KnowledgeQuery): KnowledgeHit[] {
    const limit = Math.floor(query.k ?? DEFAULT_RESULTS);
    if (!(limit > 0)) return [];
    const { kinds, excludeKinds } = query;
    const allowed = (id: string) => {
      const kind = this.chunks.get(id)!.sourceKind;
      return (!kinds || kinds.includes(kind)) && !excludeKinds?.includes(kind);
    };
    const minCosine = query.minCosine ?? MIN_COSINE;
    const minLexicalScore = query.minLexicalScore ?? 0;
    const depth = Math.max(limit * 4, FUSION_DEPTH);
    const text = query.text?.normalize("NFC") ?? "";
    const accented = DIACRITIC.test(text);
    const terms = new Set(tokenize(text));
    const words = [...terms].filter((term) => !term.includes(" "));
    const hasPhrase = words.length < terms.size;
    const complete = (hit: LexicalHit) => hasPhrase && words.every((word) => hit.terms.includes(word)) && hit.terms.some((term) => term.includes(" "));

    const cosines = new Map(this.vectors.search(query.vector, Infinity, allowed).map((hit) => [hit.id, hit.score]));
    const vectorRanking = [...cosines].filter(([, cosine]) => cosine >= minCosine).slice(0, depth).map(([id]) => id);
    const lexicalRanking = (terms.size ? this.lexical.search(text, Infinity, allowed) : [])
      .filter((hit) => {
        if (hit.score < minLexicalScore) return false;
        const cosine = cosines.get(hit.id);
        return cosine === undefined || cosine >= minCosine || !accented || hit.terms.some(isCode) || complete(hit);
      })
      .slice(0, depth).map((hit) => hit.id);

    const lexical = new Set(lexicalRanking);
    const vector = new Set(vectorRanking);
    return fuse([lexicalRanking, vectorRanking], RRF_K).slice(0, limit).map(({ id, score }) => ({
      ...this.chunks.get(id)!,
      score,
      via: [...(lexical.has(id) ? ["lexical" as const] : []), ...(vector.has(id) ? ["vector" as const] : [])],
    }));
  }

  byKey(sourceKind: string, sourceKey: string): KnowledgeChunk | undefined {
    return this.keys.get(chunkKey(sourceKind, sourceKey));
  }

  /** Chunks in the index, and how many of them have a usable vector of the model. */
  stats(): { chunks: number; embedded: number } {
    return { chunks: this.chunks.size, embedded: this.vectors.size };
  }
}

let cached: { model: string; version: string; index: KnowledgeIndex } | null = null;
let loading: { model: string; version: string; index: Promise<KnowledgeIndex> } | null = null;

/**
 * The knowledge index with the embeddings of `model`, kept between calls. A cheap version query (row count, newest
 * updated_at, rows embedded by the model) runs on every call; the rows are read again only when it changed, so a chunk
 * rebuilt or embedded since shows up in the next answer. Concurrent calls of one version share one read.
 */
export async function loadKnowledgeIndex(db: Db, model: string): Promise<KnowledgeIndex> {
  const row = (await db.query<{ chunks: number; updated: string | null; embedded: number }>(
    `SELECT count(*)::int AS chunks,max(updated_at)::text AS updated,
        count(*) FILTER (WHERE embedding IS NOT NULL AND embedding_model=$1)::int AS embedded
      FROM ai_knowledge_chunks`, [model])).rows[0];
  const version = `${row?.chunks ?? 0}|${row?.updated ?? ""}|${row?.embedded ?? 0}`;
  if (cached && cached.model === model && cached.version === version) return cached.index;
  if (loading && loading.model === model && loading.version === version) return loading.index;

  const index = readChunks(db, model).then((rows) => {
    const built = new KnowledgeIndex(rows, model);
    cached = { model, version, index: built };
    return built;
  });
  loading = { model, version, index };
  try {
    return await index;
  } finally {
    if (loading?.index === index) loading = null;
  }
}

/** Every chunk; pg reads REAL[] as number[]. Embeddings of other models are not read. */
async function readChunks(db: Db, model: string): Promise<KnowledgeChunkRow[]> {
  const result = await db.query<KnowledgeChunkRow>(
    `SELECT id,source_kind AS "sourceKind",source_key AS "sourceKey",title,content,link,
        CASE WHEN embedding_model=$1 THEN embedding END AS embedding,embedding_model AS "embeddingModel"
      FROM ai_knowledge_chunks ORDER BY source_kind,source_key,id`, [model]);
  return result.rows.map((row) => ({ ...row, embedding: Array.isArray(row.embedding) ? row.embedding : null }));
}
