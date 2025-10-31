'use client';
import { useEffect, useState } from 'react';

const sj = async (r)=>{try{return{ok:r.ok,st:r.status,data:await r.json(),raw:null}}catch(e){return{ok:r.ok,st:r.status,data:null,raw:await r.text().catch(()=> '')}}};

export default function Home(){
  const [items,setItems]=useState([]),[url,setUrl]=useState(''),[q,setQ]=useState(''),[busy,setBusy]=useState(false);

  async function load(){
    const r=await fetch('/api/recipes',{cache:'no-store'}); const j=await sj(r);
    if(!j.ok){alert(`Načtení selhalo (HTTP ${j.st}) ${j.raw||''}`);return;}
    setItems(j.data.items||[]);
  }
  useEffect(()=>{load();},[]);

  async function onImport(){
    if(!url) return alert('Vlož URL');
    setBusy(true);
    const r1=await fetch(`/api/import?url=${encodeURIComponent(url)}`); const j1=await sj(r1);
    if(!j1.ok||j1.data?.error){setBusy(false);return alert(`Import selhal (HTTP ${j1.st}) ${j1.data?.error||j1.raw||''}`);}
    const r2=await fetch('/api/recipes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recipe:j1.data})}); const j2=await sj(r2);
    setBusy(false);
    if(!j2.ok||j2.data?.error) return alert(`Uložení selhalo (HTTP ${j2.st}) ${j2.data?.error||j2.raw||''}`);
    setUrl(''); load();
  }

  async function del(id,title){
    if(!confirm(`Smazat „${title||id}“?`)) return;
    const r=await fetch(`/api/recipes/${id}`,{method:'DELETE'}); const j=await sj(r);
    if(!j.ok||j.data?.error) return alert(`Smazání selhalo (HTTP ${j.st}) ${j.data?.error||j.raw||''}`);
    setItems(x=>x.filter(i=>String(i.id)!==String(id)));
  }

  const filtered = items.filter(i=>!q || i.title?.toLowerCase().includes(q.toLowerCase()) || (i.tags||[]).some(t=>t.toLowerCase().includes(q.toLowerCase())));

  return (
    <main style={{maxWidth:1000,margin:'40px auto',padding:16}}>
      <h1>🍲 Recepty</h1>
      <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8}}>
        <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..." style={{padding:10,border:'1px solid #ddd',borderRadius:8}}/>
        <button disabled={busy} onClick={onImport} style={{padding:'10px 14px',borderRadius:8,background:'#111',color:'#fff'}}> {busy?'Importuji…':'Importovat'} </button>
      </div>
      <div style={{margin:'12px 0'}}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Hledat…" style={{padding:10,border:'1px solid #ddd',borderRadius:8,width:'100%',maxWidth:360}}/></div>
      <p><a href="/debug">🔧 Debug</a> · <a href="/api/ping" target="_blank">/api/ping</a></p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:16}}>
        {filtered.map(r=>(
          <div key={r.id} style={{background:'#fff',border:'1px solid #eee',borderRadius:12,padding:12}}>
            <a href={`/r?id=${encodeURIComponent(r.id)}`} style={{textDecoration:'none',color:'inherit'}}>
              <div style={{aspectRatio:'4/3',background:'#f2f2f2',borderRadius:8,overflow:'hidden',marginBottom:8}}>
                {r.image && <img src={r.image} alt={r.title} style={{width:'100%',height:'100%',objectFit:'cover'}}/>}
              </div>
              <h3 style={{margin:'6px 0'}}>{r.title}</h3>
              <p style={{margin:'6px 0',color:'#555'}}>{r.description||''}</p>
            </a>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{(r.tags||[]).slice(0,6).map(t=><span key={t} style={{background:'#f1f1f1',borderRadius:999,padding:'4px 8px',fontSize:12}}>#{t}</span>)}</div>
              <button onClick={()=>del(r.id,r.title)} style={{background:'#fff',border:'1px solid #e33',color:'#e33',borderRadius:8,padding:'6px 10px'}}>Smazat</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
