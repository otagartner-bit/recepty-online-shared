import { kv } from '@vercel/kv';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const parse = (v) =>
  typeof v === 'string'
    ? (() => { try { return JSON.parse(v); } catch { return null; } })()
    : v && typeof v === 'object'
    ? v
    : null;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    // ?id=... -> vrať konkrétní recept
    if (id) {
      const raw = await kv.get(`recipe:${id}`);
      const item = parse(raw);
      if (!item) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        }
      return new Response(JSON.stringify(item), { headers: { 'content-type': 'application/json' } });
    }

    // jinak vrať seznam
    const list = await kv.lrange('recipes', 0, -1);
    const items = Array.isArray(list) ? list.map(parse).filter(Boolean) : [];
    return new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { recipe } = await req.json();
    if (!recipe || (!recipe.id && !recipe.title)) {
      return new Response(JSON.stringify({ error: 'Invalid data' }), { status: 400 });
    }
    const item = { id: recipe.id || crypto.randomUUID(), ...recipe };
    await kv.set(`recipe:${item.id}`, JSON.stringify(item));
    await kv.rpush('recipes', JSON.stringify(item));
    return new Response(JSON.stringify({ ok: true, item }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
