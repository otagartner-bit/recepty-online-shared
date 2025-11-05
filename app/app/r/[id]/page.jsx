import { kv } from '@vercel/kv';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const parse = (v) =>
  typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() :
  (v && typeof v === 'object') ? v : null;

export default async function RecipeDetailPage({ params }) {
  const raw = await kv.get(`recipe:${params.id}`);
  const recipe = parse(raw);

  return (
    <main style={{maxWidth: 820, margin: '40px auto', padding: 16}}>
      <div style={{marginBottom:12}}>
        <Link href="/r" style={{textDecoration:'none'}}>← Zpět na seznam</Link>
      </div>

      {!recipe ? (
        <p>Recept nenalezen.</p>
      ) : (
        <>
          <h1 style={{fontSize: 28, fontWeight: 700, margin:'12px 0'}}>{recipe.title}</h1>
          {recipe.image ? (
            <img src={recipe.image} alt={recipe.title} style={{width:'100%', borderRadius:12, marginBottom:16}}/>
          ) : null}
          {recipe.description ? <p style={{fontSize:16, opacity:.85}}>{recipe.description}</p> : null}

          {Array.isArray(recipe.tags) && recipe.tags.length > 0 && (
            <div style={{display:'flex', flexWrap:'wrap', gap:8, margin:'8px 0 16px'}}>
              {recipe.tags.map(t => (
                <span key={t} style={{fontSize:12, border:'1px solid #ddd', padding:'4px 8px', borderRadius:999}}>{t}</span>
              ))}
            </div>
          )}

          {Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0 && (
            <>
              <h2>Ingredience</h2>
              <ul>
                {recipe.ingredients.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </>
          )}

          {Array.isArray(recipe.steps) && recipe.steps.length > 0 && (
            <>
              <h2>Postup</h2>
              <ol>
                {recipe.steps.map((x, i) => <li key={i} style={{marginBottom:8}}>{x}</li>)}
              </ol>
            </>
          )}

          {recipe.source && (
            <p style={{marginTop:24}}>
              Zdroj:&nbsp;<a href={recipe.source} target="_blank" rel="noreferrer">{recipe.source}</a>
            </p>
          )}
        </>
      )}
    </main>
  );
}
