'use strict';
const db=require('../jsondb');
const get=async key=>(db.find('bot_state',r=>r.key===key)?.value)??null;
async function set(key,value){const r=db.find('bot_state',x=>x.key===key);if(r){r.value=String(value);r.updated_at=db.now();}else db.insert('bot_state',{key,value:String(value),updated_at:db.now()},false);await db.persist();return true;}
module.exports={get,set};
