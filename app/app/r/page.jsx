import { kv } from '@vercel/kv';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const parse = (v) =>
  typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() :
  (v && typeof v === 'object') ? v : null;

export default async function RecipesListPage({ searchParams }) {
  // když přijde ?id=..., rovnou přesměruj na /r/<id>
  if (searchParams?.id) {
    redirect(`/r/${searchParams.id}`);
  }

  // rovnou čteme seznam z KV (žádný fetch)
  const list = await kv.lrange('recipes', 0, -1);
  const items = Array.isArray(list) ? list.map(parse).filter(Boolean) : [];

  return (
    <main style={{maxWidth: 920, margin: '40px auto', padding: 16}}>
      <h1 style={{fontSize: 28, fontWeight: 700, marginBottom: 16}}>Recepty</h1>

      {items.length === 0 ? (
        <p>Zatím žádné recepty. Vlož odkaz na homepage a klikni na <b>Importovat</b>.</p>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16}}>
          {items.map(r => (
            <Link key={r.id} href={`/r/${r.id}`} style={{textDecoration:'none', color:'inherit'}}>
              <article style={{border:'1px solid #eee', borderRadius:12, overflow:'hidden'}}>
                {r.image ? <img src={r.image} alt={r.title} style={{width:'100%', aspectRatio:'16/9', objectFit:'cover'}} /> : null}
                <div style={{padding:12}}>
                  <h2 style={{fontSize:18, margin:'0 0 8px'}}>{r.title}</h2>
                  <p style={{opacity:.75, fontSize:14, margin:0}}>{r.description?.slice(0,120)}</p>
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
