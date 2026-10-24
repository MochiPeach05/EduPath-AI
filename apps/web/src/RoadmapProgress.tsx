import { useState } from "react";
import {
  auditGroups, auditNote, creditProgress, formatNumber, termLabel, unmatchedNote,
  type AuditMark, type AuditView, type StudyPlanContext, type StudyPlanData, type StudyPlanProjection,
} from "./study-plan-data";

// "Theo dõi tiến độ" of #roadmap (user 2026-10-24, after Stellic's "Track your progress" and "Symbols overview", the
// symbols folded in as "Ý nghĩa các ký hiệu"): the program's requirements with every course's state, official or with the plan.

/** One audit symbol (Stellic's legend), with a label for screen readers. */
export function Mark({ kind, count }: { kind: AuditMark | "remaining" | "retake" | "not_counted" | "equivalent"; count?: number }) {
  const labels: Record<string, [string, string]> = {
    done: ["✓", "Đã hoàn thành"], running: ["✓✓", "Đang học"], planned: ["✓", "Đã lên kế hoạch"], needed: ["", "Còn thiếu"],
    remaining: [String(count ?? ""), `Còn thiếu ${count ?? ""}`], retake: ["↻", "Đã học nhiều lần, chỉ tính một lần"],
    not_counted: ["!", "Không được tính"], equivalent: ["⇄", "Tính qua học phần tương đương"],
  };
  const [glyph, label] = labels[kind]!;
  return <span className={`rm-mark rm-mark-${kind.replace("_", "-")}`} role="img" aria-label={label} title={label}>{glyph}</span>;
}

function ProgressBar({ done, running, planned, total }: { done: number; running: number; planned: number; total: number | null }) {
  const scale = Math.max(total ?? 0, done + running + planned, 1);
  const width = (value: number) => `${Math.min(100, (value / scale) * 100)}%`;
  const remaining = total === null ? null : Math.max(0, total - done - running - planned);
  return <div className="rm-progress">
    <div className="rm-progress-bar" role="img" aria-label={`Đã hoàn thành ${formatNumber(done)} trên ${total === null ? "?" : formatNumber(total)} tín chỉ`}>
      <span className="rm-progress-done" style={{ width: width(done) }} />
      <span className="rm-progress-running" style={{ width: width(running) }} />
      <span className="rm-progress-planned" style={{ width: width(planned) }} />
    </div>
    <ul className="rm-progress-legend">
      <li><Mark kind="done" /> Đã hoàn thành <strong>{formatNumber(done)} TC</strong></li>
      <li><Mark kind="running" /> Đang học <strong>{formatNumber(running)} TC</strong></li>
      {planned > 0 && <li><Mark kind="planned" /> Đã lên kế hoạch <strong>{formatNumber(planned)} TC</strong></li>}
      {remaining !== null && <li><Mark kind="needed" /> Còn thiếu <strong>{formatNumber(remaining)} TC</strong> / {formatNumber(total!)} TC</li>}
    </ul>
  </div>;
}

/** "6/9 TC · còn thiếu 3 TC", "Đã đủ 2 TC (đã học 4 TC)". */
function requirementCount(group: ReturnType<typeof auditGroups>[number]): string {
  const unit = group.unit === "TC" ? "TC" : "môn";
  if (group.required === null) return `${formatNumber(group.counted)} ${unit}`;
  if (group.complete) return `Đã đủ ${formatNumber(group.required)} ${unit}${group.counted > group.required ? ` (đã có ${formatNumber(group.counted)} ${unit})` : ""}`;
  return `${formatNumber(group.counted)}/${formatNumber(group.required)} ${unit} · còn thiếu ${formatNumber(group.remaining ?? 0)} ${unit}`;
}

