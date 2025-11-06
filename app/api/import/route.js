export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

/* ------------ fetch like a browser ------------ */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const HEADERS = {
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
  Array.isArray(v)
    ? v.map((x) => clean(String(x))).filter(Boolean)
    : typeof v === 'string'
    ? [clean(v)]
    : [];

/* ---- IMPORTANT: pick first non-empty array ---- */
const firstNonEmpty = (...arrs) => {
  for (const a of arrs) if (Array.isArray(a) && a.length) return a;
  return [];
};

/* ------------ helpers ------------ */
function okRecipeType(v) {
  if (!v) return false;
  if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase() === 'recipe');
  return String(v).toLowerCase() === 'recipe';
}
function pickRecipe(node) {
  if (!node) return null;
  if (okRecipeType(node['@type'])) return node;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = pickRecipe(n);
      if (r) return r;
    }
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
  const push = (s) => {
    const t = clean(s);
    if (t) out.push(t);
  };
  const walk = (n) => {
    if (!n) return;
    if (typeof n === 'string') {
      push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (n.itemListElement) {
      walk(n.itemListElement);
      return;
    }
    if (n.steps) {
      walk(n.steps);
      return;
    }
    push(n.text || n.name || n.description || '');
  };
  walk(v);
  return out;
}
async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', cache: 'no-store' });
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  const html = await res.text();
  return { $, html, url, $: cheerio.load(html) };
}

/* ------------ JSON-LD ------------ */
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
      if (r) {
        cand = r;
        break;
      }
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

/* ------------ known plugins ------------ */
// Tasty Recipes
function tastyIngredients($) {
  return $(
    '.tasty-recipes .tasty-recipes-ingredients li,' +
      '.tasty-recipes-ingredients li,' +
      '.tasty-recipe-ingredients li'
  )
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}
function tastySteps($) {
  const li = $(
    '.tasty-recipes .tasty-recipes-instructions li,' +
      '.tasty-recipes-instructions li,' +
      '.tasty-recipe-instructions li'
  )
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  if (li.length) return li;
  const p = $(
    '.tasty-recipes .tasty-recipes-instructions p,' + '.tasty-recipes-instructions p'
  )
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  return p;
}
// WPRM
function wprmIngredients($) {
  const rows = $(
    '.wprm-recipe-ingredients-container .wprm-recipe-ingredient, .wprm-recipe-ingredients .wprm-recipe-ingredient'
  );
  if (rows.length) {
    const items = rows
      .map((_, el) => {
        const $el = $(el);
        const amount = clean($el.find('.wprm-recipe-ingredient-amount').text());
        const unit = clean($el.find('.wprm-recipe-ingredient-unit').text());
        const name = clean(
          $el.find('.wprm-recipe-ingredient-name').text() ||
            $el.find('.wprm-recipe-ingredient').text()
        );
        const notes = clean($el.find('.wprm-recipe-ingredient-notes').text());
        const joined = [amount, unit, name, notes].filter(Boolean).join(' ');
        return clean(joined || $el.text());
      })
      .get()
      .filter(Boolean);
    if (items.length) return items;
  }
  const simple = $(
    '.wprm-recipe-ingredients-container li, .wprm-recipe-ingredients li'
  )
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  return simple;
}
function wprmSteps($) {
  const steps = $(
    '.wprm-recipe-instructions-container .wprm-recipe-instruction, .wprm-recipe-instruction'
  )
    .map((_, el) =>
      clean($(el).find('.wprm-recipe-instruction-text').text() || $(el).text())
    )
    .get()
    .filter(Boolean);
  if (steps.length) return steps;
  const simple = $(
    '.wprm-recipe-instructions-container li, .wprm-recipe-instructions li'
  )
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  return simple;
}
// Mediavine Create
function mvIngredients($) {
  return $('.mv-create-ingredients li, .mv-create-ingredients .mv-create-list-item')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}
function mvSteps($) {
  return $('.mv-create-instructions li, .mv-create-instructions .mv-create-list-item')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}
// WPZOOM
function wpzoomIngredients($) {
  return $(
    '.wpzoom-recipe-card .ingredients-list li,' +
      '.wp-block-wpzoom-recipe-card-block-recipe-card .ingredients-list li'
  )
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}
function wpzoomSteps($) {
  return $(
    '.wpzoom-recipe-card .directions-list li,' +
      '.wp-block-wpzoom-recipe-card-block-recipe-card .directions-list li'
  )
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}
// EasyRecipe / Yumprint
function easyIngredients($) {
  return $('.ERIngredients li, .easyrecipe .ingredients li, .yumprint-recipe-ingredients li')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}
function easySteps($) {
  return $('.ERInstructions li, .easyrecipe .instructions li, .yumprint-recipe-directions li')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}

