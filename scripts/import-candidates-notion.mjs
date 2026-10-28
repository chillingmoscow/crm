// Read-only dry run by default. The export must contain the entire October source,
// not the filtered Notion board. Never commit an export with applicant data.
import {readFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {createClient} from '@supabase/supabase-js';
try{loadEnvFile('.env.local');}catch(e){if(e.code!=='ENOENT')throw e;}
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
if(!args.includes('--file')||!args.includes('--account'))throw new Error('Укажите --file и --account. Для записи добавьте --apply');
const account=value('--account'),file=value('--file'),apply=args.includes('--apply');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(!url)throw new Error('Не настроен адрес базы');
if(apply&&!['localhost','127.0.0.1'].includes(new URL(url).hostname)&&!args.includes('--allow-remote'))throw new Error('Удалённый импорт требует --allow-remote после проверки сухого запуска');
const client=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const data=JSON.parse(readFileSync(file,'utf8')),rows=data.rows;
if(!Array.isArray(rows))throw new Error('Неизвестный формат экспорта');
const statuses={'Новая анкета':'new','Можно рассмотреть':'review','Собеседование':'interview','Стажировка':'trial','Не подходит':'rejected'};
const plain=s=>String(s??'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const report={candidates:0,comments:0,files:0,appointments:0,statuses:{},mode:apply?'apply':'dry-run'};
const isOctober=stamp=>{const n=Date.parse(stamp);return n>=Date.parse('2026-10-01T00:00:00+03:00')&&n<Date.parse('2026-11-01T00:00:00+03:00');};
for(const row of rows){
 if(!isOctober(row['Дата заявки']))throw new Error('В экспорте есть анкета вне октября 2026');
 if(row['Статус']==='Принят на работу')throw new Error('Принятую ранее анкету нужно сначала сопоставить с сотрудником');
 const sourceId=new URL(row.url).pathname.split('/').filter(Boolean).at(-1).replace(/-/g,'');
 const social={};if(row.Telegram)social[/vk\.com/i.test(row.Telegram)?'vk':'telegram']=plain(row.Telegram);if(row.Instagram)social.instagram=plain(row.Instagram);
 const discussion=data.discussions?.find(d=>d.url===row.url)?.text??'';
 const input={account_id:account,full_name:plain(row['ФИО']).trim()||'Без имени',phone:plain(row['Телефон'])||null,desired_position:row['Должность']||null,age:row['Возраст']>=14&&row['Возраст']<=100?row['Возраст']:null,address:plain(row['Адрес'])||null,social,education:plain(row['Образование'])||null,experience:plain(row['Опыт'])||null,plans:plain(row['Планы'])||null,family_status:plain(row['Семейное положение'])||null,drivers_license:row['Права']||null,salary_expectation:plain(row['З/П'])||null,status:statuses[row['Статус']]??'unknown',source:'notion',source_id:sourceId,source_url:row.url,submitted_at:new Date(row['Дата заявки']).toISOString(),legacy_data:{properties:row,discussions:discussion}};
 report.candidates++;report.statuses[input.status]=(report.statuses[input.status]??0)+1;
 let id;if(apply){check(await client.from('candidates').upsert(input,{onConflict:'account_id,source,source_id',ignoreDuplicates:true}));id=check(await client.from('candidates').select('id').eq('account_id',account).eq('source','notion').eq('source_id',sourceId).single()).id;}
 const comments=[];
 if(plain(row['Комментарий']).trim())comments.push({source_id:`property:${sourceId}`,source_author:'Комментарий из анкеты Notion · исходное время неизвестно',body:plain(row['Комментарий'])});
 for(const m of discussion.matchAll(/<comment\s+([^>]+)>([\s\S]*?)<\/comment>/g)){const attr=key=>m[1].match(new RegExp(`${key}="([^"]*)"`))?.[1];const user=attr('user-url')??'';const sourceAuthor=decodeURIComponent(user.split('/').at(-1)??'Участник Notion');comments.push({source_id:attr('id'),source_author:sourceAuthor||'Участник Notion',body:plain(m[2]).trim()||'Комментарий без текста',...(attr('datetime')?{created_at:new Date(attr('datetime')).toISOString()}:{} )});}
 report.comments+=comments.length;
 if(apply&&comments.length)check(await client.from('candidate_comments').upsert(comments.map(c=>({...c,account_id:account,candidate_id:id})),{onConflict:'account_id,candidate_id,source_id',ignoreDuplicates:true}));
 let attached=[];try{attached=typeof row['Фотография']==='string'?JSON.parse(row['Фотография']):row['Фотография']??[];}catch{}
 const photos=[...new Set([row['Ссылка на фото'],...attached].filter(p=>typeof p==='string'&&/^https:\/\//.test(p)))];report.files+=photos.length;
 if(apply&&photos.length)check(await client.from('candidate_files').upsert(photos.map(original_url=>({account_id:account,candidate_id:id,name:original_url.includes('drive.google.com/drive/folders/')?'Папка с фотографиями (Google Drive)':'Фотография из Notion',state:original_url.includes('drive.google.com/drive/folders/')?'external':'pending',original_url})),{onConflict:'account_id,candidate_id,original_url',ignoreDuplicates:true}));
 for(const [kind,column] of [['interview','Дата собеседования'],['trial','Стажировка']]){const start=row[`date:${column}:start`];if(!start)continue;report.appointments++;if(apply){const existing=check(await client.from('candidate_appointments').select('id').eq('account_id',account).eq('candidate_id',id).eq('kind',kind).limit(1));if(!existing.length)check(await client.from('candidate_appointments').insert({account_id:account,candidate_id:id,kind,appointment_date:start.slice(0,10),starts_at:row[`date:${column}:is_datetime`]?new Date(start).toISOString():null,timezone:'Europe/Moscow',notes:row['Итоги']?`Результат в Notion: ${row['Итоги']}`:null}));}}
}
console.log(JSON.stringify(report,null,2));
