'use client';
import { useEffect, useState, useMemo } from 'react';

export default function Page() {
  const [url, setUrl] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  async function refresh() {
    const r = await fetch('/api/recipes', { cache: 'no-store' });
    const data = await r.json();
    setRecipes(data.items || []);
  }
  useEffect(() => { refresh(); }, []);

  async function handleImport() {
    if (!url) return;
    try {
      setLoading(true);
      const imp = await fetch(`/api/import?url=${encodeURIComponent(url)}`);
      if (!imp.ok) throw new Error('Import selhal');
      const recipe = await imp.json();
      const save = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe, source: url })
      });
      if (!save.ok) throw new Error('Uložení selhalo');
      setUrl('');
      await refresh();
      alert('Recept uložen ✅');
    } catch (e) {
      alert(e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return recipes.filter(r =>
      !s ||
      r.title?.toLowerCase().includes(s) ||
      (r.description || '').toLowerCase().includes(s) ||
      (r.tags || []).some(t => t.toLowerCase().includes(s))
    );
  }, [recipes, q]);

  return (
    <main style={{maxWidth: 1000, margin: '40px auto', padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'}}>
      <h1 style={{marginTop:0}}>🍲 Recepty – sdílený katalog</h1>

      <div style={{display:'grid', gridTemplateColumns:'1fr auto', gap:8, margin:'12px 0'}}>
        <input
          placeholder="Vlož URL receptu (https://...)"
          value={url}
          onChange={e=>setUrl(e.target.value)}
          style={{padding:'10px 12px', border:'1px solid #ddd', borderRadius:8}}
        />
        <button
          onClick={handleImport}
          disabled={loading}
          style={{padding:'10px 14px', borderRadius:8, background:'#111', color:'#fff', border:'1px solid #111', cursor:'pointer'}}
        >
          {loading ? 'Importuji…' : 'Importovat'}
        </button>
      </div>

      <div style={{margin:'12px 0'}}>
        <input
          placeholder="Hledat v uložených receptech…"
          value={q}
          onChange={e=>setQ(e.target.value)}
          style={{padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, width:'100%', maxWidth:360}}
        />
      </div>

      {filtered.length === 0 ? (
        <p style={{color:'#666'}}>Zatím žádné recepty. Vlož odkaz výše a klikni na <b>Importovat</b>.</p>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16}}>
          {filtered.map(r => (
            <div key={r.id} style={{background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12, boxShadow:'0 1px 2px rgba(0,0,0,0.05)'}}>
              <div style={{aspectRatio:'4/3', background:'#f2f2f2', borderRadius:8, overflow:'hidden', marginBottom:8}}>
                {r.image && <img src={r.image} alt={r.title} style={{width:'100%', height:'100%', objectFit:'cover'}}/>}
              </div>
              <h3 style={{margin:'6px 0'}}>{r.title}</h3>
              <p style={{margin:'6px 0', color:'#555'}}>{r.description || r.excerpt || ''}</p>
              <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:6}}>
                {(r.tags || []).slice(0,6).map(t => (
                  <span key={t} style={{background:'#f1f1f1', borderRadius:999, padding:'4px 8px', fontSize:12}}>#{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
