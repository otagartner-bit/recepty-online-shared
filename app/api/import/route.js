export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

/* ---------- helpers ---------- */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const H = {
  'user-agent': UA,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,cs;q=0.8',
};

const clean = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };

const listify = (v) => {
  if (!v) return [];
  if (typeof v === 'string') return [clean(v)];
  if (Array.isArray(v)) return v.map((x) => clean(String(x))).filter(Boolean);
  return [];
};

function isRecipe(o) {
  if (!o) return false;
  const t = o['@type'];
  if (!t) return false;
  if (Array.isArray(t)) return t.some((x) => String(x) === 'Recipe');
  return String(t) === 'Recipe';
}
function pickRecipe(node) {
  if (!node) return null;
  if (isRecipe(node)) return node;
  if (Array.isArray(node)) {
    for (const n of node) { const r = pickRecipe(n); if (r) return r; }
    return null;
  }
  for (const key of ['mainEntity', '@graph', 'graph', 'itemListElement']) {
    const r = pickRecipe(node[key]);
    if (r) return r;
  }
  return null;
}
function parseLdSteps(v) {
  if (!v) return [];
  const out = [];
  const push = (s) => { const t = clean(s); if (t) out.push(t); };
  const walk = (n) => {
    if (!n) return;
    if (typeof n === 'string') { push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.itemListElement) { walk(n.itemListElement); return; }
    push(n.text || n.name || n.description || '');
  };
  walk(v);
  return out;
}

function textListFrom($, root) {
  if (!root || root.length === 0) return [];
  const li = root.find('li');
  if (li.length) return li.map((_, el) => clean($(el).text())).get().filter(Boolean);
  const ps = root.find('p');
  if (ps.length) return ps.map((_, el) => clean($(el).text())).get().filter(Boolean);
  const txt = clean(root.text());
  if (!txt) return [];
  if (txt.includes('\n')) return txt.split('\n').map(clean).filter(Boolean);
  return [txt];
}
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

async function fetchDoc(url) {
  const res = await fetch(url, { headers: H, redirect: 'follow', cache: 'no-store' });
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  const html = await res.text();
  return { $, html, url, $doc: cheerio.load(html) };
}

/* ---------- parser ---------- */
function parseWprmIngredients($) {
  // 1) amount + unit + name (nejpřesnější)
  const rows = $('.wprm-recipe-ingredients-container .wprm-recipe-ingredient,' +
                  '.wprm-recipe-ingredients .wprm-recipe-ingredient');
  if (rows.length) {
    const items = rows.map((_, el) => {
      const $el = $(el);
      const amount = clean($el.find('.wprm-recipe-ingredient-amount').text());
      const unit   = clean($el.find('.wprm-recipe-ingredient-unit').text());
      const name   = clean($el.find('.wprm-recipe-ingredient-name').text() ||
                           $el.find('.wprm-recipe-ingredient').text());
      const notes  = clean($el.find('.wprm-recipe-ingredient-notes').text());
      const joined = [amount, unit, name, notes].filter(Boolean).join(' ');
      return clean(joined || $el.text());
    }).get().filter(Boolean);
    if (items.length) return items;
  }
  // 2) fallback: jen text uzlu
  const simple = $('.wprm-recipe-ingredients-container li,' +
                   '.wprm-recipe-ingredients li').map((_, el) => clean($(el).text())).get().filter(Boolean);
  if (simple.length) return simple;
  return [];
}

function parseWprmSteps($) {
  // WPRM instrukce po blocích
  const steps = $('.wprm-recipe-instructions-container .wprm-recipe-instruction,' +
                  '.wprm-recipe-instruction').map((_, el) => {
    const $el = $(el);
    // preferuj “text” a ignoruj čísla/časovače
    const txt = $el.find('.wprm-recipe-instruction-text').text() || $el.text();
    return clean(txt);
  }).get().filter(Boolean);
  if (steps.length) return steps;

  // fallback: listy
  const simple = $('.wprm-recipe-instructions-container li,' +
                   '.wprm-recipe-instructions li').map((_, el) => clean($(el).text())).get().filter(Boolean);
  return simple;
}

