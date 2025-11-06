export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

/* ---------- robust fetch ---------- */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const COMMON_HEADERS = {
  'user-agent': UA,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,cs;q=0.8',
  'upgrade-insecure-requests': '1',
};

const clean = (t) =>
  (t || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const j = (s) => { try { return JSON.parse(s); } catch { return null; } };
const listify = (v) =>
  Array.isArray(v) ? v.map((x) => clean(String(x))).filter(Boolean)
  : typeof v === 'string' ? [clean(v)]
  : [];

const firstNonEmpty = (...arrs) => {
  for (const a of arrs) if (Array.isArray(a) && a.length) return a;
  return [];
};

async function fetchHtml(url) {
  const headers = {
    ...COMMON_HEADERS,
    referer: new URL(url).origin + '/',
  };
  const res = await fetch(url, { headers, redirect: 'follow', cache: 'no-store' });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const msg = text?.slice(0, 300) || res.statusText || 'Unknown';
    throw new Error(`Fetch ${res.status}: ${msg}`);
  }
  return cheerio.load(text);
}

/* ---------- JSON-LD ---------- */
const isRecipeType = (v) => {
  if (!v) return false;
  if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase() === 'recipe');
  return String(v).toLowerCase() === 'recipe';
};
function pickRecipe(node) {
  if (!node) return null;
  if (isRecipeType(node['@type'])) return node;
  if (Array.isArray(node)) {
    for (const n of node) { const r = pickRecipe(n); if (r) return r; }
    return null;
  }
  for (const k of ['mainEntity', '@graph', 'graph', 'itemListElement']) {
    const r = pickRecipe(node[k]);
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
    if (typeof n === 'string') return push(n);
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.itemListElement) return walk(n.itemListElement);
    if (n.steps) return walk(n.steps);
    push(n.text || n.name || n.description || '');
  };
  walk(v);
  return out;
}
function parseJsonLd($) {
  const scripts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get()
    .filter(Boolean);

  let cand = null;
  for (const raw of scripts) {
    const chunks = raw
      .replace(/<\/?script[^>]*>/gi, '')
      .split(/(?<=\})\s*(?=\{)|\n(?=\s*\{)/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const ch of chunks) {
      const data = j(ch);
      if (!data) continue;
      const r = pickRecipe(data);
      if (r) { cand = r; break; }
    }
    if (cand) break;
  }
  if (!cand) return null;
  return {
    title: clean(cand.name),
    description: clean(cand.description),
    image: clean(Array.isArray(cand.image) ? cand.image[0] : cand.image),
    ingredients: listify(cand.recipeIngredient),
    steps: parseLdSteps(cand.recipeInstructions),
  };
}

/* ---------- pluginy ---------- */
// Tasty
const tastyIngredients = ($) =>
  $('.tasty-recipes .tasty-recipes-ingredients li,.tasty-recipes-ingredients li,.tasty-recipe-ingredients li')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
const tastySteps = ($) => {
  const li = $('.tasty-recipes .tasty-recipes-instructions li,.tasty-recipes-instructions li,.tasty-recipe-instructions li')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
  if (li.length) return li;
  return $('.tasty-recipes .tasty-recipes-instructions p,.tasty-recipes-instructions p')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
};
// WPRM
function wprmIngredients($) {
  const rows = $('.wprm-recipe-ingredients-container .wprm-recipe-ingredient, .wprm-recipe-ingredients .wprm-recipe-ingredient');
  if (rows.length) {
    const items = rows.map((_, el) => {
      const $el = $(el);
      const amount = clean($el.find('.wprm-recipe-ingredient-amount').text());
      const unit = clean($el.find('.wprm-recipe-ingredient-unit').text());
      const name = clean(
        $el.find('.wprm-recipe-ingredient-name').text() ||
        $el.find('.wprm-recipe-ingredient').text()
      );
      const notes = clean($el.find('.wprm-recipe-ingredient-notes').text());
      return clean([amount, unit, name, notes].filter(Boolean).join(' ')) || clean($el.text());
    }).get().filter(Boolean);
    if (items.length) return items;
  }
  return $('.wprm-recipe-ingredients-container li, .wprm-recipe-ingredients li')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
}
function wprmSteps($) {
  const steps = $('.wprm-recipe-instructions-container .wprm-recipe-instruction, .wprm-recipe-instruction')
    .map((_, el) => clean($(el).find('.wprm-recipe-instruction-text').text() || $(el).text()))
    .get().filter(Boolean);
  if (steps.length) return steps;
  return $('.wprm-recipe-instructions-container li, .wprm-recipe-instructions li')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
}
// Mediavine
const mvIngredients = ($) =>
  $('.mv-create-ingredients li, .mv-create-ingredients .mv-create-list-item')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
const mvSteps = ($) =>
  $('.mv-create-instructions li, .mv-create-instructions .mv-create-list-item')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
// WPZOOM
const wpzIngredients = ($) =>
  $('.wpzoom-recipe-card .ingredients-list li,.wp-block-wpzoom-recipe-card-block-recipe-card .ingredients-list li')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
const wpzSteps = ($) =>
  $('.wpzoom-recipe-card .directions-list li,.wp-block-wpzoom-recipe-card-block-recipe-card .directions-list li')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
// EasyRecipe / Yumprint
const easyIngredients = ($) =>
  $('.ERIngredients li, .easyrecipe .ingredients li, .yumprint-recipe-ingredients li')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
const easySteps = ($) =>
  $('.ERInstructions li, .easyrecipe .instructions li, .yumprint-recipe-directions li')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);

