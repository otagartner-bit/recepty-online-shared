export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

// ------------ helpers ------------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36 RecipeImporter/2.0';
const HEADERS = {
  'user-agent': UA,
  'accept-language': 'cs,sk;q=0.9,en;q=0.8',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'cache-control': 'no-cache',
  'pragma': 'no-cache',
};

const clean = s => (s ?? '')
  .replace(/\u00a0/g, ' ')
  .replace(/\s+/g,' ')
  .trim();

const uniq = arr => Array.from(new Set(arr.map(v => clean(v))).values())
  .filter(Boolean);

function textList($nodes) {
  const out = [];
  $nodes.each((_, el) => {
    const $el = cheerio.load('<div></div>')('div').append(cheerio.default(el).clone());
    // li → text, p → text
    $el.find('script,style,noscript').remove();
    const t = clean($el.text());
    if (t) out.push(t);
  });
  return out;
}

function followSiblingsUntil($, start, stopSelector='h2,h3,h4') {
  // vezmi sourozence od start.next() až po další nadpis; vrať jejich text
  const outEls = [];
  let cur = start.next();
  while (cur && cur.length) {
    if (cur.is(stopSelector)) break;
    outEls.push(cur);
    cur = cur.next();
  }
  return $(outEls);
}

// ------------ JSON-LD / microdata ------------
function extractJSONLD($) {
  const items = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse(cheerio.default(el).contents().text());
      const arr = Array.isArray(json) ? json : [json];
      for (const obj of arr) {
        const t = (obj['@type'] || obj.type || '').toString().toLowerCase();
        if (t.includes('recipe') || (Array.isArray(obj['@type']) && obj['@type'].includes('Recipe'))) {
          items.push(obj);
        } else if (obj['@graph']) {
          const g = obj['@graph'].find(x => (x['@type'] || '').toString().includes('Recipe'));
          if (g) items.push(g);
        }
      }
    } catch {}
  });
  if (!items.length) return null;

  const r = items[0];
  const ing = (r.recipeIngredient || r.ingredients || []).map(clean);
  let how = [];
  const instr = r.recipeInstructions;
  if (Array.isArray(instr)) {
    for (const step of instr) {
      if (typeof step === 'string') how.push(step);
      else if (step && typeof step === 'object') {
        how.push(clean(step.text || step.name || step['@type'] || ''));
      }
    }
  } else if (typeof instr === 'string') {
    how = instr.split(/[\r\n]+/).map(clean);
  }
  return {
    title: clean(r.name || $('title').first().text()),
    description: clean(r.description || $('meta[name="description"]').attr('content') || ''),
    image: Array.isArray(r.image) ? r.image[0] : (r.image?.url || r.image || $('meta[property="og:image"]').attr('content') || ''),
    ingredients: uniq(ing),
    steps: uniq(how),
  };
}

// ------------ domain extractors ------------
function extract_madebykristina($) {
  // Titul + obrázek
  const title = clean($('h1, .detail__title, .product-detail h1').first().text()) || clean($('title').text());
  const image = $('meta[property="og:image"]').attr('content') || $('img.detail__photo, .product__image img').attr('src') || '';

  // Sekce – nadpisy bývají „Na …“, „Suroviny“, „Na servis“, „Na dochucení“ apod.
  const ing = [];
  const HOW_LABELS = /postup|příprava/i;
  const ING_LABELS = /^(suroviny|na\s)/i;

  $('h2, h3, h4').each((_, el) => {
    const $h = cheerio.default(el);
    const t = clean($h.text());
    if (ING_LABELS.test(t)) {
      const $block = followSiblingsUntil($, $h);
      // odrážky
      const li = textList($block.find('ul li, ol li'));
      ing.push(...li);
      // některé recepty mají ingredience v <p> po řádcích
      if (!li.length) {
        const paras = textList($block.find('p'));
        // heuristika: krátké řádky ber jako ingredience
        ing.push(...paras.filter(x => x.length <= 100));
      }
    }
  });

  // Postup – od nadpisu „Postup“ do dalšího nadpisu
  let steps = [];
  const $postupH = $('h2, h3, h4').filter((_, el) => HOW_LABELS.test(clean(cheerio.default(el).text())));
  if ($postupH.length) {
    const $block = followSiblingsUntil($, $postupH.first());
    const li = textList($block.find('ol li, ul li'));
    if (li.length) steps = li;
    else {
      const paras = textList($block.find('p'));
      // spoj kratší odstavce do kroků
      steps = paras.filter(x => x.length > 0);
    }
  }

  // fallback: když nic, zkusíme odrážky v článku nad „Postup“
  if (!ing.length) {
    const beforePostup = $postupH.length ? $.root().find('*').slice(0, $.root().find('*').index($postupH.first())) : $('body');
    const li = textList(beforePostup.find('ul li'));
    ing.push(...li.filter(x => x.length <= 120));
  }

  return {
    title,
    image,
    ingredients: uniq(ing),
    steps: uniq(steps),
  };
}

function extract_loveandlemons($) {
  const title = clean($('h1.entry-title, h1.post-title, h1').first().text()) || clean($('title').text());
  const image = $('meta[property="og:image"]').attr('content') || '';
  // JSON-LD bývá přítomné – když ne, mají často blok s class „wprm-recipe-…“
  const ing = $('.wprm-recipe-ingredient, .tasty-recipes-ingredients li, .ingredients li')
    .map((_, el)=> clean(cheerio.default(el).text())).get();
  const steps = $('.wprm-recipe-instruction, .tasty-recipes-instructions li, .instructions li, .wprm-recipe-instruction-text')
    .map((_, el)=> clean(cheerio.default(el).text())).get();
  return { title, image, ingredients: uniq(ing), steps: uniq(steps) };
}