export function RoadmapTrack({ context, plan, projection }: { context: StudyPlanContext; plan: StudyPlanData; projection: StudyPlanProjection | null }) {
  const [view, setView] = useState<AuditView>("official");
  const credits = creditProgress(context, plan);
  const groups = auditGroups(context, plan, view);
  const running = context.courses.filter((course) => course.state === "in_progress");
  const gpa = context.gpa;
  return <div className="rm-track">
    <section className="sw-panel rm-track-head" aria-labelledby="rm-track-title">
      <header className="rm-track-title">
        <div>
          <h2 id="rm-track-title">Theo dõi tiến độ của bạn</h2>
          <p>{context.graduation ? `Theo ${context.graduation.standardName}.` : "Theo chương trình đào tạo của khóa (chưa có tiêu chuẩn xét tốt nghiệp)."}</p>
        </div>
        <div className="rm-segmented" role="group" aria-label="Chế độ xem">
          <button type="button" aria-pressed={view === "official"} onClick={() => setView("official")}>Chính thức</button>
          <button type="button" aria-pressed={view === "planned"} onClick={() => setView("planned")}>Theo kế hoạch</button>
        </div>
      </header>
      <dl className="rm-facts">
        <div><dt>Chương trình</dt><dd>{context.curriculum?.name ?? "Chưa có chương trình đào tạo"}</dd></div>
        <div><dt>Khóa · Chuyên ngành</dt><dd>{[context.cohortCode, context.specialtyLabel].filter(Boolean).join(" · ") || "Chưa cập nhật"}</dd></div>
        <div><dt>Điểm TB tích lũy</dt><dd>{gpa?.actual != null ? `${formatNumber(gpa.actual)} / ${gpa.scale}` : "—"}{gpa?.required != null && <small> · cần {formatNumber(gpa.required)}</small>}</dd></div>
        <div><dt>Học kỳ đang học</dt><dd>{context.studyTerm && running.length ? `${termLabel(context.studyTerm)} · ${running.length} học phần` : "Không có học phần đang học"}</dd></div>
      </dl>
      <ProgressBar done={credits.done} running={credits.running} planned={view === "planned" ? credits.planned : 0} total={credits.total} />
      <p className="rm-view-note">{view === "official"
        ? "Chính thức: chỉ tính học phần đã có kết quả và học phần đang học theo bảng điểm."
        : "Theo kế hoạch: tính thêm mọi học phần bạn đã xếp ở mục Kế hoạch học kỳ, như thể bạn sẽ học đạt."}
        {view === "planned" && projection && ` Nếu học đạt hết kế hoạch: ${projection.withPlan === "pass" ? "đủ các nhóm học phần của tiêu chuẩn xét tốt nghiệp" : `còn ${projection.openGroups.length} nhóm học phần chưa đủ`}.`}</p>
    </section>

    <section className="sw-panel rm-audit" aria-labelledby="rm-audit-title">
      <h2 id="rm-audit-title">Yêu cầu của chương trình</h2>
      <RoadmapLegend />
      {!context.hasTranscript && <p className="rm-note">Bạn chưa nhập bảng điểm nên mọi học phần đều đang ở trạng thái còn thiếu. Nhập bảng điểm ở Hồ sơ và bảng điểm để theo dõi tiến độ.</p>}
      {!groups.length && <p className="rm-empty">Chưa có tiêu chuẩn xét tốt nghiệp hay chương trình đào tạo cho khóa của bạn.</p>}
      <div className="rm-audit-groups">{groups.map((group) => <details key={group.id} className={`rm-req${group.complete ? " rm-req-done" : ""}`} open={!group.complete}>
        <summary>
          {group.complete ? <Mark kind="done" /> : group.remaining !== null ? <Mark kind="remaining" count={group.remaining} /> : <Mark kind="needed" />}
          <span className="rm-req-title">{group.label}</span>
          <span className="rm-req-count">{requirementCount(group)}</span>
        </summary>
        <ul className="rm-req-rows">{group.rows.map((row) => <li key={row.course.code} className={`rm-req-row rm-row-${row.mark}`}>
          <Mark kind={row.mark} />
          <span className="rm-row-code">{row.course.code}</span>
          <span className="rm-row-name">{row.course.name}{row.course.attempts > 1 && <> <Mark kind="retake" /></>}{row.course.equivalent && <> <Mark kind="equivalent" /><small> qua {row.course.equivalent}</small></>}</span>
          <span className="rm-row-credits">{formatNumber(row.course.credits)} TC</span>
          <span className="rm-row-note">{auditNote(row)}</span>
        </li>)}</ul>
      </details>)}</div>
      {context.unmatched.length > 0 && <div className="rm-unmatched">
        <h3><Mark kind="not_counted" /> Học phần không được tính ({context.unmatched.length})</h3>
        <p>Học phần đã học hoặc đang học nhưng không thuộc yêu cầu nào của chương trình (học phần chuyên ngành khác, học phần ngoài chương trình).</p>
        <ul className="rm-req-rows">{context.unmatched.map((course) => <li key={course.code} className="rm-req-row">
          <Mark kind="not_counted" />
          <span className="rm-row-code">{course.code}</span>
          <span className="rm-row-name">{course.name}</span>
          <span className="rm-row-credits">{formatNumber(course.credits)} TC</span>
          <span className="rm-row-note">{unmatchedNote(course)}</span>
        </li>)}</ul>
      </div>}
    </section>
  </div>;
}