/* ---------- heading-based ---------- */
function collectAfterHeading($, headEl) {
  const outBlocks = [];
  let $n = $(headEl).next();
  while ($n && $n.length) {
    if ($n.is('h1,h2,h3,h4,strong,b')) break;

    if ($n.is('ul,ol')) {
      const items = $n.find('li').map((_, li) => clean($(li).text())).get().filter(Boolean);
      if (items.length) outBlocks.push(items);
    }
    if ($n.is('table')) {
      const rows = $n.find('tr').map((_, tr) => {
        const cells = $(tr).find('th,td').map((__, td) => clean($(td).text())) .get().filter(Boolean);
        return clean(cells.join(' '));
      }).get().filter(Boolean);
      if (rows.length) outBlocks.push(rows);
    }
    if ($n.is('p,div,section,article')) {
      const c = $n.clone(); c.find('br').replaceWith('\n');
      const lines = clean(c.text()).split('\n').map(clean).filter(Boolean);
      if (lines.length >= 2) outBlocks.push(lines);
    }

    $n = $n.next();
  }
  const flat = outBlocks.flat().map(clean).filter(Boolean);
  const seen = new Set(); const uniq = [];
  for (const x of flat) if (!seen.has(x)) { seen.add(x); uniq.push(x); }
  return uniq;
}
function headingIngredients($) {
  let nodes = $('h1,h2,h3,h4,strong,b').filter((_, el) =>
    /(ingredients|ingredience|suroviny)/i.test(clean($(el).text()))
  );
  if (nodes.length) {
    const all = []; nodes.each((_, el) => { all.push(...collectAfterHeading($, el)); });
    if (all.length) return all;
  }
  // Ottolenghi – sekce LABNEH / TO SERVE apod.
  const stopRe = /(method|instructions|postup|directions|kroky)/i;
  const subs = $('h2,h3,h4,strong,b').filter((_, el) => {
    const t = clean($(el).text()).toLowerCase();
    return t && !stopRe.test(t) && t.length <= 50;
  });
  if (subs.length) {
    const out = []; subs.each((_, el) => { const b = collectAfterHeading($, el); if (b.length) out.push(...b); });
    if (out.length) return out;
  }
  return [];
}
function headingSteps($) {
  const method = $('h1,h2,h3,h4,strong,b').filter((_, el) =>
    /(method|instructions|postup|directions|kroky)/i.test(clean($(el).text()))
  );
  if (method.length) {
    const items = collectAfterHeading($, method.get(0));
    if (items.length) return items;
  }
  const lastHead = $('h1,h2,h3,h4,strong,b').last();
  if (lastHead && lastHead.length) {
    const maybe = collectAfterHeading($, lastHead);
    if (maybe.length) return maybe;
  }
  return [];
}

/* ---------- text fallback ---------- */
function textFallback($) {
  const $body = $('body').clone();
  $body.find('li,tr').prepend('\n').append('\n');
  $body.find('p,div,section,article').append('\n');
  $body.find('br').replaceWith('\n');

  const raw = clean($body.text()).replace(/\n{2,}/g, '\n');
  const lower = raw.toLowerCase();

  const findIdx = (labels, from = 0) => {
    let idx = -1;
    for (const l of labels) {
      const i = lower.indexOf(l, from);
      if (i !== -1) idx = idx === -1 ? i : Math.min(idx, i);
    }
    return idx;
  };

  const ING = ['\ningredients\n','\ningredience\n','\nsuroviny\n','ingredients\n','ingredience\n','suroviny\n'];
  const STEPS = ['\nmethod\n','\ninstructions\n','\npostup\n','\ndirections\n','method\n','instructions\n','postup\n','directions\n'];

  const iStart = findIdx(ING);
  if (iStart === -1) return { ingredients: [], steps: [] };
  const sStart = findIdx(STEPS, iStart + 1);

  const toLines = (txt) =>
    txt.split('\n').map(clean).filter((x) =>
      x &&
      !/^(ingredients|ingredience|suroviny|method|instructions|postup|directions)$/i.test(x)
    );

  let ingredients = toLines(sStart !== -1 ? raw.slice(iStart, sStart) : raw.slice(iStart));
  let steps = toLines(sStart !== -1 ? raw.slice(sStart) : '');

  // heuristika: sekční nadpisy bez jednotek vyházej, pokud je seznam dost dlouhý
  const looksLikeHeader = (ln) =>
    !/[0-9]/.test(ln) && !/(tsp|tbsp|g|kg|ml|l|cup|cups|oz|ounce|teaspoon|tablespoon)/i.test(ln);
  if (ingredients.length > 6) ingredients = ingredients.filter((ln) => !looksLikeHeader(ln));

  if (steps.length < 3 && steps.join(' ').includes('. ')) {
    steps = steps.join(' ').split(/(?<=\.)\s+/).map(clean).filter(Boolean);
  }

  return { ingredients, steps };
}

