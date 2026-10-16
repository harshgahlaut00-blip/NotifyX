'use strict';
const db=require('../jsondb');
const list=async(g,e)=>db.filter('templates',t=>t.guild_id===g&&(e==null||t.event_type==null||t.event_type===e)).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
const get=async(g,n)=>db.find('templates',t=>t.guild_id===g&&String(t.name).toLowerCase()===String(n).toLowerCase());
const getById=async(g,id)=>db.find('templates',t=>t.guild_id===g&&Number(t.id)===Number(id));
const count=async g=>db.ensureState().templates.filter(t=>t.guild_id===g).length;
async function save({guildId,name,eventType,config,createdBy}){let t=db.find('templates',x=>x.guild_id===guildId&&String(x.name).toLowerCase()===String(name).toLowerCase());if(!t)t=db.insert('templates',{guild_id:guildId,name,event_type:eventType??null,config:typeof config==='string'?JSON.parse(config):config??{},created_by:createdBy??null,created_at:db.now()},true);else{t.config=typeof config==='string'?JSON.parse(config):config??{};t.event_type=eventType??null;}await db.persist();return db.clone(t);}
async function remove(g,n){const r=db.remove('templates',t=>t.guild_id===g&&String(t.name).toLowerCase()===String(n).toLowerCase())[0]||null;await db.persist();return r;}
const search=async(g,term,limit=25)=>{const q=String(term||'').toLowerCase();return db.filter('templates',t=>t.guild_id===g&&(!q||String(t.name).toLowerCase().includes(q))).sort((a,b)=>String(a.name).localeCompare(String(b.name))).slice(0,limit);};
module.exports={list,get,getById,count,save,remove,search};
