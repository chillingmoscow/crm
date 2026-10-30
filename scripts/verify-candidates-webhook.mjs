// Local integration test only: creates an isolated account and removes it afterwards.
import {loadEnvFile} from 'node:process';import {randomUUID,randomBytes,createHash} from 'node:crypto';import assert from 'node:assert/strict';import {createClient} from '@supabase/supabase-js';
loadEnvFile('.env.local');const origin=process.env.CANDIDATES_TEST_ORIGIN??'http://127.0.0.1:3001';
for(const url of [origin,process.env.NEXT_PUBLIC_SUPABASE_URL])if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('This verification is restricted to local services');
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}),check=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const owner=check(await admin.from('accounts').select('owner_id').limit(1).single()).owner_id,account=randomUUID(),connection=randomUUID(),secret=randomBytes(32).toString('hex');
check(await admin.from('accounts').insert({id:account,owner_id:owner,name:'Webhook integration QA'}));
try{
 check(await admin.from('candidate_connections').insert({id:connection,account_id:account,created_by:owner,enabled:true,form_id:'form987654321',secret_hash:createHash('sha256').update(secret).digest('hex')}));
 const url=new URL(`/api/webhooks/tilda/candidates/${connection}`,origin),request=(body,key=secret)=>fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-tilda-key':key},body:new URLSearchParams(body),signal:AbortSignal.timeout(15000)});
 assert.equal((await request({test:'test'},'bad-key')).status,401);assert.equal((await request({test:'test'})).status,200);
 assert.equal(check(await admin.from('candidates').select('id').eq('account_id',account)).length,0);
 const input={formid:'form987654321',formname:'Анкета кандидата',tranid:'qa:once',name:'Кандидат Webhook QA',Phone:'+79990009900',position:'Бармен',age:'23',account_id:'cccccccc-0000-0000-0000-000000000001'};
 const replies=await Promise.all(Array.from({length:8},()=>request(input)));assert.ok(replies.every(r=>r.status===200),'Concurrent retry returned an error');
 const rows=check(await admin.from('candidates').select('id,account_id,full_name').eq('account_id',account));assert.equal(rows.length,1);assert.equal(rows[0].account_id,account);
 assert.equal(check(await admin.from('candidate_deliveries').select('id').eq('account_id',account)).length,1);assert.equal(check(await admin.from('candidate_jobs').select('id').eq('account_id',account)).length,1);
 assert.equal((await request({...input,tranid:'qa:new'})).status,200);assert.equal(check(await admin.from('candidates').select('id').eq('account_id',account)).length,2,'A new application from the same phone was collapsed');
 assert.equal((await request({...input,formid:'form1'})).status,422);assert.equal((await request({...input,tranid:''})).status,422);assert.equal((await request({...input,name:'x'.repeat(70000)})).status,413);
 console.log('Webhook integration checks passed: secret, test request, eight concurrent retries, tenant binding, repeat application and size limits.');
}finally{check(await admin.from('accounts').delete().eq('id',account));}