function extract_bbcgoodfood($) {
  const title = clean($('h1.headline__title, h1.post-header__title, h1').first().text()) || clean($('title').text());
  const image = $('meta[property="og:image"]').attr('content') || '';
  const ing = $('section.recipe__ingredients, .recipe__ingredients, .ingredients-list__group, .ingredients-list__item')
    .find('li, p').map((_, el)=> clean(cheerio.default(el).text())).get();
  const steps = $('section.recipe__method-steps, .method, .method__list')
    .find('li, p').map((_, el)=> clean(cheerio.default(el).text())).get();
  return { title, image, ingredients: uniq(ing), steps: uniq(steps) };
}

function extract_ottolenghi($) {
  const title = clean($('h1, .article__title').first().text()) || clean($('title').text());
  const image = $('meta[property="og:image"]').attr('content') || '';
  // Většinou plain nadpisy „Ingredients“ / „Method“
  let ing = [], steps = [];
  $('h2, h3').each((_, el) => {
    const t = clean(cheerio.default(el).text());
    if (/ingredients/i.test(t)) {
      const $block = followSiblingsUntil($, cheerio.default(el));
      ing.push(...textList($block.find('ul li, ol li, p')));
    }
    if (/method|instructions?/i.test(t)) {
      const $block = followSiblingsUntil($, cheerio.default(el));
      steps.push(...textList($block.find('ol li, ul li, p')));
    }
  });
  return { title, image, ingredients: uniq(ing), steps: uniq(steps) };
}

// ------------ readability fallback ------------
function extract_readability(html, url) {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const art = reader.parse();
  return {
    title: clean(art?.title || ''),
    description: clean(art?.excerpt || ''),
    text: clean(art?.textContent || '')
  };
}

// ------------ main fetch ------------
async function fetchHTML(url) {
  // 1) přímý fetch
  let res = await fetch(url, { headers: HEADERS, redirect: 'follow', cache: 'no-store' });
  if (res.ok) return await res.text();

  // 2) proxy přes r.jina.ai (umí obejít spoustu drobných blokací)
  const proxied = url.startsWith('http') ? `https://r.jina.ai/http://` + url.replace(/^https?:\/\//,'') : url;
  res = await fetch(proxied, { headers: HEADERS, redirect: 'follow', cache: 'no-store' });
  if (res.ok) return await res.text();

  throw new Error(`Fetch failed (${res.status})`);
}

// ------------ normalizer ------------
function normalizeRecipe(partial, fallback) {
  return {
    title: clean(partial.title || fallback?.title || ''),
    description: clean(partial.description || fallback?.description || ''),
    image: partial.image || fallback?.image || '',
    ingredients: Array.isArray(partial.ingredients) ? uniq(partial.ingredients) : [],
    steps: Array.isArray(partial.steps) ? uniq(partial.steps) : [],
  };
}

// ------------ route ------------
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');
  const save = searchParams.get('save'); // ?save=1 uloží do /api/recipes
  if (!target) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400 });

  try {
    const html = await fetchHTML(target);
    const $ = cheerio.load(html);

    // 0) zkus JSON-LD
    let draft = extractJSONLD($);

    // 1) domain-specific
    const host = new URL(target).hostname.replace(/^www\./,'');
    let domainDraft = null;
    if (/madebykristina\.cz$/.test(host)) domainDraft = extract_madebykristina($);
    else if (/loveandlemons\.com$/.test(host)) domainDraft = extract_loveandlemons($);
    else if (/bbcgoodfood\.com$/.test(host)) domainDraft = extract_bbcgoodfood($);
    else if (/ottolenghi\.co\.uk$/.test(host)) domainDraft = extract_ottolenghi($);

    // 2) Readability fallback (pro description/title)
    const rd = extract_readability(html, target);

    // 3) složit dohromady
    const final = normalizeRecipe(
      {
        ...(draft || {}),
        ...(domainDraft || {}),
        // doplň description a image z meta
        description: (draft?.description || domainDraft?.description || $('meta[name="description"]').attr('content') || rd.description || ''),
        image: (draft?.image || domainDraft?.image || $('meta[property="og:image"]').attr('content') || ''),
      },
      rd
    );

    // bezpečnost: pokud máme aspoň něco?
    if (!final.title) final.title = clean($('title').text()) || 'Recept';
    // poslední pojistka – když steps prázdné, zkus odstavce
    if (!final.steps.length) {
      const paras = $('article p, .content p, .post-content p, .text p').map((_,el)=>clean(cheerio.default(el).text())).get();
      final.steps = uniq(paras.filter(p => p.length > 40).slice(0, 20));
    }

    const item = {
      id: crypto.randomUUID(),
      title: final.title,
      description: final.description,
      image: final.image,
      ingredients: final.ingredients,
      steps: final.steps,
      tags: [],
      source: target
    };

    // volitelné uložení (aby sis nemusel klikat 2×)
    if (save === '1') {
      const resp = await fetch(`${new URL(req.url).origin}/api/recipes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipe: item })
      });
      const js = await resp.json().catch(()=> ({}));
      return new Response(JSON.stringify({ imported: true, item, storage: js }), { headers: { 'content-type': 'application/json' }});
    }

    return new Response(JSON.stringify(item), { headers: { 'content-type': 'application/json' }});
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
}
