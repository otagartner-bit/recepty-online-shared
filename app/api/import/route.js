export const runtime='nodejs'; export const dynamic='force-dynamic';
import { JSDOM } from 'jsdom'; import { Readability } from '@mozilla/readability'; import * as cheerio from 'cheerio';
const clean=t=>(t||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();

export async function GET(req){
  try{
    const u=new URL(req.url); const target=u.searchParams.get('url'); if(!target) return new Response(JSON.stringify({error:'Missing url'}),{status:400});
    const res=await fetch(target,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0','accept-language':'cs,en;q=0.8'}});
    if(!res.ok) return new Response(JSON.stringify({error:'Fetch failed',status:res.status}),{status:res.status});
    const html=await res.text(); const dom=new JSDOM(html,{url:target}); const reader=new Readability(dom.window.document); const art=reader.parse(); const $=cheerio.load(html);
    const title=clean($('meta[property="og:title"]').attr('content')||$('title').text()||art?.title||'Recept');
    const description=clean($('meta[name="description"]').attr('content')||art?.textContent?.slice(0,200)||'');
    const image=$('meta[property="og:image"]').attr('content')||'';
    const payload={id:crypto.randomUUID(),title,description,image,ingredients:[],steps:[],tags:[],source:target};
    return new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
  }catch(e){return new Response(JSON.stringify({error:String(e)}),{status:500});}
}
