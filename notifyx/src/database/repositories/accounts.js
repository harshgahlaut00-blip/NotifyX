'use strict';
const db=require('../jsondb');
async function upsert(a){
 let r=db.ensureState().platform_accounts.find(x=>x.platform===a.platform&&x.external_id===a.externalId);
 if(!r) r=db.insert('platform_accounts',{platform:a.platform,external_id:a.externalId,name:a.name,handle:a.handle??null,url:a.url??null,avatar_url:a.avatarUrl??null,metadata:a.metadata||{},baselined_at:null,last_checked_at:null,last_success_at:null,next_check_at:db.now(),consecutive_failures:0,last_error:null,push_expires_at:null,created_at:db.now()},true);
 else {Object.assign(r,{name:a.name,handle:a.handle??null,url:a.url??null,avatar_url:a.avatarUrl??null,metadata:{...(r.metadata||{}),...(a.metadata||{})}});}
 await db.persist(); return db.clone(r);
}
const getById=async id=>db.find('platform_accounts',r=>Number(r.id)===Number(id));
const getByExternal=async(platform,id)=>db.find('platform_accounts',r=>r.platform===platform&&r.external_id===id);
async function listDue(platform,limit){const now=Date.now();return db.filter('platform_accounts',r=>r.platform===platform&&r.baselined_at&&new Date(r.next_check_at).getTime()<=now).sort((a,b)=>new Date(a.next_check_at)-new Date(b.next_check_at)).slice(0,limit);}
async function markBaselined(id){const r=db.find('platform_accounts',x=>Number(x.id)===Number(id));if(r){r.baselined_at=db.now();await db.persist();}}
async function markChecked(id,seconds){const r=db.find('platform_accounts',x=>Number(x.id)===Number(id));if(r){const n=db.now();r.last_checked_at=n;r.last_success_at=n;r.consecutive_failures=0;r.last_error=null;r.next_check_at=new Date(Date.now()+seconds*1000).toISOString();await db.persist();}}
async function markFailed(id,error,retry){const r=db.find('platform_accounts',x=>Number(x.id)===Number(id));if(r){r.last_checked_at=db.now();r.consecutive_failures=(r.consecutive_failures||0)+1;r.last_error=String(error).slice(0,500);r.next_check_at=new Date(Date.now()+retry*1000).toISOString();await db.persist();}}
async function defer(id,seconds,note){const r=db.find('platform_accounts',x=>Number(x.id)===Number(id));if(r){r.last_checked_at=db.now();r.last_error=note?String(note).slice(0,500):null;r.next_check_at=new Date(Date.now()+seconds*1000).toISOString();await db.persist();}}
async function wakeByExternal(platform,id){const r=db.find('platform_accounts',x=>x.platform===platform&&x.external_id===id);if(r){r.next_check_at=db.now();await db.persist();}}
async function setPushExpiry(id,date){const r=db.find('platform_accounts',x=>Number(x.id)===Number(id));if(r){r.push_expires_at=date instanceof Date?date.toISOString():date;await db.persist();}}
async function listForPushRenewal(platform,hours){const cut=Date.now()+hours*3600000;return db.filter('platform_accounts',r=>r.platform===platform&&r.baselined_at&&db.ensureState().subscriptions.some(s=>Number(s.account_id)===Number(r.id))&&(!r.push_expires_at||new Date(r.push_expires_at).getTime()<cut));}
async function deleteIfOrphan(id){const has=db.ensureState().subscriptions.some(s=>Number(s.account_id)===Number(id));if(has)return null;const removed=db.remove('platform_accounts',r=>Number(r.id)===Number(id))[0]||null;if(removed){db.remove('content_items',r=>Number(r.account_id)===Number(id));await db.persist();}return removed;}
async function purgeOrphans(){const ids=new Set(db.ensureState().subscriptions.map(s=>Number(s.account_id)));db.remove('platform_accounts',r=>!ids.has(Number(r.id)));db.remove('content_items',r=>!ids.has(Number(r.account_id)));await db.persist();}
module.exports={upsert,getById,getByExternal,listDue,markBaselined,markChecked,markFailed,defer,wakeByExternal,setPushExpiry,listForPushRenewal,deleteIfOrphan,purgeOrphans};
