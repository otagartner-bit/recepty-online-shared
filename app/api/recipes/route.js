import { kv } from '@vercel/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeParse(val) {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return null; }
  }
  if (val && typeof val === 'object') return val;
  return null;
}

// GET – vrátí uložené recepty (umí i starý formát)
export async function GET() {
  try {
    let items = [];

    // novější ukládání v listu "recipes"
    const list = await kv.lrange('recipes', 0, -1);
    if (Array.isArray(list) && list.length > 0) {
      items = list.map(safeParse).filter(Boolean);
    } else {
      // legacy: celé pole pod klíčem 'recepty:items'
      const legacy = await kv.get('recepty:items');
      if (Array.isArray(legacy)) {
        items = legacy;

        // volitelná migrace do nového listu:
        for (const it of legacy) {
          await kv.rpush('recipes', JSON.stringify(it));
        }
        // můžeš smazat starý klíč, pokud chceš:
        // await kv.del('recepty:items');
      }
    }

    return new Response(JSON.stringify({ items }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}

// POST – uloží jeden recept
export async function POST(req) {
  try {
    const { recipe } = await req.json();
    if (!recipe || (!recipe.id && !recipe.title)) {
      return new Response(JSON.stringify({ error: 'Invalid data' }), { status: 400 });
    }
    const item = { id: recipe.id || crypto.randomUUID(), ...recipe };
    await kv.rpush('recipes', JSON.stringify(item));
    return new Response(JSON.stringify({ ok: true, item }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
