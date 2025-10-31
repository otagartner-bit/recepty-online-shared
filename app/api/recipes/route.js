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

// GET – seznam receptů
export async function GET() {
  try {
    let items = [];
    const list = await kv.lrange('recipes', 0, -1);
    if (Array.isArray(list) && list.length > 0) {
      items = list.map(safeParse).filter(Boolean);
    } else {
      const legacy = await kv.get('recepty:items');
      if (Array.isArray(legacy)) {
        items = legacy;
        for (const it of legacy) await kv.rpush('recipes', JSON.stringify(it));
      }
    }
    return new Response(JSON.stringify({ items }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}

// POST – uložení receptu (TOTO je klíčové pro 405)
export async function POST(req) {
  try {
    const { recipe } = await req.json();
    if (!recipe || (!recipe.id && !recipe.title)) {
      return new Response(JSON.stringify({ error: 'Invalid data' }), { status: 400 });
    }
    const item = { id: recipe.id || crypto.randomUUID(), ...recipe };

    // uložení do listu (pro přehled)
    await kv.rpush('recipes', JSON.stringify(item));
    // uložení i pod per-id klíč (pro rychlý detail)
    await kv.set(`recipe:${item.id}`, JSON.stringify(item));

    return new Response(JSON.stringify({ ok: true, item }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
