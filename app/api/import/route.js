// app/api/import/route.js
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const H = {
  'user-agent': UA,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,cs;q=0.8,sk;q=0.7',
  'upgrade-insecure-requests': '1',
  'cache-control': 'no-cache',
};

const clean = (t) =>
  (t || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim();

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const uniq = (a) => Array.from(new Set((a || []).map(clean).filter(Boolean)));

async function fetchHtml(url, useProxy = false) {
  const u = new URL(url);
  const headers = { ...H, referer: u.origin + '/' };
  let finalUrl = url;

  // tichý fallback kvůli anti-botu / CookieWall
  if (useProxy) {
    const scheme = u.protocol.replace(':', '');
    finalUrl = `https://r.jina.ai/${scheme}://${u.host}${u.pathname}${u.search}`;
  }

  const res = await fetch(finalUrl, {
    headers,
    redirect: 'follow',
    cache: 'no-store',
  });

  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

/* ============ JSON-LD (Recipe) ============ */
function isRecipeType(v) {
  if (!v) return false;
  if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase() === 'recipe');
  return String(v).toLowerCase() === 'recipe';
}
function pickRecipeNode(node) {
  if (!node) return null;
  if (isRecipeType(node['@type'])) return node;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = pickRecipeNode(n);
      if (r) return r;
    }
    return null;
  }
  for (const k of ['@graph', 'graph', 'mainEntity', 'itemListElement']) {
    const r = pickRecipeNode(node[k]);
    if (r) return r;
  }
  return null;
}
function parseJsonLd($) {
  const scripts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).contents().text())
    .get()
    .filter(Boolean);

  let cand = null;
  for (const raw of scripts) {
    const parts = raw.split(/(?<=\})\s*(?=\{)/);
    for (const p of parts) {
      try {
        const data = JSON.parse(p);
        const r = pickRecipeNode(data);
        if (r) {
          cand = r;
          break;
        }
      } catch {}
    }
    if (cand) break;
  }
  if (!cand) return null;

  const recipeInstructions = (ri) => {
    if (!ri) return [];
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (typeof n === 'string') {
        out.push(clean(n));
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
      out.push(clean(n.text || n.name || n.description || ''));
    };
    walk(ri);
    return uniq(out);
  };

  return {
    title: clean(cand.name),
    description: clean(cand.description || ''),
    image: clean(
      Array.isArray(cand.image)
        ? cand.image[0]
        : cand.image?.url || cand.image || ''
    ),
    ingredients: uniq(arr(cand.recipeIngredient)),
    steps: recipeInstructions(cand.recipeInstructions),
    servings: clean(cand.recipeYield || ''),
    time: clean([cand.totalTime, cand.cookTime, cand.prepTime].filter(Boolean).join(' ')),
  };
}

/* ============ Plugin selektory (WPRM/Tasty/Mediavine/WPZOOM/itemprop) ============ */
const grab = ($, sel) => $(sel).map((_, el) => clean($(el).text())).get().filter(Boolean);

function byCommonPlugins($) {
  // WPRM (Love & Lemons)
  let ingredients =
    $('.wprm-recipe-ingredient').map((_, el) => {
      const $el = $(el);
      const a = clean($el.find('.wprm-recipe-ingredient-amount').text());
      const u = clean($el.find('.wprm-recipe-ingredient-unit').text());
      const n = clean($el.find('.wprm-recipe-ingredient-name').text());
      const note = clean($el.find('.wprm-recipe-ingredient-notes').text());
      return clean([a, u, n, note].filter(Boolean).join(' ')) || clean($el.text());
    }).get();

  if (!ingredients.length)
    ingredients = grab($, '.wprm-recipe-ingredients li, ul.wprm-recipe-ingredients li');

  let steps =
    grab($, '.wprm-recipe-instruction-text, .wprm-recipe-instructions li') ||
    grab($, 'ol.wprm-recipe-instructions li');

  // Tasty Recipes (Pinch of Yum)
  if (!ingredients.length) ingredients = grab($, '.tasty-recipes-ingredients li');
  if (!steps.length) steps = grab($, '.tasty-recipes-instructions li');

  // Mediavine Create
  if (!ingredients.length) ingredients = grab($, '.mv-create-ingredients li, .mv-create-list-item');
  if (!steps.length) steps = grab($, '.mv-create-instructions li, .mv-create-list-item');

  // WPZOOM
  if (!ingredients.length) ingredients = grab($, '.wpzoom-recipe-card .ingredients-list li, .wp-block-wpzoom-recipe-card-block-recipe-card .ingredients-list li');
  if (!steps.length) steps = grab($, '.wpzoom-recipe-card .directions-list li, .wp-block-wpzoom-recipe-card-block-recipe-card .directions-list li');

  // itemprop
  if (!ingredients.length) ingredients = grab($, '[itemprop="recipeIngredient"], [itemprop="ingredients"]');
  if (!steps.length) {
    const holder = $('[itemprop="recipeInstructions"]').first();
    if (holder.length) {
      const li = holder.find('li');
      steps = li.length
        ? li.map((_, el) => clean($(el).text())).get()
        : holder.find('p').map((_, el) => clean($(el).text())).get();
    }
  }

  return { ingredients: uniq(ingredients), steps: uniq(steps) };
}

