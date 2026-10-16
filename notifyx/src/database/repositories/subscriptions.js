'use strict';
const db=require('../jsondb');
function withAccount(s){
 const a=db.find('platform_accounts',x=>Number(x.id)===Number(s.account_id)); if(!a)return null;
 return {id:s.id,guild_id:s.guild_id,account_id:s.account_id,enabled:s.enabled,created_by:s.created_by,created_at:s.created_at,platform:a.platform,external_id:a.external_id,account_name:a.name,handle:a.handle,account_url:a.url,avatar_url:a.avatar_url,last_checked_at:a.last_checked_at,last_success_at:a.last_success_at,consecutive_failures:a.consecutive_failures,last_error:a.last_error,push_expires_at:a.push_expires_at};
}
async function create({guildId,accountId,createdBy}){const old=db.find('subscriptions',s=>s.guild_id===guildId&&Number(s.account_id)===Number(accountId));if(old)return null;const r=db.insert('subscriptions',{guild_id:guildId,account_id:Number(accountId),enabled:true,created_by:createdBy??null,created_at:db.now()},true);await db.persist();return r;}
const get=async id=>{const s=db.find('subscriptions',x=>Number(x.id)===Number(id));return s?withAccount(s):null;};
const getForGuild=async(id,guildId)=>{const s=db.find('subscriptions',x=>Number(x.id)===Number(id)&&x.guild_id===guildId);return s?withAccount(s):null;};
const findByGuildAccount=async(g,a)=>db.find('subscriptions',s=>s.guild_id===g&&Number(s.account_id)===Number(a));
const listByGuild=async g=>db.filter('subscriptions',s=>s.guild_id===g).map(withAccount).filter(Boolean).sort((a,b)=>String(a.account_name).localeCompare(String(b.account_name)));
async function search(guildId,term,limit=25){const q=String(term||'').toLowerCase();return db.filter('subscriptions',s=>s.guild_id===guildId).map(withAccount).filter(Boolean).filter(s=>!q||String(s.account_name||'').toLowerCase().includes(q)||String(s.handle||'').toLowerCase().includes(q)).sort((a,b)=>String(a.account_name).localeCompare(String(b.account_name))).slice(0,limit);}
const countByGuild=async g=>db.ensureState().subscriptions.filter(s=>s.guild_id===g).length;
async function remove(id){db.remove('subscriptions',s=>Number(s.id)===Number(id));db.remove('notification_rules',r=>db.ensureState().subscriptions.every(s=>Number(s.id)!==Number(r.subscription_id)));await db.persist();}
async function listDeliverable(accountId,eventType){const st=db.ensureState();return st.subscriptions.filter(s=>Number(s.account_id)===Number(accountId)&&s.enabled).filter(s=>{const g=st.guilds.find(x=>x.guild_id===s.guild_id);return g&&!g.left_at&&g.notifications_enabled;}).filter(s=>st.notification_rules.some(r=>Number(r.subscription_id)===Number(s.id)&&r.event_type===eventType&&r.enabled)).map(s=>({subscription_id:s.id,guild_id:s.guild_id}));}
module.exports={create,get,getForGuild,findByGuildAccount,listByGuild,search,countByGuild,remove,listDeliverable};