function parseGenericIngredients($) {
  // schema.org itemprop
  const s1 = $('[itemprop="recipeIngredient"], [itemprop="ingredients"]').map((_, el) => clean($(el).text())).get().filter(Boolean);
  if (s1.length) return s1;
  // běžné třídy
  for (const sel of ['.ingredients', '.ingredient-list', '.recipe-ingredients', '#ingredients']) {
    const items = textListFrom($, $(sel).first());
    if (items.length) return items;
  }
  // podle nadpisu
  return listAfterHeading($, /(ingredients|ingredience|suroviny)/i);
}

function parseGenericSteps($) {
  // schema.org itemprop
  const holder = $('[itemprop="recipeInstructions"]').first();
  if (holder && holder.length) {
    const li = holder.find('li');
    if (li.length) return li.map((_, el) => clean($(el).text())).get().filter(Boolean);
    const p = holder.find('p');
    if (p.length) return p.map((_, el) => clean($(el).text())).get().filter(Boolean);
    const txt = clean(holder.text());
    if (txt.includes('\n')) return txt.split('\n').map(clean).filter(Boolean);
    if (txt) return [txt];
  }
  // běžné třídy
  for (const sel of ['.instructions', '.instruction-list', '.recipe-instructions', '#instructions']) {
    const items = textListFrom($, $(sel).first());
    if (items.length) return items;
  }
  // podle nadpisu
  return listAfterHeading($, /(instructions|postup|method|directions|kroky)/i);
}

function parseJsonLd($) {
  let recipe = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const data = j($(el).contents().text());
    const r = pickRecipe(data);
    if (r && !recipe) recipe = r;
  });
  if (!recipe) return null;

  const title = clean(recipe.name);
  const description = clean(recipe.description);
  const image = clean(Array.isArray(recipe.image) ? recipe.image[0] : recipe.image);
  const ingredients = listify(recipe.recipeIngredient);
  const steps = parseLdSteps(recipe.recipeInstructions);
  return { title, description, image, ingredients, steps };
}

/* ---------- main handler ---------- */
export async function GET(req) {
  const url = new URL(req.url).searchParams.get('url');
  if (!url) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });

  try {
    // 1) stáhni originál
    let { $doc: $, html } = await fetchDoc(url);

    // 2) JSON-LD
    let meta = parseJsonLd($);

    // 3) WPRM (Pinch of Yum, Love&Lemons…)
    let ingredients = parseWprmIngredients($);
    let steps = parseWprmSteps($);

    // 4) fallbacky
    if (!ingredients.length) ingredients = parseGenericIngredients($);
    if (!steps.length) steps = parseGenericSteps($);

    // 5) Když je to chudé, zkus i AMP verzi (často jednodušší markup)
    if ((!ingredients.length || !steps.length) && !/\/amp\/?$/.test(url)) {
      try {
        const ampUrl = url.replace(/\/$/, '') + '/amp/';
        const { $doc: $amp } = await fetchDoc(ampUrl);
        if (!ingredients.length) {
          ingredients = parseWprmIngredients($amp);
          if (!ingredients.length) ingredients = parseGenericIngredients($amp);
        }
        if (!steps.length) {
          steps = parseWprmSteps($amp);
          if (!steps.length) steps = parseGenericSteps($amp);
        }
        if (!meta) meta = parseJsonLd($amp);
        $ = $amp;
      } catch { /* ignore AMP errors */ }
    }

    // titulek/obrázek/desc
    const title =
      clean(meta?.title) ||
      clean($('meta[property="og:title"]').attr('content') || $('title').text()) ||
      'Recept';

    const description =
      clean(meta?.description) ||
      clean($('meta[name="description"]').attr('content')) || '';

    const image =
      clean(meta?.image) ||
      clean($('meta[property="og:image"]').attr('content') || '');

    // hotovo
    return new Response(
      JSON.stringify({
        id: crypto.randomUUID(),
        title,
        description,
        image,
        ingredients,
        steps,
        tags: [],
        source: url,
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
