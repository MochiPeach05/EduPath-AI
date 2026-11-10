// The student's own rows as the readers of a student's CTĐT, standard and plan read them (the competency inputs, Xét tốt
// nghiệp, Lộ trình học tập): one text each, so Tổng quan, which runs them all in one snapshot, reads each row once there
// (db/reference-cache.ts snapshotReads; 2026-11-10).

/** The profile columns those readers use. */
export const PROFILE_SQL = "SELECT cohort_code,specialty,career_position_id,major_code FROM student_profiles WHERE user_id=$1";
/** The stored transcript as those readers use it. */
export const TRANSCRIPT_SQL = "SELECT version,parsed_data AS data,updated_at FROM student_transcripts WHERE user_id=$1";
