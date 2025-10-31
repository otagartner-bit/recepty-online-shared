import { notFound } from 'next/navigation';

async function getRecipe(id) {
  const res = await fetch(`/api/recipes/${id}`, { cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load');
  return data;
}

export default async function RecipePage({ params }) {
  const { id } = params || {};
  let recipe;
  try {
    recipe = await getRecipe(id);
  } catch {
    notFound();
  }
  if (!recipe || !recipe.title) notFound();

  return (
    <main style={{maxWidth:900, margin:'40px auto', padding:16, fontFamily:'system-ui'}}>
      <a href="/" style={{textDecoration:'none', color:'#555'}}>&larr; Zpět</a>
      <h1 style={{margin:'12px 0 8px'}}>{recipe.title}</h1>

      {recipe.tags?.length ? (
        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:12}}>
          {recipe.tags.map(t => <span key={t} style={{background:'#f1f1f1', borderRadius:999, padding:'4px 8px', fontSize:12}}>#{t}</span>)}
        </div>
      ) : null}

      {recipe.image ? (
        <div style={{aspectRatio:'16/9', background:'#f2f2f2', borderRadius:12, overflow:'hidden', margin:'12px 0'}}>
          <img src={recipe.image} alt={recipe.title} style={{width:'100%', height:'100%', objectFit:'cover'}} />
        </div>
      ) : null}

      {recipe.description && <p style={{color:'#444', lineHeight:1.6}}>{recipe.description}</p>}

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:24, marginTop:24}}>
        <section>
          <h2>Ingredience</h2>
          {recipe.ingredients?.length ? (
            <ul>
              {recipe.ingredients.map((it, i) => <li key={i}>{it}</li>)}
            </ul>
          ) : <p style={{color:'#777'}}>Suroviny se nepodařilo automaticky načíst.</p>}
        </section>
        <section>
          <h2>Postup</h2>
          {recipe.steps?.length ? (
            <ol>
              {recipe.steps.map((it, i) => <li key={i} style={{marginBottom:6}}>{it}</li>)}
            </ol>
          ) : <p style={{color:'#777'}}>Postup se nepodařilo automaticky načíst.</p>}
        </section>
      </div>

      <div style={{marginTop:24, fontSize:14, color:'#666'}}>
        {recipe.time && <span><b>Čas:</b> {recipe.time}</span>} &nbsp;
        {recipe.servings && <span><b>Porce:</b> {recipe.servings}</span>}
      </div>

      {recipe.source && (
        <p style={{marginTop:18}}>
          Zdroj: <a href={recipe.source} target="_blank" rel="noreferrer">{recipe.source}</a>
        </p>
      )}
    </main>
  );
}