/** The symbols of the audit, folded under the requirements (user 2026-10-24: no tab of its own). */
export function RoadmapLegend() {
  const rows: [Parameters<typeof Mark>[0], string, string][] = [
    [{ kind: "done" }, "Đã hoàn thành", "Học phần hoặc yêu cầu đã đạt. Giống nhau ở chế độ Chính thức và Theo kế hoạch."],
    [{ kind: "needed" }, "Còn thiếu", "Chính thức: chưa học, chưa đăng ký hoặc chưa đạt. Theo kế hoạch: còn chưa có trong kế hoạch của bạn."],
    [{ kind: "running" }, "Đang học", "Học phần bạn đang học trong học kỳ này (đã đăng ký, chưa có điểm)."],
    [{ kind: "planned" }, "Đã lên kế hoạch", "Học phần đã có trong kế hoạch; sẽ được tính khi bạn học đạt. Chỉ thấy ở chế độ Theo kế hoạch."],
    [{ kind: "remaining", count: 3 }, "Số còn thiếu", "Số học phần (hoặc số tín chỉ với nhóm tự chọn) còn thiếu để đủ yêu cầu."],
    [{ kind: "retake" }, "Học nhiều lần", "Học phần đã học hơn một lần (học lại, học cải thiện) nhưng chỉ được tính một lần."],
    [{ kind: "not_counted" }, "Không được tính", "Đã học hoặc đăng ký nhưng không được tính cho yêu cầu nào; được liệt kê ở mục Học phần không được tính ở cuối trang."],
    [{ kind: "equivalent" }, "Học phần tương đương", "Yêu cầu được tính qua một học phần tương đương: mã cũ của học phần, hoặc học phần bạn đã học trả nợ với khóa sau."],
  ];
  return <details className="rm-legend">
    <summary><h2 id="rm-legend-title">Ý nghĩa các ký hiệu</h2><span>Xem bảng ký hiệu</span></summary>
    <p>Các ký hiệu dùng ở Theo dõi tiến độ và Kế hoạch học kỳ.</p>
    <table className="rm-legend-table">
      <thead><tr><th scope="col">Ký hiệu</th><th scope="col">Tên</th><th scope="col">Ý nghĩa</th></tr></thead>
      <tbody>{rows.map(([mark, name, text]) => <tr key={name}><td><Mark {...mark} /></td><th scope="row">{name}</th><td>{text}</td></tr>)}</tbody>
    </table>
    <h3>Học phần không được tính</h3>
    <p>Cuối mục Theo dõi tiến độ là các học phần đã học hoặc đã đăng ký nhưng không thuộc yêu cầu nào của chương trình, ví dụ học phần của chuyên ngành khác hoặc học phần ngoài chương trình đào tạo. Học phần chưa đạt (F, VT) vẫn nằm trong yêu cầu tương ứng, với ký hiệu Còn thiếu.</p>
  </details>;
}