/* ------------ generic/heading-based (funguje na Ottolenghi) ------------ */
function collectAfterHeading($, headEl) {
  const outBlocks = [];
  let $n = $(headEl).next();
  while ($n && $n.length) {
    if ($n.is('h1,h2,h3,h4,strong,b')) break;

    if ($n.is('ul,ol')) {
      const items = $n
        .find('li')
        .map((_, li) => clean($(li).text()))
        .get()
        .filter(Boolean);
      if (items.length) outBlocks.push(items);
    }

    if ($n.is('table')) {
      const rows = $n
        .find('tr')
        .map((_, tr) => {
          const cells = $(tr)
            .find('th,td')
            .map((__, td) => clean($(td).text()))
            .get()
            .filter(Boolean);
          return clean(cells.join(' '));
        })
        .get()
        .filter(Boolean);
      if (rows.length) outBlocks.push(rows);
    }

    if ($n.is('p,div')) {
      const clone = $n.clone();
      clone.find('br').replaceWith('\n');
      const lines = clean(clone.text())
        .split('\n')
        .map((s) => clean(s))
        .filter(Boolean);
      if (lines.length >= 2) outBlocks.push(lines);
    }

    $n = $n.next();
  }

  const flat = outBlocks.flat().map(clean).filter(Boolean);
  const seen = new Set();
  const uniq = [];
  for (const x of flat) {
    if (!seen.has(x)) {
      seen.add(x);
      uniq.push(x);
    }
  }
  return uniq;
}

function headingIngredients($) {
  // klasický nadpis
  let nodes = $('h1,h2,h3,h4,strong,b').filter((_, el) => {
    const t = clean($(el).text()).toLowerCase();
    return /(ingredients|ingredience|suroviny)/i.test(t);
  });
  if (nodes.length) {
    const all = [];
    nodes.each((_, el) => {
      all.push(...collectAfterHeading($, el));
    });
    if (all.length) return all;
  }

  // sekce typu LABNEH / CONFIT TOMATOES / TO SERVE (Ottolenghi)
  const stopRe = /(method|instructions|postup|directions|kroky)/i;
  const subs = $('h2,h3,h4,strong,b').filter((_, el) => {
    const t = clean($(el).text()).toLowerCase();
    return t && !stopRe.test(t) && t.length <= 50;
  });

  if (subs.length) {
    const out = [];
    subs.each((_, el) => {
      const block = collectAfterHeading($, el);
      if (block.length) out.push(...block);
    });
    if (out.length) return out;
  }

  return [];
}

function headingSteps($) {
  const method = $('h1,h2,h3,h4,strong,b').filter((_, el) => {
    const t = clean($(el).text()).toLowerCase();
    return /(method|instructions|postup|directions|kroky)/i.test(t);
  });
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

/* ------------ generic fallback ------------ */
function genericIngredients($) {
  const s1 = $('[itemprop="recipeIngredient"], [itemprop="ingredients"]')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
  if (s1.length) return s1;

  for (const sel of ['.ingredients', '.ingredient-list', '.recipe-ingredients', '#ingredients']) {
    const items = $(sel).first();
    if (items && items.length) {
      const list = items.find('li').map((_, el) => clean($(el).text())).get().filter(Boolean);
      if (list.length) return list;
    }
  }
  return headingIngredients($);
}
function genericSteps($) {
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
    const items = $(sel).first();
    if (items && items.length) {
      const li = items.find('li');
      if (li.length) return li.map((_, el) => clean($(el).text())).get().filter(Boolean);
      const p = items.find('p');
      if (p.length) return p.map((_, el) => clean($(el).text())).get().filter(Boolean);
    }
  }
  return headingSteps($);
}

/* ------------ handler ------------ */
export async function GET(req) {
  const u = new URL(req.url);
  const target = u.searchParams.get('url');
  if (!target) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });

  try {
    let { $ } = await fetchHtml(target);

    // 1) JSON-LD
    let meta = parseJsonLd($);

    // 2) pluginy (správně: první NEprázdný výsledek)
    let ingredients = firstNonEmpty(
      tastyIngredients($),
      wprmIngredients($),
      mvIngredients($),
      wpzoomIngredients($),
      easyIngredients($)
    );
    let steps = firstNonEmpty(
      tastySteps($),
      wprmSteps($),
      mvSteps($),
      wpzoomSteps($),
      easySteps($)
    );

    // 3) generic / heading-based
    if (!ingredients.length) ingredients = genericIngredients($);
    if (!steps.length) steps = genericSteps($);

    // 4) AMP fallback
    if ((!ingredients.length || !steps.length) && !/\/amp\/?$/.test(target)) {
      try {
        const ampUrl = target.replace(/\/$/, '') + '/amp/';
        const amp = await fetchHtml(ampUrl);
        const $amp = amp.$;

        if (!meta) meta = parseJsonLd($amp);
        if (!ingredients.length) ingredients = genericIngredients($amp);
        if (!steps.length) steps = genericSteps($amp);
      } catch {
        /* ignore */
      }
    }

    const title =
      clean(meta?.title) ||
      clean($('meta[property="og:title"]').attr('content') || $('title').text()) ||
      'Recept';
    const description =
      clean(meta?.description) || clean($('meta[name="description"]').attr('content')) || '';
    const image =
      clean(meta?.image) || clean($('meta[property="og:image"]').attr('content') || '');

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
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
