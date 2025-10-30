import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
const KEY = 'recepty:items';

export async function GET() {
  const items = (await kv.get(KEY)) || [];
  return new Response(JSON.stringify({ items }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export async function POST(req) {
  const { recipe } = await req.json();
  if (!recipe || !recipe.title) return new Response(JSON.stringify({ error: 'Missing recipe' }), { status: 400 });

  const items = (await kv.get(KEY)) || [];
  const enriched = { ...recipe, createdAt: Date.now() };
  items.unshift(enriched);
  await kv.set(KEY, items);
  return new Response(JSON.stringify({ ok: true, item: enriched }), { status: 201 });
}
