import { kv } from '@vercel/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeParse(v) {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  if (v && typeof v === 'object') return v;
  return null;
}

export async function GET(_req, { params }) {
  try {
    const { id } = params || {};
    if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400 });

    const direct = await kv.get(`recipe:${id}`);
    if (direct) return new Response(JSON.stringify(safeParse(direct) || direct), { headers: { 'content-type': 'application/json' } });

    const list = await kv.lrange('recipes', 0, -1);
    const found = (list || []).map(safeParse).find(r => r && String(r.id) === String(id));
    if (!found) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

    return new Response(JSON.stringify(found), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
