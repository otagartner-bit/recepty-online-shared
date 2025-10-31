'use client';
import { useEffect, useState } from 'react';

async function safeJson(res) {
  // Bezpečné parsování – když to není JSON, vrátí text + status
  try {
    const data = await res.json();
    return { ok: res.ok, status: res.status, data, raw: null };
  } catch {
    const raw = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, data: null, raw };
  }
}

export default function Home() {
  const [recipes, setRecipes] = useState([]);
  const [filter, setFilter] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    const r = await fetch('/api/recipes', { cache: 'no-store' });
    const { ok, status, data, raw } = await safeJson(r);
    if (!ok) {
      alert(`Chyba při načítání seznamu (HTTP ${status}) ${raw || ''}`.trim());
      return;
    }
    setRecipes(data.items || []);
  }

  useEffect(() => { load(); }, []);

  async function handleImport() {
    if (!url) return alert('Vlož URL receptu (https://...)');
    setLoading(true);
    try {
      // 1) Import z cílové stránky
      const r1 = await fetch(`/api/import?url=${encodeURIComponent(url)}`);
      const j1 = await safeJson(r1);
      if (!j1.ok) {
        throw new Error(`Import selhal (HTTP ${j1.status}) ${j1.data?.error || j1.raw || ''}`.trim());
      }
      if (j1.data?.error) {
        throw new Error(`Import selhal: ${j1.data.error} ${j1.data.message || ''}`.trim());
      }
      const recipe = j1.data;

      // 2) Uložení do KV
      const r2 = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipe })
      });
      const j2 = await safeJson(r2);
      if (!j2.ok || j2.data?.error) {
        throw new Error(`Uložení selhalo (HTTP ${j2.status}) ${j2.data?.error || j2.raw || ''}`.trim());
      }

      setUrl('');
      await load();
      alert('Recept uložen ✅');
    } catch (e) {
      alert(e.message || 'Chyba importu/uložení');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = recipes.filter(r =>
    !filter ||
    r.title?.toLowerCase().includes(filter.toLowerCase()) ||
    (r.tags || []).some(t => t.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <main style={{maxWidth: 1000, margin: '40px auto', padding: 16}}>
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
          placeholder="Hledat podle názvu nebo štítku…"
          value={filter}
          onChange={e=>setFilter(e.target.value)}
          style={{padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, width:'100%', maxWidth:360}}
        />
      </div>

      {filtered.length === 0 ? (
        <p style={{color:'#666'}}>Zatím žádné recepty. Vlož odkaz výše a klikni na <b>Importovat</b>.</p>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16}}>
          {filtered.map(r => (
            <a key={r.id} href={`/recipe/${r.id}`} style={{textDecoration:'none', color:'inherit'}}>
              <div style={{background:'#fff', border:'1px solid #eee', borderRadius:12, padding:12, boxShadow:'0 1px 2px rgba(0,0,0,0.05)'}}>
                <div style={{aspectRatio:'4/3', background:'#f2f2f2', borderRadius:8, overflow:'hidden', marginBottom:8}}>
                  {r.image && <img src={r.image} alt={r.title} style={{width:'100%', height:'100%', objectFit:'cover'}}/>}
                </div>
                <h3 style={{margin:'6px 0'}}>{r.title}</h3>
                <p style={{margin:'6px 0', color:'#555'}}>{r.description || ''}</p>
                <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:6}}>
                  {(r.tags || []).slice(0,6).map(t => (
                    <span key={t} style={{background:'#f1f1f1', borderRadius:999, padding:'4px 8px', fontSize:12}}>#{t}</span>
                  ))}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
