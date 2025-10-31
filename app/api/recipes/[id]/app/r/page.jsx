'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

async function safeJson(res) {
  try { return { ok: res.ok, status: res.status, data: await res.json(), raw: null }; }
  catch { return { ok: res.ok, status: res.status, data: null, raw: await res.text().catch(()=> '') }; }
}

export default function RecipeDetail() {
  const sp = useSearchParams();
  const id = useMemo(() => sp.get('id') || '', [sp]);
  const router = useRouter();

  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!id) { setErr('Chybí parametr id'); setLoading(false); return; }
      const res = await fetch(`/api/recipes/${id}`, { cache: 'no-store' });
      const j = await safeJson(res);
      if (!j.ok || j.data?.error) setErr(j.data?.error || j.raw || `HTTP ${j.status}`);
      else setR(j.data);
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]);

  async function handleDelete() {
    if (!r) return;
    if (!confirm(`Smazat recept „${r.title ?? id}“?`)) return;
    const res = await fetch(`/api/recipes/${id}`, { method: 'DELETE' });
    const j = await safeJson(res);
    if (!j.ok || j.data?.error) return alert(`Smazání selhalo (HTTP ${j.status}) ${j.data?.error || j.raw || ''}`);
    router.push('/');
  }

  if (loading) return <main style={{maxWidth:900, margin:'40px auto', padding:16}}>Načítám…</main>;
  if (err) return (
    <main style={{maxWidth:900, margin:'40px auto', padding:16}}>
      <a href="/" style={{textDecoration:'none', color:'#555'}}>&larr; Zpět</a>
      <h1>Chyba načtení</h1>
      <p style={{color:'#b00'}}>{err}</p>
    </main>
  );

  return (
    <main style={{maxWidth:900, margin:'40px auto', padding:16, fontFamily:'system-ui'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <a href="/" style={{textDecoration:'none', color:'#555'}}>&larr; Zpět</a>
        <button onClick={handleDelete} style={{background:'#fff', border:'1px solid #e33', color:'#e33', borderRadius:8, padding:'6px 10px', cursor:'pointer'}}>
          Smazat
        </button>
      </div>

      <h1 style={{margin:'12px 0 8px'}}>{r.title}</h1>

      {r.tags?.length ? (
        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:12}}>
          {r.tags.map(t => <span key={t} style={{background:'#f1f1f1', borderRadius:999, padding:'4px 8px', fontSize:12}}>#{t}</span>)}
        </div>
      ) : null}

      {r.image ? (
        <div style={{aspectRatio:'16/9', background:'#f2f2f2', borderRadius:12, overflow:'hidden', margin:'12px 0'}}>
          <img src={r.image} alt={r.title} style={{width:'100%', height:'100%', objectFit:'cover'}} />
        </div>
      ) : null}

      {r.description && <p style={{color:'#444', lineHeight:1.6}}>{r.description}</p>}

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:24, marginTop:24}}>
        <section>
          <h2>Ingredience</h2>
          {r.ingredients?.length ? <ul>{r.ingredients.map((it,i)=><li key={i}>{it}</li>)}</ul>
            : <p style={{color:'#777'}}>Suroviny se nepodařilo automaticky načíst.</p>}
        </section>
        <section>
          <h2>Postup</h2>
          {r.steps?.length ? <ol>{r.steps.map((it,i)=><li key={i} style={{marginBottom:6}}>{it}</li>)}</ol>
            : <p style={{color:'#777'}}>Postup se nepodařilo automaticky načíst.</p>}
        </section>
      </div>

      <div style={{marginTop:24, fontSize:14, color:'#666'}}>
        {r.time && <span><b>Čas:</b> {r.time}</span>} &nbsp;
        {r.servings && <span><b>Porce:</b> {r.servings}</span>}
      </div>

      {r.source && (
        <p style={{marginTop:18}}>
          Zdroj: <a href={r.source} target="_blank" rel="noreferrer">{r.source}</a>
        </p>
      )}
    </main>
  );
}
