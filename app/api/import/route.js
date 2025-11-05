export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 RecipeImporter/2.0';

const clean = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- helpers ----------
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

const textListFrom = ($, root) => {
  if (!root || root.length === 0) return [];
  // 1) <li>
  const li = root.find('li');
  if (li.length) return li.map((_, el) => clean($(el).text())).get().filter(Boolean);
  // 2) <p>
  const p = root.find('p');
  if (p.length) return p.map((_, el) => clean($(el).text())).get().filter(Boolean);
  // 3) fallback: text rozseknout po řádcích
  const txt = clean(root.text());
  if (txt.includes('\n')) return txt.split('\n').map(clean).filter(Boolean);
  return txt ? [txt] : [];
};

const gatherBySelectors = ($, selectors) => {
  for (const sel of selectors) {
    const node = $(sel).first();
    if (node && node.length) {
      const items = textListFrom($, node);
      if (items.length) return items;
    }
  }
  return [];
};

// JSON-LD: najdi uzel s @type Recipe (i v @graph / mainEntity)
function findRecipeNode(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = findRecipeNode(x); if (r) return r; }
    return null;
  }
  const type = obj['@type'];
  const isRecipe = type && (Array.isArray(type) ? type.includes('Recipe') : String(type) === 'Recipe');
  if (isRecipe) return obj;
  if (obj.mainEntity) { const r = findRecipeNode(obj.mainEntity); if (r) return r; }
  if (obj['@graph']) { const r = findRecipeNode(obj['@graph']); if (r) return r; }
  if (obj.graph) { const r = findRecipeNode(obj.graph); if (r) return r; }
  if (obj.itemListElement) { const r = findRecipeNode(obj.itemListElement); if (r) return r; }
  return null;
}

const normalizeList = (v) => {
  if (!v) return [];
  if (typeof v === 'string') return [clean(v)];
  if (Array.isArray(v)) return v.map(x => clean(String(x))).filter(Boolean);
  return [];
};

const parseLdSteps = (v) => {
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
};

// Nadpis → nejbližší následující list
const listAfterHeading = ($, regex) => {
  const candidates = $('h1,h2,h3,h4,strong,b').filter((_, el) =>
    regex.test(clean($(el).text()).toLowerCase())
  );
  for (const el of candidates) {
    const list = $(el).nextAll('ul,ol').first();
    if (list && list.length) {
      const items = list.find('li').map((_, li) => clean($(li).text())).get().filter(Boolean);
      if (items.length) return items;
    }
  }
  return [];
};

// ---------- main GET ----------
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');
    if (!url) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });

    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'cs,en;q=0.9',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Fetch failed', status: res.status }), { status: res.status });
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // ---------- META ----------
    const ogTitle = clean($('meta[property="og:title"]').attr('content') || $('title').text());
    const ogDesc  = clean($('meta[name="description"]').attr('content') || '');
    const ogImg   = clean($('meta[property="og:image"]').attr('content') || '');

    // ---------- JSON-LD ----------
    let recipeLd = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).contents().text();
      const data = parseJson(raw);
      const r = findRecipeNode(data);
      if (r && !recipeLd) recipeLd = r;
    });

    let title = clean(recipeLd?.name || ogTitle || 'Recept');
    let description = clean(recipeLd?.description || ogDesc || '');
    let image = clean(
      (Array.isArray(recipeLd?.image) ? recipeLd.image[0] : recipeLd?.image) || ogImg
    ) || '';

    // ---------- INGREDIENTS ----------
    let ingredients = [];
    if (recipeLd?.recipeIngredient) {
      ingredients = normalizeList(recipeLd.recipeIngredient);
    }
    if (ingredients.length === 0) {
      // microdata + běžné selektory
      ingredients = gatherBySelectors($, [
        '[itemprop="recipeIngredient"]',
        '[itemprop="ingredients"]',
        'ul[itemprop="recipeIngredient"]',
        'ul[itemprop="ingredients"]',
        'ul[class*="ingredient"]',
        'ul#ingredients',
        '.ingredients',
        '.ingredient-list',
        '.recipe-ingredients',
        '#ingredients',
      ]);
    }
    if (ingredients.length === 0) {
      // nadpisy v češtině/angličtině
      ingredients = listAfterHeading($, /(ingredients|ingredience|suroviny)/i);
    }

    // ---------- STEPS ----------
    let steps = [];
    if (recipeLd?.recipeInstructions) {
      steps = parseLdSteps(recipeLd.recipeInstructions);
    }
    if (steps.length === 0) {
      // microdata HowToStep / text
      const inst = $('[itemprop="recipeInstructions"]');
      if (inst.length) {
        const howTo = inst.find('[itemprop="itemListElement"], [itemprop="step"], [itemprop="HowToStep"]');
        if (howTo.length) {
          steps = howTo.map((_, el) => clean($(el).text())).get().filter(Boolean);
        } else {
          steps = textListFrom($, inst.first());
        }
     
