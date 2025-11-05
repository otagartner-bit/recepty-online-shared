// app/r/page.jsx
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = 'force-dynamic';

async function getRecipes() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/recipes`, { cache: 'no-store' });
  if (!res.ok) return { items: [] };
  return res.json();
}

export default async function RecipesListPage({ searchParams }) {
  // pokud přijde ?id=..., rovnou přesměruj na detail
  if (searchParams?.id) {
    redirect(`/r/${searchParams.id}`);
  }

  const { items } = await getRecipes();

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
