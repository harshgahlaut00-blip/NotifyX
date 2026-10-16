'use strict';
const db=require('../jsondb');
const getById=async id=>db.find('content_items',r=>Number(r.id)===Number(id));
const getMany=async(accountId,externalIds)=>db.filter('content_items',r=>Number(r.account_id)===Number(accountId)&&externalIds.includes(r.external_id));
async function upsert(accountId,n){
 let r=db.find('content_items',x=>Number(x.account_id)===Number(accountId)&&x.external_id===n.externalId);
 const vals={account_id:Number(accountId),external_id:n.externalId,kind:n.kind,state:n.state,title:n.title??null,description:n.description??null,url:n.url??null,thumbnail_url:n.thumbnailUrl??null,duration_seconds:n.durationSeconds??null,published_at:n.publishedAt?n.publishedAt.toISOString?.()??n.publishedAt:null,scheduled_start_at:n.scheduledStartAt?n.scheduledStartAt.toISOString?.()??n.scheduledStartAt:null,actual_start_at:n.actualStartAt?n.actualStartAt.toISOString?.()??n.actualStartAt:null,actual_end_at:n.actualEndAt?n.actualEndAt.toISOString?.()??n.actualEndAt:null};
 if(!r) r=db.insert('content_items',{...vals,first_seen_at:db.now(),last_checked_at:db.now(),updated_at:db.now()},true);
 else {Object.assign(r,vals,{last_checked_at:db.now(),updated_at:db.now()});}
 await db.persist();return db.clone(r);
}
async function setState(id,state){const r=db.find('content_items',x=>Number(x.id)===Number(id));if(r){r.state=state;r.last_checked_at=db.now();r.updated_at=db.now();await db.persist();}}
async function listTrackedDue(platform,limit){const st=db.ensureState(),now=Date.now();return st.content_items.filter(ci=>['upcoming','live'].includes(ci.state)).filter(ci=>{const a=st.platform_accounts.find(x=>Number(x.id)===Number(ci.account_id));if(!a||a.platform!==platform)return false;if(!st.subscriptions.some(s=>Number(s.account_id)===Number(ci.account_id)))return false;const due=ci.last_checked_at?now-new Date(ci.last_checked_at).getTime():Infinity;const sched=ci.scheduled_start_at?new Date(ci.scheduled_start_at).getTime():null;return (ci.state==='upcoming'&&(sched==null||sched<=now+20*60000||due>=30*60000))||(ci.state==='live'&&due>=10*60000);}).sort((a,b)=>(a.scheduled_start_at?new Date(a.scheduled_start_at).getTime():0)-(b.scheduled_start_at?new Date(b.scheduled_start_at).getTime():0)).slice(0,limit).map(db.clone);}
const latestForAccount=async(accountId,limit=1)=>db.filter('content_items',r=>Number(r.account_id)===Number(accountId)).sort((a,b)=>(new Date(b.published_at||0)-new Date(a.published_at||0))||(new Date(b.first_seen_at)-new Date(a.first_seen_at))).slice(0,limit);
async function trackedSummary(ids){const out=[];for(const id of ids)for(const state of ['upcoming','live']){const n=db.ensureState().content_items.filter(r=>Number(r.account_id)===Number(id)&&r.state===state).length;if(n)out.push({account_id:Number(id),state,n});}return out;}
async function purgeOld(days){const cut=Date.now()-days*86400000;db.remove('content_items',r=>new Date(r.first_seen_at).getTime()<cut&&!['upcoming','live'].includes(r.state));await db.persist();}
module.exports={getById,getMany,upsert,setState,listTrackedDue,latestForAccount,trackedSummary,purgeOld};
