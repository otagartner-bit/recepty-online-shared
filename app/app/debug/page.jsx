'use client';
import { useEffect, useState } from 'react';
const sj = async (r)=>{try{return{ok:r.ok,st:r.status,data:await r.json(),raw:null}}catch{ return{ok:r.ok,st:r.status,data:null,raw:await r.text().catch(()=> '')}}};

export default function Debug(){
  const [txt,setTxt]=useState('Načítám…'),[items,setItems]=useState([]);
  async function load(){
    const r=await fetch('/api/recipes',{cache:'no-store'}); const j=await sj(r);
    setTxt(`GET /api/recipes -> HTTP ${j.st} ${j.ok?'OK':'ERR'}; raw=${j.raw||''}`); setItems(j.data?.items||[]);
  }
  useEffect(()=>{load();},[]);
  return (
    <main style={{maxWidth:900,margin:'40px auto',padding:16}}>
      <h1>🔧 Debug</h1>
      <p>{txt}</p>
      <ul>{items.map(i=><li key={i.id}><code>{i.id}</code> — {i.title} — <a href={`/r?id=${encodeURIComponent(i.id)}`}>otevřít</a></li>)}</ul>
    </main>
  );
}
