import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LeaseLostError,leasedUpdate} from './job-lease.ts';
import type {LooseDb} from '../supabase/loose.ts';

/** Minimal fake of `from(t).update(v).eq(...).eq(...).select('id')` over one row. */
function fakeDb(row:Record<string,unknown>){
 const calls:Record<string,unknown>[]=[];
 const db={from:(table:string)=>({update:(values:Record<string,unknown>)=>{
  const filters:[string,unknown][]=[];
  const q={eq:(c:string,v:unknown)=>{filters.push([c,v]);return q;},
   select:()=>{const hit=filters.every(([c,v])=>row[c]===v);calls.push({table,values,filters});if(hit)Object.assign(row,values);
    return Promise.resolve({data:hit?[{id:row.id}]:[],error:null});}};
  return q;}})} as unknown as LooseDb;
 return {db,calls,row};
}

test('writes while the job is still this worker\'s attempt',async()=>{
 const f=fakeDb({id:'j1',state:'working',attempts:2});
 await leasedUpdate(f.db,'staff_terminations',{id:'j1',attempts:2},{steps:{a:true}});
 assert.deepEqual(f.row.steps,{a:true});
 assert.deepEqual(f.calls[0].filters,[['id','j1'],['state','working'],['attempts',2]]);
});

test('a job re-claimed after a lease overrun is not overwritten',async()=>{
 const f=fakeDb({id:'j1',state:'working',attempts:3});
 await assert.rejects(leasedUpdate(f.db,'staff_terminations',{id:'j1',attempts:2},{state:'complete'}),LeaseLostError);
 assert.equal(f.row.state,'working');
});

test('a cancelled job is not overwritten',async()=>{
 const f=fakeDb({id:'j1',state:'cancelled',attempts:2});
 await assert.rejects(leasedUpdate(f.db,'staff_restorations',{id:'j1',attempts:2},{state:'error'}),LeaseLostError);
 assert.equal(f.row.state,'cancelled');
});