/* ---------- generic ---------- */
const genericIngredients = ($) => {
  const s1 = $('[itemprop="recipeIngredient"], [itemprop="ingredients"]')
    .map((_, el) => clean($(el).text())).get().filter(Boolean);
  if (s1.length) return s1;
  for (const sel of ['.ingredients','.ingredient-list','.recipe-ingredients','#ingredients']) {
    const box = $(sel).first();
    if (box?.length) {
      const list = box.find('li').map((_, el) => clean($(el).text())).get().filter(Boolean);
      if (list.length) return list;
    }
  }
  return headingIngredients($);
};
const genericSteps = ($) => {
  const holder = $('[itemprop="recipeInstructions"]').first();
  if (holder?.length) {
    const li = holder.find('li'); if (li.length) return li.map((_, el) => clean($(el).text())).get().filter(Boolean);
    const p = holder.find('p'); if (p.length) return p.map((_, el) => clean($(el).text())).get().filter(Boolean);
    const txt = clean(holder.text());
    if (txt.includes('\n')) return txt.split('\n').map(clean).filter(Boolean);
    if (txt) return [txt];
  }
  for (const sel of ['.instructions','.instruction-list','.recipe-instructions','#instructions']) {
    const box = $(sel).first();
    if (box?.length) {
      const li = box.find('li'); if (li.length) return li.map((_, el) => clean($(el).text())).get().filter(Boolean);
      const p = box.find('p'); if (p.length) return p.map((_, el) => clean($(el).text())).get().filter(Boolean);
    }
  }
  return headingSteps($);
};

/* ---------- handler ---------- */
export async function GET(req) {
  const u = new URL(req.url);
  const target = u.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({
      error: 'Missing url',
      hint: '/api/import?url=https://pinchofyum.com/instant-pot-spicy-short-rib-noodle-soup'
    }), { status: 400 });
  }

  try {
    const $ = await fetchHtml(target);

    // 1) JSON-LD
    let meta = parseJsonLd($);

    // 2) pluginy (první NEprázdné)
    let ingredients = firstNonEmpty(
      tastyIngredients($),
      wprmIngredients($),
      mvIngredients($),
      wpzIngredients($),
      easyIngredients($)
    );
    let steps = firstNonEmpty(
      tastySteps($),
      wprmSteps($),
      mvSteps($),
      wpzSteps($),
      easySteps($)
    );

    // 3) generic / heading
    if (!ingredients.length) ingredients = genericIngredients($);
    if (!steps.length) steps = genericSteps($);

    // 4) AMP fallback
    if ((!ingredients.length || !steps.length) && !/\/amp\/?$/.test(target)) {
      try {
        const ampUrl = target.replace(/\/$/, '') + '/amp/';
        const $amp = await fetchHtml(ampUrl);
        if (!meta) meta = parseJsonLd($amp);
        if (!ingredients.length) ingredients = genericIngredients($amp);
        if (!steps.length) steps = genericSteps($amp);
      } catch { /* ignore */ }
    }

    // 5) text fallback
    if (!ingredients.length || !steps.length) {
      const tf = textFallback($);
      if (!ingredients.length) ingredients = tf.ingredients || [];
      if (!steps.length) steps = tf.steps || [];
    }

    const title =
      clean(meta?.title) ||
      clean($('meta[property="og:title"]').attr('content') || $('title').text()) ||
      'Recept';
    const description =
      clean(meta?.description) ||
      clean($('meta[name="description"]').attr('content')) ||
      '';
    const image =
      clean(meta?.image) ||
      clean($('meta[property="og:image"]').attr('content') || '');

    return new Response(
      JSON.stringify({
        id: crypto.randomUUID(),
        title,
        description,
        image,
        ingredients,
        steps,
        tags: [],
        source: target,
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({
      error: 'Importer failed',
      detail: String(e)
    }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
