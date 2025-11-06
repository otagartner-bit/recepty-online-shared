// app/api/import/route.js
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const H = {
  'user-agent': UA,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,cs;q=0.8',
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

  if (useProxy) {
    // tichý fallback přes veřejný reader (pomáhá na anti-bot webech)
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

/* ===== JSON-LD (Recipe) ===== */
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

/* ===== Plugin selektory (Love&Lemons – WPRM, Pinch of Yum – Tasty, apod.) ===== */
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

  // Tasty Recipes (Pinch of Yum – uvedeno pro úplnost)
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

/* ===== Per-domain extraktory ===== */

// madebykristina.cz – text je často formátovaný sekcemi „Na ...“, „Na servis“, + dlouhý postup.
function extractMadeByKristina($) {
  const title =
    clean($('meta[property="og:title"]').attr('content')) ||
    clean($('title').text());
  const description = clean($('meta[name="description"]').attr('content') || '');
  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';

  const sections = [];
  $('h2,h3,strong,b').each((_, el) => {
    const t = clean($(el).text());
    if (/^Na\s|Na\sservis|Na\sdochucen/i.test(t)) {
      const items = [];
      let n = $(el).parent().next();
      // projdi několik sousedů, dokud nenarazíš na další nadpis
      for (let i = 0; i < 10 && n.length; i++) {
        if (/^H[1-4]$/i.test(n.get(0).tagName || '')) break;
        if (n.is('ul,ol')) n.find('li').each((_, li) => items.push(clean($(li).text())));
        if (n.is('p,div')) {
          const txt = clean(n.text());
          // rozdělení na řádky „• “, „-“ apod.
          txt.split(/\n|·|•|-/).forEach((x) => {
            const y = clean(x);
            if (y && y.length < 140) items.push(y);
          });
        }
        n = n.next();
      }
      if (items.length) sections.push(...items);
    }
  });

  // kroky – vezmeme úvod a „postup“ od prvního „A teď / Postup / Pak / Přidej“
  const allP = $('article, .content, main')
    .find('p,li')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);

  const steps = uniq(
    allP
      .filter(
        (t) =>
          /Postup|A teď|Pak|Poté|Přidej|Přidám|Vyndám|Opeču|Zaliju|Podávám/i.test(t) ||
          (t.split(' ').length > 6 && /[\.!]/.test(t))
      )
  );

  return {
    title,
    description,
    image,
    ingredients: uniq(sections),
    steps,
  };
}

// ottolenghi.co.uk – blogs/recipes: „Ingredients“, „Method“
function extractOttolenghi($) {
  const title =
    clean($('meta[property="og:title"]').attr('content')) ||
    clean($('title').text());
  const description = clean($('meta[name="description"]').attr('content') || '');
  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';

  const collectAfter = (start) => {
    const out = [];
    let n = start.next();
    while (n.length && !/^(H1|H2|H3|H4)$/i.test(n.get(0).tagName || '')) {
      if (n.is('ul,ol')) n.find('li').each((_, li) => out.push(clean($(li).text())));
      else if (n.is('p,div,section')) {
        const t = clean(n.text());
        if (t) out.push(t);
      }
      n = n.next();
    }
    return uniq(out);
  };

  const ingHead = $('h1,h2,h3,h4,strong,b')
    .filter((_, el) => /ingredients?/i.test(clean($(el).text())))
    .first();
  const methHead = $('h1,h2,h3,h4,strong,b')
    .filter((_, el) => /method|instructions?/i.test(clean($(el).text())))
    .first();

  const ingredients = ingHead.length ? collectAfter(ingHead) : [];
  const steps = methHead.length ? collectAfter(methHead) : [];

  return { title, description, image, ingredients, steps };
}

// bbcgoodfood.com – má spolehlivý JSON-LD
function extractBBC($) {
  const ld = parseJsonLd($);
  if (ld) return ld;
  // záloha
  const title =
    clean($('meta[property="og:title"]').attr('content')) ||
    clean($('title').text());
  const description = clean($('meta[name="description"]').attr('content') || '');
  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';
  const ingredients = grab($, '.recipe__ingredients li, .ingredients-list__group li, .ingredients-list__item');
  const steps = grab($, '.method__list li, .method__item, .grouped__method .list-item');
  return { title, description, image, ingredients, steps };
}

// loveandlemons.com – WPRM jistota
function extractLoveAndLemons($) {
  const base = byCommonPlugins($);
  const title =
    clean($('meta[property="og:title"]').attr('content')) ||
    clean($('title').text());
  const description = clean($('meta[name="description"]').attr('content') || '');
  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';
  return { title, description, image, ...base };
}

/* ===== tagy ===== */
function autoTags(recipe) {
  const blob = [recipe.title, recipe.description, ...(recipe.ingredients || []), ...(recipe.steps || [])]
    .join(' ')
    .toLowerCase();
  const tags = new Set();
  if (/pol(é|e)vka|soup/.test(blob)) tags.add('polévka');
  if (/sal(á|a)t|salad/.test(blob)) tags.add('salát');
  if (/beef|hov(ě|e)z/i.test(blob)) tags.add('hovězí');
  if (/chicken|ku(ř|r)e/i.test(blob)) tags.add('kuřecí');
  if (/lentil|čo(č|c)ka/i.test(blob)) tags.add('luštěniny');
  if (/noodle|ramen|udon|soba|nudle/i.test(blob)) tags.add('nudle');
  if (/tahini|za'?atar|sumac|labneh|urfa|harissa/i.test(blob)) tags.add('blízký východ');
  if (/gochujang|kimchi|ramen|soy sauce|sojov(á|a)/i.test(blob)) tags.add('asijské');
  return Array.from(tags);
}

/* ===== hlavní handler ===== */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });
  }

  try {
    const a = await fetchHtml(target, false);
    const variants = [a];

    // tichý fallback přes proxy, když nic nenajdeme
    if (!a.ok || a.status >= 400) {
      const b = await fetchHtml(target, true);
      if (b.ok) variants.unshift(b); // preferuj proxy, když direct selhal
    } else {
      const b = await fetchHtml(target, true);
      if (b.ok) variants.push(b); // necháme jako zálohu
    }

    let result = null;

    for (const v of variants) {
      if (!v.ok) continue;
      const $ = cheerio.load(v.text);
      const host = new URL(target).host.replace(/^www\./, '');

      // 1) per-domain
      if (host.endsWith('madebykristina.cz')) {
        result = extractMadeByKristina($);
      } else if (host.endsWith('loveandlemons.com')) {
        result = extractLoveAndLemons($);
      } else if (host.endsWith('ottolenghi.co.uk')) {
        result = extractOttolenghi($);
      } else if (host.endsWith('bbcgoodfood.com')) {
        result = extractBBC($);
      }

      // 2) JSON-LD obecně (pro jistotu i tam, kde máme domain-specific)
      if (!result || (!result.ingredients?.length && !result.steps?.length)) {
        const ld = parseJsonLd($);
        if (ld) {
          result = {
            ...(result || {}),
            ...ld,
            title: ld.title || result?.title || '',
            description: ld.description || result?.description || '',
            image: ld.image || result?.image || '',
          };
        }
      }

      // 3) plugin selektory (WPRM/Tasty/Mediavine/…)
      if (!result || (!result.ingredients?.length && !result.steps?.length)) {
        const base = byCommonPlugins($);
        const title =
          clean($('meta[property="og:title"]').attr('content')) ||
          clean($('title').text());
        const description = clean($('meta[name="description"]').attr('content') || '');
        const image =
          $('meta[property="og:image"]').attr('content') ||
          $('meta[name="twitter:image"]').attr('content') ||
          '';
        result = {
          title: result?.title || title,
          description: result?.description || description,
          image: result?.image || image,
          ingredients: uniq([...(result?.ingredients || []), ...base.ingredients]),
          steps: uniq([...(result?.steps || []), ...base.steps]),
          servings: result?.servings || '',
          time: result?.time || '',
        };
      }

      // 4) fallback přes nadpisy Ingredients/Method (pro jednoduché stránky)
      if (!result.ingredients?.length || !result.steps?.length) {
        const collectAfter = (start) => {
          const out = [];
          let n = start.next();
          while (n.length && !/^(H1|H2|H3|H4)$/i.test(n.get(0).tagName || '')) {
            if (n.is('ul,ol')) n.find('li').each((_, li) => out.push(clean($(li).text())));
            else if (n.is('p,div,section')) {
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
        const methHead = $('h1,h2,h3,h4,strong,b')
          .filter((_, el) => /method|instructions?|postup|directions|kroky/i.test(clean($(el).text())))
          .first();
        const plusIngredients = ingHead.length ? collectAfter(ingHead) : [];
        const plusSteps = methHead.length ? collectAfter(methHead) : [];
        result.ingredients = uniq([...(result.ingredients || []), ...plusIngredients]);
        result.steps = uniq([...(result.steps || []), ...plusSteps]);
      }

      if (result && (result.ingredients?.length || result.steps?.length)) break;
    }

    if (!result) {
      return new Response(JSON.stringify({ error: 'Fetch failed' }), { status: 502 });
    }

    // meta doplnění
    if (!result.title)
      result.title = 'Recept';
    if (!result.description)
      result.description = '';
    if (!result.image)
      result.image = '';

    const out = {
      id: crypto.randomUUID(),
      title: clean(result.title),
      description: clean(result.description),
      image: clean(result.image),
      ingredients: uniq(result.ingredients || []),
      steps: uniq(result.steps || []),
      servings: clean(result.servings || ''),
      time: clean(result.time || ''),
      tags: autoTags(result),
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