/* ============ Nadpisy (Ingredients / Instructions / Suroviny / Postup) ============ */
function fromHeadings($) {
  const collectAfter = (start) => {
    const out = [];
    let n = start.next();
    while (n.length && !/^(H1|H2|H3|H4)$/i.test(n.get(0).tagName || '')) {
      if (n.is('ul,ol')) n.find('li').each((_, li) => out.push(clean($(li).text())));
      else if (n.is('p,div,section,article')) {
        const t = clean(n.text());
        if (t) out.push(t);
      }
      n = n.next();
    }
    return uniq(out);
  };

  const ingHead = $('h1,h2,h3,h4,strong,b')
    .filter((_, el) => /ingredients?|ingredience|suroviny/i.test(clean($(el).text())))
    .first();
  const stepHead = $('h1,h2,h3,h4,strong,b')
    .filter((_, el) => /method|instructions?|postup|directions|kroky/i.test(clean($(el).text())))
    .first();

  const ingredients = ingHead.length ? collectAfter(ingHead) : [];
  const steps = stepHead.length ? collectAfter(stepHead) : [];

  return { ingredients, steps };
}

/* ============ Readability fallback (funguje i na madebykristina.cz) ============ */
function fallbackFromReadable(html, baseUrl) {
  const dom = new JSDOM(html, { url: baseUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  const text = clean(article?.textContent || '');
  if (!text) return { title: '', description: '', ingredients: [], steps: [] };

  // Rozdělení podle sekcí (CZ/EN)
  // najdi blok „Ingredients / Ingredience / Suroviny“ a „Instructions / Method / Postup“
  const lower = text.toLowerCase();

  const findIndex = (labels, from = 0) => {
    let idx = -1;
    for (const l of labels) {
      const i = lower.indexOf(l, from);
      if (i !== -1) idx = idx === -1 ? i : Math.min(idx, i);
    }
    return idx;
  };

  const ING = ['\ningredients\n','\ningredience\n','\nsuroviny\n',' ingredients\n',' ingredience\n',' suroviny\n'];
  const STEPS = ['\ninstructions\n','\nmethod\n','\npostup\n',' instructions\n',' method\n',' postup\n'];

  const iStart = findIndex(ING);
  const sStart = findIndex(STEPS, iStart !== -1 ? iStart + 1 : 0);

  const slice = (s, e) => clean(text.slice(Math.max(0, s), e > 0 ? e : undefined));

  let ingredients = [];
  let steps = [];

  if (iStart !== -1) {
    const ingBlock = slice(iStart, sStart);
    ingredients = ingBlock
      .split(/\n+/)
      .map(clean)
      .filter((l) => l && l.length < 180 && !/^(ingredients?|ingredience|suroviny)$/i.test(l));
  }

  if (sStart !== -1) {
    const stepBlock = slice(sStart);
    // rozděl věty / odrážky
    const raw = stepBlock.split(/\n+|(?<=\.)\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/);
    steps = raw
      .map(clean)
      .filter((l) => l && !/^(instructions?|method|postup|directions?)$/i.test(l));
  }

  // když na MK nejsou čisté nadpisy, ber „Na …“ jako ingredience
  if (!ingredients.length) {
    const lines = text.split('\n').map(clean);
    const maybeIng = lines.filter((l) =>
      /^(na\s+.+|suroviny|ingredience)\b/i.test(l)
    );
    // vezmi 5–12 řádků po takové hlavičce
    for (const hl of maybeIng) {
      const idx = lines.indexOf(hl);
      const chunk = lines.slice(idx + 1, idx + 12).map(clean).filter(Boolean);
      for (const c of chunk) if (c.length < 160) ingredients.push(c);
    }
  }

  // basic meta
  const title = clean(article?.title || dom.window.document.title || '');
  const description = clean(
    dom.window.document.querySelector('meta[name="description"]')?.content || ''
  );

  return {
    title,
    description,
    ingredients: uniq(ingredients),
    steps: uniq(steps),
  };
}

/* ============ tagy ============ */
function autoTags(recipe) {
  const blob = [recipe.title, recipe.description, ...(recipe.ingredients || []), ...(recipe.steps || [])]
    .join(' ')
    .toLowerCase();
  const tags = new Set();
  if (/pol(é|e)vka|soup/.test(blob)) tags.add('polévka');
  if (/sal(á|a)t|salad/.test(blob)) tags.add('salát');
  if (/beef|hov(ě|e)z/.test(blob)) tags.add('hovězí');
  if (/chicken|ku(ř|r)e/.test(blob)) tags.add('kuřecí');
  if (/lentil|čo(č|c)ka/.test(blob)) tags.add('luštěniny');
  if (/noodle|ramen|udon|soba|nudle/.test(blob)) tags.add('nudle');
  if (/tahini|za'?atar|sumac|labneh|urfa|harissa/.test(blob)) tags.add('blízký východ');
  if (/gochujang|kimchi|ramen|soy sauce|sojov(á|a)/.test(blob)) tags.add('asijské');
  return Array.from(tags);
}

/* ============ hlavní handler ============ */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });
  }

  try {
    // 1) direct
    const a = await fetchHtml(target, false);
    // 2) proxy fallback
    const b = await fetchHtml(target, true);

    // zkusíme postupně víc metod na obou variantách
    const candidates = [a, b].filter((x) => x.ok);

    let best = null;

    for (const v of candidates) {
      const html = v.text || '';
      const $ = cheerio.load(html);

      // A) JSON-LD (BBC Good Food hodně spolehlivý, Love&Lemons často také)
      const ld = parseJsonLd($);
      if (ld && (ld.ingredients?.length || ld.steps?.length)) {
        best = {
          title: ld.title,
          description: ld.description,
          image: ld.image,
          ingredients: ld.ingredients,
          steps: ld.steps,
          servings: ld.servings || '',
          time: ld.time || '',
        };
      }

      // B) plugin selektory (WPRM / Tasty / Mediavine / WPZOOM / itemprop)
      if (!best || (!best.ingredients?.length && !best.steps?.length)) {
        const base = byCommonPlugins($);
        const title =
          clean($('meta[property="og:title"]').attr('content')) ||
          clean($('title').text()) || best?.title || '';
        const description =
          clean($('meta[name="description"]').attr('content') || '') || best?.description || '';
        const image =
          $('meta[property="og:image"]').attr('content') ||
          $('meta[name="twitter:image"]').attr('content') ||
          best?.image || '';
        const merged = {
          title,
          description,
          image,
          ingredients: uniq([...(best?.ingredients || []), ...base.ingredients]),
          steps: uniq([...(best?.steps || []), ...base.steps]),
          servings: best?.servings || '',
          time: best?.time || '',
        };
        if (merged.ingredients.length || merged.steps.length) best = merged;
      }

      // C) nadpisy (Ingredients/Instructions + CZ)
      if (!best || (!best.ingredients?.length && !best.steps?.length)) {
        const hx = fromHeadings($);
        const title =
          clean($('meta[property="og:title"]').attr('content')) ||
          clean($('title').text()) || best?.title || '';
        const description =
          clean($('meta[name="description"]').attr('content') || '') || best?.description || '';
        const image =
          $('meta[property="og:image"]').attr('content') ||
          $('meta[name="twitter:image"]').attr('content') ||
          best?.image || '';
        const merged = {
          title,
          description,
          image,
          ingredients: uniq([...(best?.ingredients || []), ...hx.ingredients]),
          steps: uniq([...(best?.steps || []), ...hx.steps]),
          servings: best?.servings || '',
          time: best?.time || '',
        };
        if (merged.ingredients.length || merged.steps.length) best = merged;
      }

      // D) Readability (čistý text → regex) – záchranná síť, funguje i na madebykristina.cz
      if (!best || (!best.ingredients?.length && !best.steps?.length)) {
        const rb = fallbackFromReadable(html, target);
        const title =
          rb.title ||
          clean($('meta[property="og:title"]').attr('content')) ||
          clean($('title').text()) ||
          best?.title ||
          '';
        const description = rb.description || best?.description || '';
        const image =
          $('meta[property="og:image"]').attr('content') ||
          $('meta[name="twitter:image"]').attr('content') ||
          best?.image || '';
        const merged = {
          title,
          description,
          image,
          ingredients: uniq([...(best?.ingredients || []), ...(rb.ingredients || [])]),
          steps: uniq([...(best?.steps || []), ...(rb.steps || [])]),
          servings: best?.servings || '',
          time: best?.time || '',
        };
        if (merged.ingredients.length || merged.steps.length) best = merged;
      }

      if (best && (best.ingredients?.length || best.steps?.length)) break;
    }

    if (!best) {
      return new Response(JSON.stringify({ error: 'Fetch failed' }), { status: 502 });
    }

    // doplň meta
    if (!best.title) best.title = 'Recept';
    if (!best.description) best.description = '';
    if (!best.image) best.image = '';

    const out = {
      id: crypto.randomUUID(),
      title: clean(best.title),
      description: clean(best.description),
      image: clean(best.image),
      ingredients: uniq(best.ingredients || []),
      steps: uniq(best.steps || []),
      servings: clean(best.servings || ''),
      time: clean(best.time || ''),
      tags: autoTags(best),
      source: target,
    };

    return new Response(JSON.stringify(out), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
    });
  }
}
