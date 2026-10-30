-- Expand interview ratings while preserving existing booleans and free text.
alter table public.candidate_appointments drop constraint candidate_interview_feedback_shape;
alter table public.candidate_appointments add constraint candidate_interview_feedback_shape check (
  jsonb_typeof(interview_feedback)='object'
  and (interview_feedback - array['punctuality','appearance','communication','smiled']::text[])='{}'::jsonb
  and (not interview_feedback?'punctuality' or (jsonb_typeof(interview_feedback->'punctuality')='string' and interview_feedback->>'punctuality' in ('early','on_time','late_warned','late')))
  and (not interview_feedback?'appearance' or (jsonb_typeof(interview_feedback->'appearance')='string' and length(interview_feedback->>'appearance')<=2000))
  and (not interview_feedback?'communication' or (jsonb_typeof(interview_feedback->'communication')='string' and length(interview_feedback->>'communication')<=2000))
  and (not interview_feedback?'smiled' or (jsonb_typeof(interview_feedback->'smiled')='boolean' or interview_feedback->'smiled'='"occasionally"'::jsonb))
);
