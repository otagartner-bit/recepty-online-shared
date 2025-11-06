export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

/* ---------- fetch setup (víc jako prohlížeč) ---------- */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const HEADERS = {
  'user-agent': UA,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,cs;q=0.8',
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'upgrade-insecure-requests': '1',
};

const clean = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };
const listify = (v) => {
  if (!v) return [];
  if (typeof v === 'string') return [clean(v)];
  if (Array.isArray(v)) return v.map((x) => clean(String(x))).filter(Boolean);
  return [];
};

function okRecipeType(v) {
  if (!v) return false;
  if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase() === 'recipe');
  return String(v).toLowerCase() === 'recipe';
}

function pickRecipe(node) {
  if (!node) return null;
  if (okRecipeType(node['@type'])) return node;

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
  // akceptuje string | HowToStep | Array | HowToSection
  if (!v) return [];
  const out = [];
  const push = (s) => { const t = clean(s); if (t) out.push(t); };
  const walk = (n) => {
    if (!n) return;
    if (typeof n === 'string') { push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.itemListElement) { walk(n.itemListElement); return; }
    // HowToSection může mít .steps nebo .itemListElement
    if (n.steps) { walk(n.steps); return; }
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

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', cache: 'no-store' });
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  const html = await res.text();
  return { html, $: cheerio.load(html) };
}

/* ---------- WPRM parsers ---------- */
function parseWprmIngredients($) {
  // amount + unit + name + notes
  const rows = $(
    '.wprm-recipe-ingredients-container .wprm-recipe-ingredient,' +
    '.wprm-recipe-ingredients .wprm-recipe-ingredient'
  );
  if (rows.length) {
    const items = rows.map((_, el) => {
      const $el = $(el);
      const amount = clean($el.find('.wprm-recipe-ingredient-amount').text());
      const unit   = clean($el.find('.wprm-recipe-ingredient-unit').text());
      const name   = clean(
        $el.find('.wprm-recipe-ingredient-name').text() ||
        $el.find('.wprm-recipe-ingredient').text()
      );
      const notes  = clean($el.find('.wprm-recipe-ingredient-notes').text());
      const joined = [amount, unit, name, notes].filter(Boolean).join(' ');
      return clean(joined || $el.text());
    }).get().filter(Boolean);
    if (items.length) return items;
  }
  // fallback: plain li uvnitř WPRM bloků
  const simple = $(
    '.wprm-recipe-ingredients-container li,' +
    '.wprm-recipe-ingredients li'
  ).map((_, el) => clean($(el).text())).get().filter(Boolean);
  if (simple.length) return simple;

  // fallback: starší WPRM (divy s textem)
  const alt = $(
    '.wprm-recipe-ingredients-container .wprm-recipe-ingredient-group, ' +
    '.wprm-recipe-ingredients .wprm-recipe-ingredient-group'
  ).map((_, el) => clean($(el).text())).get().filter(Boolean);
  return alt;
}

function parseWprmSteps($) {
  const steps = $(
    '.wprm-recipe-instructions-container .wprm-recipe-instruction,' +
    '.wprm-recipe-instruction'
  ).map((_, el) => {
    const $el = $(el);
    const txt = $el.find('.wprm-recipe-instruction-text').text() || $el.text();
    return clean(txt);
  }).get().filter(Boolean);
  if (steps.length) return steps;

  const simple = $(
    '.wprm-recipe-instructions-container li,' +
    '.wprm-recipe-instructions li'
  ).map((_, el) => clean($(el).text())).get().filter(Boolean);
  if (simple.length) return simple;

  const alt = $(
    '.wprm-recipe-instructions-container p,' +
    '.wprm-recipe-instructions p'
  ).map((_, el) => clean($(el).text())) .get().filter(Boolean);
  return alt;
}

/* ---------- generic parsers ---------- */
function parseGenericIngredients($) {
  // schema.org itemprop
  const s1 = $('[itemprop="recipeIngredient"], [itemprop="ingredients"]')
              .map((_, el) => clean($(el).text())).get().filter(Boolean);
  if (s1.length) return s1;

  // běžné bloky
  for (const sel of ['.ingredients', '.ingredient-list', '.recipe-ingredients', '#ingredients']) {
    const items = textListFrom($, $(sel).first());
    if (items.length) return items;
  }
  // podle nadpisu
  return listAfterHeading($, /(ingredients|ingredience|suroviny)/i);
}

function parseGenericSteps($) {
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
  for (const sel of ['.instructions', '.instruction-list', '.recipe-instructions', '#instructions']) {
    const items = textListFrom($, $(sel).first());
    if (items.length) return items;
  }
  return listAfterHeading($, /(instructions|postup|method|directions|kroky)/i);
}

/* ---------- JSON-LD ---------- */
function parseJsonLd($) {
  const scripts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get()
    .filter(Boolean);

  let candidate = null;

  for (const raw of scripts) {
    // některé stránky sekají více JSON objektů do jednoho tagu => zkus rozdělit
    const chunks = raw
      .replace(/<\/?script[^>]*>/gi, '')
      .split(/(?<=\})\s*(?=\{)|\n(?=\s*\{)/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const chunk of chunks) {
      const data = j(chunk);
      if (!data) continue;
      const r = pickRecipe(data);
      if (r) { candidate = r; break; }
    }
    if (candidate) break;
  }
  if (!candidate) return null;

  const title = clean(candidate.name);
  const description = clean(candidate.description);
  const image = clean(Array.isArray(candidate.image) ? candidate.image[0] : candidate.image);
  const ingredients = listify(candidate.recipeIngredient);
  const steps = parseLdSteps(candidate.recipeInstructions);

  return { title, description, image, ingredients, steps };
}

/* ---------- main ---------- */
export async function GET(req) {
  const u = new URL(req.url);
  const target = u.searchParams.get('url');
  const debug = u.searchParams.get('debug') === '1';
  if (!target) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });

  try {
    // 1) stáhni originál
    let { html, $ } = await fetchHtml(target);

    // 2) parse JSON-LD
    let meta = parseJsonLd($);

    // 3) WPRM
    let ingredients = parseWprmIngredients($);
    let steps = parseWprmSteps($);

    // 4) fallbacky
    if (!ingredients.length) ingredients = parseGenericIngredients($);
    if (!steps.length) steps = parseGenericSteps($);

    // 5) AMP (některé blogy mají jednodušší markup)
    if ((!ingredients.length || !steps.length) && !/\/amp\/?$/.test(target)) {
      try {
        const ampUrl = target.replace(/\/$/, '') + '/amp/';
        const amp = await fetchHtml(ampUrl);
        const $amp = amp.$;

        if (!meta) meta = parseJsonLd($amp);
        if (!ingredients.length) {
          ingredients = parseWprmIngredients($amp);
          if (!ingredients.length) ingredients = parseGenericIngredients($amp);
        }
        if (!steps.length) {
          steps = parseWprmSteps($amp);
          if (!steps.length) steps = parseGenericSteps($amp);
        }
      } catch { /* ignore AMP errors */ }
    }

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

    const payload = {
      id: crypto.randomUUID(),
      title, description, image,
      ingredients, steps,
      tags: [],
      source: target,
    };

    if (debug) {
      return new Response(JSON.stringify({ debug: true, payload }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(payload), {
      headers: { 'content-type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
