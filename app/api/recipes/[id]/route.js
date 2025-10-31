import { kv } from '@vercel/kv';
export const runtime='nodejs'; export const dynamic='force-dynamic';
const parse=v=>typeof v==='string'?(()=>{try{return JSON.parse(v)}catch{return null}})():v&&typeof v==='object'?v:null;

async function findRaw(id){
  const list=await kv.lrange('recipes',0,-1);
  for(const raw of list||[]){ const obj=parse(raw); if(obj&&String(obj.id)===String(id)) return {obj,raw}; }
  return {obj:null,raw:null};
}

export async function GET(_req,{params}) {
  try{
    const id=params?.id; if(!id) return new Response(JSON.stringify({error:'Missing id'}),{status:400});
    const direct=await kv.get(`recipe:${id}`); if(direct) return new Response(JSON.stringify(parse(direct)||direct),{headers:{'content-type':'application/json'}});
    const {obj}=await findRaw(id); if(!obj) return new Response(JSON.stringify({error:'Not found'}),{status:404});
    return new Response(JSON.stringify(obj),{headers:{'content-type':'application/json'}});
  }catch(e){return new Response(JSON.stringify({error:String(e)}),{status:500});}
}

export async function DELETE(_req,{params}) {
  try{
    const id=params?.id; if(!id) return new Response(JSON.stringify({error:'Missing id'}),{status:400});
    const {raw}=await findRaw(id); if(raw) await kv.lrem('recipes',0,raw);
    await kv.del(`recipe:${id}`);
    return new Response(JSON.stringify({ok:true}),{status:200});
  }catch(e){return new Response(JSON.stringify({error:String(e)}),{status:500});}
}
