-- Existing installations already have this bucket from migration 011.
-- Preserve its privacy and files while adding the formats advertised by the form.
begin;
do $$ begin
 if not exists(select 1 from storage.buckets where id='staff-documents' and not public) then
  raise exception 'Private staff document bucket is required';
 end if;
end $$;
update storage.buckets
 set allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
 where id='staff-documents';
commit;
