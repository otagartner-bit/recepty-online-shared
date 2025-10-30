import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

export const dynamic = 'force-dynamic';

function cleanText(t){ return (t||'').replace(/\s+/g,' ').replace(/\u00a0/g,' ').trim(); }

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');
  if (!target) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });

  const res = await fetch(target, { headers: { 'user-agent': 'Mozilla/5.0 (RecipeImporter/1.0)' } });
  if (!res.ok) return new Response(JSON.stringify({ error: 'Fetch failed', status: res.status }), { status: res.status });

  const html = await res.text();
  const dom = new JSDOM(html, { url: target });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const $ = cheerio.load(html);

  const title = cleanText($('meta[property="og:title"]').attr('content') || $('title').text() || article?.title || 'Recept');
  const description = cleanText($('meta[name="description"]').attr('content') || article?.textContent?.slice(0,200) || '');
  const image = $('meta[property="og:image"]').attr('content') || '';
  const text = cleanText(article?.textContent || '');

  return new Response(JSON.stringify({
    id: crypto.randomUUID(),
    title,
    description,
    image,
    text
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}
