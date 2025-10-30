export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

function cleanText(t) {
  return (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- Heuristiky extrakce ---
function extractIngredients($) {
  const selectors = [
    '[itemprop="recipeIngredient"]',
    '[class*="ingredient" i] li',
    'ul li:has(span[class*="ingredient" i])',
    'section:contains("Ingred") li',
    'section:contains("Surov") li',
    'li:has(input[type="checkbox"][name*="ingredient" i])'
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
  // fallback: odstavce
  const paras = $('p').map((_, el) => cleanText($(el).text())).get().filter(Boolean);
  if (paras.length >= 2) return paras;
  return [];
}

function extractMeta($) {
  const time = cleanText($('time[itemprop*="time" i], time, [class*="time" i]').first().text());
  const servings = cleanText(
    $('[itemprop*="serving" i],[class*="serving" i],[class*="portion" i],[class*="porce" i]').first().text()
  );
  return { time, servings };
}

function guessTags({ title, description, ingredients = [], steps = [] }) {
  const text = [title, description, ingredients.join(' '), steps.join(' ')].join(' ').toLowerCase();
  const tags = new Set();

  // kuchyně
  if (/(soy|oyster|hoisin|shaoxing|wok|stir-?fry|sesame|bok choy|gai lan|mirin|gochujang|kimchi)/.test(text)) tags.add('asijské');
  if (/(tortilla|jalape|chipotle|adobo|salsa|cilantro|pozole|queso)/.test(text)) tags.add('mexické');
  if (/(parme|mozz|ricotta|basil|bazalk|pomodoro|penne|spag|rigatoni)/.test(text)) tags.add('italské');
  if (/(svíčková|knedl|kmín|tvaroh|vepřo|zelí)/.test(text)) tags.add('české');
  if (/(garam masala|kurkuma|turmeric|ghee|tikka|dal)/.test(text)) tags.add('indické');
  if (/(sumac|pomegranate molasses|aleppo|tahini|za'atar|zaatar)/.test(text)) tags.add('blízký východ');

  // protein
  if (/(chicken|kuřecí|kuře|drůbež)/.test(text)) tags.add('kuřecí');
  if (/(beef|hovězí|flank|sirloin)/.test(text)) tags.add('hovězí');
  if (/(pork|vepřové|bůček|panenka)/.test(text)) tags.add('vepřové');
  if (/(salmon|tuna|cod|losos|treska|ryba)/.test(text)) tags.add('ryby');
  if (/(tofu|tempeh|seitan)/.test(text)) tags.add('vegetariánské');

  // typ jídla
  if (/(salad|salát|coleslaw)/.test(text)) tags.add('salát');
  if (/(soup|polévka)/.test(text)) tags.add('polévka');
  if (/(noodle|nudle|ramen|udon|chow mein|lo mein)/.test(text)) tags.add('nudle');
  if (/(rice|rýže)/.test(text)) tags.add('rýže');
  if (/(stir-?fry)/.test(text)) tags.add('stirfry');
  if (/(dessert|dezert|sweet)/.test(text)) tags.add('dezert');

  // rychlost / dieta
  if (/(15 ?min|15 ?mins|do 15|minut)/.test(text)) tags.add('do15minut');
  if (/(30 ?min|30 ?mins|do 30|minut|rychlé)/.test(text)) tags.add('do30minut');
  if (/(gluten[- ]?free|bez lepku|corn flour|rice flour)/.test(text)) tags.add('bezlepkové');

  return Array.from(tags);
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get('url');
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });
    }

    // robustní fetch
    const res = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9,cs;q=0.8',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Fetch failed', status: res.status }), { status: res.status });
    }

    const html = await res.text();
    const dom = new JSDOM(html, { url: target });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const $ = cheerio.load(html);

    // meta
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

    // strukturovaná data (pokud jsou)
    let ld = {};
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).contents().text() || '{}');
        // některé stránky mají pole s více objekty
        const arr = Array.isArray(json) ? json : [json];
        for (const obj of arr) {
          if ((obj['@type'] || '').toLowerCase().includes('recipe')) {
            ld = obj;
            break;
          }
        }
      } catch {}
    });

    // ingredience a kroky
    let ingredients = [];
    let steps = [];

    if (ld.recipeIngredient && Array.isArray(ld.recipeIngredient)) {
      ingredients = ld.recipeIngredient.map(cleanText).filter(Boolean);
    }
    if (ld.recipeInstructions) {
      if (Array.isArray(ld.recipeInstructions)) {
        steps = ld.recipeInstructions
          .map((s) => (typeof s === 'string' ? s : s.text || s.name || ''))
          .map(cleanText)
          .filter(Boolean);
      } else if (typeof ld.recipeInstructions === 'string') {
        steps = ld.recipeInstructions.split(/\.\s+|\n+/).map(cleanText).filter(Boolean);
      }
    }

    if (ingredients.length < 3) ingredients = extractIngredients($);
    if (steps.length < 2) steps = extractSteps($);

    const { time, servings } = extractMeta($);

    const payload = {
      id: crypto.randomUUID(),
      title,
      description,
      image,
      ingredients,
      steps,
      servings: servings || undefined,
      time: time || undefined,
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
