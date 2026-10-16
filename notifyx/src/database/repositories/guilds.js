'use strict';
const db = require('../jsondb');

const UPDATABLE = ['notifications_enabled','default_channel_id','default_category_id','default_role_id'];

async function ensure(guildId, name) {
  let r = db.find('guilds', x => x.guild_id === guildId);
  if (!r) {
    r = db.insert('guilds', { guild_id:guildId, name:name ?? null, notifications_enabled:true, default_channel_id:null, default_category_id:null, default_role_id:null, emoji_overrides:{}, installed_at:db.now(), updated_at:db.now(), left_at:null }, false);
  } else {
    db.replace('guilds', guildId, {}); // no-op; guild ids are strings, handled below
    const raw = db.ensureState().guilds.find(x=>x.guild_id===guildId);
    raw.name = name ?? raw.name; raw.left_at=null; raw.updated_at=db.now(); r=db.clone(raw);
  }
  await db.persist(); return r;
}
const get = async guildId => db.find('guilds', x=>x.guild_id===guildId);
async function update(guildId, patch) {
  const r=db.ensureState().guilds.find(x=>x.guild_id===guildId); if(!r) return null;
  for(const k of UPDATABLE) if(patch[k]!==undefined) r[k]=patch[k];
  r.updated_at=db.now(); await db.persist(); return db.clone(r);
}
async function setEmoji(guildId,key,value) {
  const r=db.ensureState().guilds.find(x=>x.guild_id===guildId); if(!r) return null;
  r.emoji_overrides={...(r.emoji_overrides||{}),[key]:value}; r.updated_at=db.now(); await db.persist(); return db.clone(r);
}
async function clearEmoji(guildId,key) {
  const r=db.ensureState().guilds.find(x=>x.guild_id===guildId); if(!r) return null;
  const e={...(r.emoji_overrides||{})}; delete e[key]; r.emoji_overrides=e; r.updated_at=db.now(); await db.persist(); return db.clone(r);
}
async function markLeft(guildId){const r=db.ensureState().guilds.find(x=>x.guild_id===guildId);if(r){r.left_at=db.now();r.updated_at=db.now();await db.persist();}}
async function markMissingAsLeft(activeIds){const set=new Set(activeIds);for(const r of db.ensureState().guilds)if(!r.left_at&&!set.has(r.guild_id))r.left_at=db.now();await db.persist();}
async function purgeLeft(days){const cutoff=Date.now()-days*86400000;db.remove('guilds',r=>r.left_at&&new Date(r.left_at).getTime()<cutoff);await db.persist();}
async function clearChannelRefs(guildId,channelId){const r=db.ensureState().guilds.find(x=>x.guild_id===guildId);if(r){if(r.default_channel_id===channelId)r.default_channel_id=null;if(r.default_category_id===channelId)r.default_category_id=null;r.updated_at=db.now();await db.persist();}}
async function clearRoleRefs(guildId,roleId){const r=db.ensureState().guilds.find(x=>x.guild_id===guildId);if(r&&r.default_role_id===roleId){r.default_role_id=null;r.updated_at=db.now();await db.persist();}}
module.exports={ensure,get,update,setEmoji,clearEmoji,markLeft,markMissingAsLeft,purgeLeft,clearChannelRefs,clearRoleRefs};
