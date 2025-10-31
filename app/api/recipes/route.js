import { kv } from '@vercel/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET – vrátí uložené recepty (pole)
export async function GET() {
  try {
    const items = (await kv.lrange('recipes', 0, -1)).map(JSON.parse);
    return new Response(JSON.stringify({ items }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}

// POST – uloží jeden recept (objekt {recipe})
export async function POST(req) {
  try {
    const { recipe } = await req.json();
    if (!recipe || !recipe.id) {
      return new Response(JSON.stringify({ error: 'Invalid data' }), { status: 400 });
    }
    await kv.rpush('recipes', JSON.stringify(recipe));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
