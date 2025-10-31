'use client';
import { useMemo, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const sj = async (r)=>{try{return{ok:r.ok,st:r.status,data:await r.json(),raw:null}}catch{ return{ok:r.ok,st:r.status,data:null,raw:await r.text().catch(()=> '')}}};

export default function R() {
  const sp=useSearchParams(); const id=useMemo(()=>sp.get('id')||'',[sp]); const router=useRouter();
  const [r,setR]=useState(null),[err,setErr]=useState(''),[loading,setLoading]=useState(true);

  useEffect(()=>{let alive=true;(async()=>{
    if(!id){setErr('Chybí id');setLoading(false);return;}
    const res=await fetch(`/api/recipes/${id}`,{cache:'no-store'}); const j=await sj(res);
    if(!j.ok||j.data?.error) setErr(j.data?.error||j.raw||`HTTP ${j.st}`); else setR(j.data);
    if(alive) setLoading(false);
  })(); return()=>{alive=false};},[id]);

  async function del(){
    if(!r) return; if(!confirm(`Smazat „${r.title||id}“?`)) return;
    const d=await fetch(`/api/recipes/${id}`,{method:'DELETE'}); const j=await sj(d);
    if(!j.ok||j.data?.error) return alert(`Smazání selhalo (HTTP ${j.st}) ${j.data?.error||j.raw||''}`);
    router.push('/');
  }

  if(loading) return <main style={{maxWidth:900,margin:'40px auto',padding:16}}>Načítám…</main>;
  if(err) return <main style={{maxWidth:900,margin:'40px auto',padding:16}}><a href="/">&larr; Zpět</a><h1>Chyba</h1><p style={{color:'#b00'}}>{err}</p></main>;

  return (
    <main style={{maxWidth:900,margin:'40px auto',padding:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <a href="/">&larr; Zpět</a>
        <button onClick={del} style={{background:'#fff',border:'1px solid #e33',color:'#e33',borderRadius:8,padding:'6px 10px'}}>Smazat</button>
      </div>
      <h1>{r.title}</h1>
      {r.image && <div style={{aspectRatio:'16/9',background:'#f2f2f2',borderRadius:12,overflow:'hidden',margin:'12px 0'}}><img src={r.image} alt={r.title} style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>}
      {r.description && <p style={{color:'#444'}}>{r.description}</p>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,marginTop:24}}>
        <section><h2>Ingredience</h2>{r.ingredients?.length?<ul>{r.ingredients.map((x,i)=><li key={i}>{x}</li>)}</ul>:<p style={{color:'#777'}}>Nenalezeno</p>}</section>
        <section><h2>Postup</h2>{r.steps?.length?<ol>{r.steps.map((x,i)=><li key={i}>{x}</li>)}</ol>:<p style={{color:'#777'}}>Nenalezeno</p>}</section>
      </div>
      <div style={{marginTop:16,color:'#666'}}>{r.time && <>⏱ {r.time} &nbsp;</>}{r.servings && <>🍽 {r.servings}</>}</div>
      {r.source && <p style={{marginTop:18}}>Zdroj: <a href={r.source} target="_blank" rel="noreferrer">{r.source}</a></p>}
    </main>
  );
}
