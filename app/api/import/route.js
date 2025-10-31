export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

function cleanText(t) {
  return (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractIngredients($) {
  const selectors = [
    '[itemprop="recipeIngredient"]',
    '[class*="ingredient" i] li',
    'li:has(input[type="checkbox"][name*="ingredient" i])',
    'section:contains("Ingred") li',
    'section:contains("Surov") li'
  ];
  for (const sel of selectors) {
    const items = $(sel).map((_, el) => cleanText($(el).text())).get().filter(Boolean);
    if (items.length >= 3) return items;
  }
  return [];
}

function extractSteps($) {
  const selectors = [
    '[itemprop="recipeInstructions"] li',
    '[class*="instruction" i] li',
    'ol li',
    'section:contains("Postup") li',
    'section:contains("Instructions") li',
  ];
  for (const sel of selectors) {
    const items = $(sel).map((_, el) => cleanText($(el).text())).get().filter(Boolean);
    if (items.length >= 2) return items;
  }
  const paras = $('p').map((_, el) => cleanText($(el).text())).get().filter(Boolean);
  if (paras.length >= 2) return paras;
  return [];
}

function extractMeta($) {
  const time = cleanText($('time,[class*="time" i]').first().text());
  const servings = cleanText(
    $('[itemprop*="serving" i],[class*="serving" i],[class*="portion" i],[class*="porce" i]').first().text()
  );
  return { time: time || undefined, servings: servings || undefined };
}

function guessTags({ title, description, ingredients = [], steps = [] }) {
  const text = [title, description, ingredients.join(' '), steps.join(' ')].join(' ').toLowerCase();
  const tags = new Set();
  if (/(soy|oyster|hoisin|shaoxing|wok|stir-?fry|sesame|bok choy|gai lan|mirin)/.test(text)) tags.add('asijské');
  if (/(tortilla|jalape|chipotle|salsa|cilantro)/.test(text)) tags.add('mexické');
  if (/(parme|mozz|ricotta|basil|bazalk|pomodoro|penne|spag)/.test(text)) tags.add('italské');
  if (/(polévka|soup)/.test(text)) tags.add('polévka');
  if (/(salát|salad)/.test(text)) tags.add('salát');
  if (/(chicken|kuřecí|kuře)/.test(text)) tags.add('kuřecí');
  if (/(beef|hovězí)/.test(text)) tags.add('hovězí');
  if (/(pork|vepřové)/.test(text)) tags.add('vepřové');
  if (/(fish|ryba|losos|treska)/.test(text)) tags.add('ryby');
  if (/(tofu|tempeh|seitan)/.test(text)) tags.add('vegetariánské');
  if (/(15 ?min)/.test(text)) tags.add('do15minut');
  if (/(30 ?min|rychl)/.test(text)) tags.add('do30minut');
  return Array.from(tags);
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get('url');
    if (!target) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });

    const res = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.8',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!res.ok) return new Response(JSON.stringify({ error: 'Fetch failed', status: res.status }), { status: res.status });

    const html = await res.text();
    const dom = new JSDOM(html, { url: target });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const $ = cheerio.load(html);

    const title =
      cleanText($('meta[property="og:title"]').attr('content')) ||
      cleanText($('title').text()) ||
      cleanText(article?.title) ||
      'Recept';

    const description =
      cleanText($('meta[name="description"]').attr('content')) ||
      cleanText(article?.textContent?.slice(0, 200)) ||
      '';

    const image =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    const ingredients = extractIngredients($);
    const steps = extractSteps($);
    const { time, servings } = extractMeta($);

    const payload = {
      id: crypto.randomUUID(),
      title,
      description,
      image,
      ingredients,
      steps,
      servings,
      time,
      tags: guessTags({ title, description, ingredients, steps }),
      source: target
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Importer crashed', message: String(e) }), { status: 500 });
  }
}
