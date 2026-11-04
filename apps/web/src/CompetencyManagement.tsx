import { useState } from "react";
import { CompetencyGroupsTab, CompetencySkillsTab } from "./CompetencyProfiles";
import { CompetencyCoursesTab } from "./CompetencyCourses";
import "./curricula.css";
import "./competencies.css";

/**
 * The three pages of "Quản lý năng lực", in the order they depend on each other: Nhóm năng lực, then
 * Cấu hình năng lực (the skills that are assessed, each in a group), then Cấu hình môn học (which
 * course trains which skill, and how much).
 */
type CompetencySection = "groups" | "profiles" | "courses";

export default function CompetencyManagement({ canManage, section }: { canManage: boolean; section: CompetencySection }) {
  const [revision, setRevision] = useState(0);
  const saved = () => setRevision(value => value + 1);
  return <section className="cm-workspace comp-workspace">
    {section === "groups" && <CompetencyGroupsTab canManage={canManage} revision={revision} onSaved={saved} />}
    {section === "profiles" && <CompetencySkillsTab canManage={canManage} revision={revision} onSaved={saved} />}
    {section === "courses" && <CourseConfiguration canManage={canManage} revision={revision} onSaved={saved} />}
  </section>;
}

/**
 * "Cấu hình môn học" (2026-10-20): one list of the courses of every CTĐT. A course (code, name and
 * credits) is configured once for every cohort that has it; the cohort is only a filter.
 */
function CourseConfiguration({ canManage, revision, onSaved }: { canManage: boolean; revision: number; onSaved: () => void }) {
  // A cố vấn học tập reads the configurations (AD-CRS-01…04); linking, weighting and the AI are the Quản trị viên's.
  return <>
    <div className="cm-toolbar"><p>{canManage ? "Gắn kỹ năng với từng môn học và chia trọng số." : "Kỹ năng và trọng số của từng môn học."} Mỗi môn (cùng mã, tên và số tín chỉ) chỉ có một cấu hình, dùng chung cho mọi khóa có môn đó; chọn khóa để lọc danh sách.{canManage && " AI có thể đề xuất liên kết và trọng số."}</p></div>
    <CompetencyCoursesTab canManage={canManage} revision={revision} onSaved={onSaved} />
  </>;
}
