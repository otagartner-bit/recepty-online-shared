export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 RecipeImporter/3.0';

const clean = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };

function isRecipe(obj) {
  if (!obj) return false;
  const t = obj['@type'];
  if (!t) return false;
  if (Array.isArray(t)) return t.map(String).includes('Recipe');
  return String(t) === 'Recipe';
}
function pickRecipe(node) {
  if (!node) return null;
  if (isRecipe(node)) return node;
  if (Array.isArray(node)) {
    for (const x of node) { const r = pickRecipe(x); if (r) return r; }
    return null;
  }
  for (const key of ['mainEntity', '@graph', 'graph', 'itemListElement']) {
    const r = pickRecipe(node[key]);
    if (r) return r;
  }
  return null;
}

const listify = (v) => {
  if (!v) return [];
  if (typeof v === 'string') return [clean(v)];
  if (Array.isArray(v)) return v.map((x) => clean(String(x))).filter(Boolean);
  return [];
};

function parseLdSteps(value) {
  if (!value) return [];
  // plain string
  if (typeof value === 'string') return [clean(value)];
  // HowToSection/HowToStep arrays
  const out = [];
  const push = (s) => { const t = clean(s); if (t) out.push(t); };
  const handle = (node) => {
    if (!node) return;
    if (typeof node === 'string') { push(node); return; }
    if (Array.isArray(node)) { node.forEach(handle); return; }
    if (node.itemListElement) { handle(node.itemListElement); return; }
    push(node.text || node.name || node.description || '');
  };
  handle(value);
  return out;
}

function textListFrom($, root) {
  if (!root || root.length === 0) return [];
  const lis = root.find('li');
  if (lis.length) return lis.map((_, el) => clean($(el).text())).get().filter(Boolean);
  const ps = root.find('p');
  if (ps.length) return ps.map((_, el) => clean($(el).text())).get().filter(Boolean);
  const txt = clean(root.text());
  if (!txt) return [];
  if (txt.includes('\n')) return txt.split('\n').map(clean).filter(Boolean);
  return [txt];
}
const firstListBySelectors = ($, sels) => {
  for (const s of sels) {
    const n = $(s).first();
    if (n && n.length) {
      const items = textListFrom($, n);
      if (items.length) return items;
    }
  }
  return [];
};
const listAfterHeading = ($, re) => {
  const hs = $('h1,h2,h3,h4,strong,b').filter((_, el) => re.test(clean($(el).text()).toLowerCase()));
  for (const el of hs) {
    const list = $(el).nextAll('ul,ol').first();
    if (list && list.length) {
      const items = list.find('li').map((_, li) => clean($(li).text())).get().filter(Boolean);
      if (items.length) return items;
    }
  }
  return [];
};

export async function GET(req) {
  try {
    const url = new URL(req.url).searchParams.get('url');
    if (!url) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });

    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'cs,en;q=0.9',
      },
      redirect: 'follow',
      cache: 'no-store',
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

    // --- JSON-LD (schema.org) ---
    let recipe = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      const data = j($(el).contents().text());
      const r = pickRecipe(data);
      if (r && !recipe) recipe = r;
    });

    const title = clean(recipe?.name || ogTitle || 'Recept');
    const description = clean(recipe?.description || ogDesc || '');
    const image = clean(
      (Array.isArray(recipe?.image) ? recipe.image[0] : recipe?.image) || ogImg
    );

    // --- INGREDIENTS ---
    let ingredients = listify(recipe?.recipeIngredient);

    // WPRM (WordPress Recipe Maker) – Pinch of Yum, Love & Lemons, aj.
    if (ingredients.length === 0) {
      const wprmIng = $(
        '.wprm-recipe-ingredients-container .wprm-recipe-ingredient, ' +
        '.wprm-recipe-ingredients .wprm-recipe-ingredient'
      );
      if (wprmIng.length) {
        ingredients = wprmIng
          .map((_, el) => clean($(el).text()))
          .get()
          .filter(Boolean);
      }
    }

    // obecné selektory
    if (ingredients.length === 0) {
      ingredients = firstListBySelectors($, [
        '[itemprop="recipeIngredient"]',
        '[itemprop="ingredients"]',
        'ul[itemprop="recipeIngredient"]',
        'ul[itemprop="ingredients"]',
        '.recipe-ingredients',
        '.ingredients',
        '.ingredient-list',
        '#ingredients',
      ]);
    }

    // fallback podle nadpisu
    if (ingredients.length === 0) {
      ingredients = listAfterHeading($, /(ingredience|ingredients|suroviny)/i);
    }

    // --- STEPS ---
    let steps = parseLdSteps(recipe?.recipeInstructions);

    // WPRM kroky
    if (steps.length === 0) {
      const wprmSteps = $(
        '.wprm-recipe-instructions-container .wprm-recipe-instruction, ' +
        '.wprm-recipe-instruction'
      );
      if (wprmSteps.length) {
        steps = wprmSteps
          .map((_, el) => clean($(el).text()))
          .get()
          .filter(Boolean);
      }
    }

    // obecné selektory/microdata
    if (steps.length === 0) {
      const inst = $(
        '[itemprop="recipeInstructions"], .instructions, .instruction-list, .recipe-instructions, #instructions'
      );
      if (inst.length) {
        const li = inst.find('li');
        steps = li.length
          ? li.map((_, el) => clean($(el).text())).get().filter(Boolean)
          : textListFrom($, inst.first());
      }
    }

    // fallback podle nadpisu
    if (steps.length === 0) {
      steps = listAfterHeading($, /(postup|instructions|method|directions|kroky)/i);
    }

    // TAGS (volitelné)
    let tags = [];
    const keywords = recipe?.keywords || $('meta[name="keywords"]').attr('content') || '';
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
