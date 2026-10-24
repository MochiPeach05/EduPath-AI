import { readFile } from "node:fs/promises";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { DatabasePool } from "../db/pool.js";
import { INTEREST_HOBBY_IDS, INTEREST_TECH_IDS } from "./interests.js";
import { createStudentDataRouter } from "./router.js";

const origin = "https://edupath.example";
function setup() {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
  const connect = vi.fn().mockResolvedValue({ query, release: vi.fn() });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { session: { user: { userId: "student-id", tenantId: "tenant-id", role: "student" } } });
    next();
  });
  app.use("/student", createStudentDataRouter({ connect } as unknown as DatabasePool, origin));
  return { app, query, connect };
}
const patch = (app: express.Express, body: object) => request(app).patch("/student/profile").set("Origin", origin).send(body);

describe("profile interests as choices", () => {
  it("saves both lists together and clears the free text they replace", async () => {
    const { app, query } = setup();
    await patch(app, { interestTech: ["ai_ml", "web_frontend"], interestHobbies: ["reading"] }).expect(200, { saved: true });
    expect(query).toHaveBeenCalledWith("UPDATE student_profiles SET interest_tech=$2,interest_hobbies=$3,interests=NULL WHERE user_id=$1",
      ["student-id", ["ai_ml", "web_frontend"], ["reading"]]);
  });

  it("refuses a missing list, an empty or too long one, a repeat or an unknown choice before the database", async () => {
    for (const body of [
      { interestTech: ["ai_ml"] }, { interestHobbies: ["reading"] },
      { interestTech: [], interestHobbies: ["reading"] },
      { interestTech: ["ai_ml", "game", "uiux", "testing", "security", "mobile"], interestHobbies: ["reading"] },
      { interestTech: ["ai_ml", "ai_ml"], interestHobbies: ["reading"] },
      { interestTech: ["cooking"], interestHobbies: ["reading"] },
      { interestTech: ["ai_ml"], interestHobbies: "reading" },
    ]) {
      const { app, connect } = setup();
      await patch(app, body).expect(400, { error: "invalid_profile" });
      expect(connect).not.toHaveBeenCalled();
    }
  });

  it("leaves the choices alone when a save does not send them", async () => {
    const { app, query } = setup();
    await patch(app, { specialty: "CNPM" }).expect(200);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("interest_tech"))).toBe(false);
  });

  it("offers the same choices as the web page", async () => {
    const source = await readFile(new URL("../../../web/src/profile-interests.ts", import.meta.url), "utf8");
    const ids = [...source.matchAll(/\{ id: "([a-z_]+)", label: "/g)].map((match) => match[1]);
    expect(ids).toEqual([...INTEREST_TECH_IDS, ...INTEREST_HOBBY_IDS]);
  });
});
