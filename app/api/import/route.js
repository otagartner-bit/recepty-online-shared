export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 RecipeImporter/2.1';

const clean = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

function findRecipeNode(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = findRecipeNode(x); if (r) return r; }
    return null;
  }
  const type = obj['@type'];
  const isRecipe = type && (Array.isArray(type) ? type.includes('Recipe') : String(type) === 'Recipe');
  if (isRecipe) return obj;
  for (const key of ['mainEntity', '@graph', 'graph', 'itemListElement']) {
    if (obj[key]) { const r = findRecipeNode(obj[key]); if (r) return r; }
  }
  return null;
}

const normList = (v) => {
  if (!v) return [];
  if (typeof v === 'string') return [clean(v)];
  if (Array.isArray(v)) return v.map((x) => clean(String(x))).filter(Boolean);
  return [];
};

function parseLdSteps(v) {
  if (!v) return [];
  if (typeof v === 'string') return [clean(v)];
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const step of v) {
    if (!step) continue;
    if (typeof step === 'string') { out.push(clean(step)); continue; }
    if (Array.isArray(step.itemListElement)) {
      for (const s of step.itemListElement) {
        if (typeof s === 'string') out.push(clean(s));
        else out.push(clean(s.text || s.name || ''));
      }
    } else {
      out.push(clean(step.text || step.name || ''));
    }
  }
  return out.filter(Boolean);
}

function textListFrom($, root) {
  if (!root || root.length === 0) return [];
  const li = root.find('li');
  if (li.length) return li.map((_, el) => clean($(el).text())).get().filter(Boolean);
  const p = root.find('p');
  if (p.length) return p.map((_, el) => clean($(el).text())).get().filter(Boolean);
  const txt = clean(root.text());
  if (!txt) return [];
  if (txt.includes('\n')) return txt.split('\n').map(clean).filter(Boolean);
  return [txt];
}

function firstListBySelectors($, selectors) {
  for (const sel of selectors) {
    const node = $(sel).first();
    if (node && node.length) {
      const items = textListFrom($, node);
      if (items.length) return items;
    }
  }
  return [];
}

function listAfterHeading($, regex) {
  const nodes = $('h1,h2,h3,h4,strong,b').filter((_, el) =>
    regex.test(clean($(el).text()).toLowerCase())
  );
  for (const el of nodes) {
    const list = $(el).nextAll('ul,ol').first();
    if (list && list.length) {
      const items = list.find('li').map((_, li) => clean($(li).text())).get().filter(Boolean);
      if (items.length) return items;
    }
  }
  return [];
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');
    if (!url) {
      return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });
    }

    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'cs,en;q=0.9',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Fetch failed', status: res.status }), { status: res.status });
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // --- META ---
    const ogTitle = clean($('meta[property="og:title"]').attr('content') || $('title').text());
    const ogDesc  = clean($('meta[name="description"]').attr('content') || '');
    const ogImg   = clean($('meta[property="og:image"]').attr('content') || '');

    // --- JSON-LD ---
    let recipeLd = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      const data = parseJson($(el).contents().text());
      const r = findRecipeNode(data);
      if (r && !recipeLd) recipeLd = r;
    });

    const title = clean(recipeLd?.name || ogTitle || 'Recept');
    const description = clean(recipeLd?.description || ogDesc || '');
    const image =
      clean((Array.isArray(recipeLd?.image) ? recipeLd.image[0] : recipeLd?.image) || ogImg) || '';

    // --- INGREDIENTS ---
    let ingredients = normList(recipeLd?.recipeIngredient);
    if (ingredients.length === 0) {
      ingredients = firstListBySelectors($, [
        '[itemprop="recipeIngredient"]',
        '[itemprop="ingredients"]',
        'ul[itemprop="recipeIngredient"]',
        'ul[itemprop="ingredients"]',
        '.ingredients',
        '.ingredient-list',
        '.recipe-ingredients',
        '#ingredients',
      ]);
    }
    if (ingredients.length === 0) {
      ingredients = listAfterHeading($, /(ingredients|ingredience|suroviny)/i);
    }

    // --- STEPS ---
    let steps = parseLdSteps(recipeLd?.recipeInstructions);
    if (steps.length === 0) {
      const inst = $('[itemprop="recipeInstructions"], .instructions, .instruction-list, .recipe-instructions, #instructions');
      if (inst.length) {
        const howTo = inst.find('[itemprop="itemListElement"], [itemprop="step"], [itemprop="HowToStep"]');
        steps = howTo.length
          ? howTo.map((_, el) => clean($(el).text())).get().filter(Boolean)
          : textListFrom($, inst.first());
      }
    }
    if (steps.length === 0) {
      steps = listAfterHeading($, /(instructions|postup|method|directions|kroky)/i);
    }

    // --- TAGS (volitelné) ---
    let tags = [];
    const keywords = recipeLd?.keywords || $('meta[name="keywords"]').attr('content') || '';
    if (typeof keywords === 'string') {
      tags = keywords.split(/[|,;/]/g).map((t) => clean(t.toLowerCase())).filter(Boolean).slice(0, 12);
    }

    return new Response(
      JSON.stringify({
        id: crypto.randomUUID(),
        title,
        description,
        image,
        ingredients,
        steps,
        tags,
        source: url,
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
