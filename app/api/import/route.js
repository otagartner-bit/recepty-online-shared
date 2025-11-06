// app/api/import/route.js
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36 RecipeImporter/1.2';

const clean = (s) =>
  (s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function pickRecipeFromJsonLd(objs) {
  // vezmeme první objekt typu Recipe (nebo uvnitř @graph)
  const flat = [];
  toArray(objs).forEach((o) => {
    if (!o) return;
    if (o['@graph']) flat.push(...toArray(o['@graph']));
    flat.push(o);
  });
  const match = flat.find(
    (o) =>
      (o['@type'] === 'Recipe') ||
      (Array.isArray(o['@type']) && o['@type'].includes('Recipe'))
  );
  if (!match) return null;

  const ing = toArray(match.recipeIngredient).map(clean);
  const how =
    toArray(match.recipeInstructions)
      .map((step) => {
        if (typeof step === 'string') return clean(step);
        if (step && typeof step === 'object') {
          if (step.text) return clean(step.text);
          if (step.itemListElement) {
            return toArray(step.itemListElement)
              .map((x) => (typeof x === 'string' ? clean(x) : clean(x.text)))
              .filter(Boolean)
              .join(' ');
          }
        }
        return '';
      })
      .filter(Boolean) || [];

  const out = {
    title: clean(match.name),
    description: clean(match.description || ''),
    image:
      (typeof match.image === 'string'
        ? match.image
        : match.image && match.image.url) || '',
    ingredients: ing,
    steps: how.length ? how : [],
    servings: clean(match.recipeYield || ''),
    time:
      clean(
        [match.totalTime, match.cookTime, match.prepTime].filter(Boolean).join(' ')
      ) || '',
    tags: toArray(match.keywords)
      .join(', ')
      .split(',')
      .map((t) => clean(t).toLowerCase())
      .filter(Boolean),
  };
  // validace
  if (!out.ingredients.length && !out.steps.length) return null;
  return out;
}

function extractBySelectors($) {
  // WPRM (Love & Lemons apod.)
  let ingredients = $('ul.wprm-recipe-ingredients li .wprm-recipe-ingredient, ul.wprm-recipe-ingredients li')
    .map((_, el) => clean($(el).text()))
    .get();
  let steps = $('div.wprm-recipe-instructions-container li .wprm-recipe-instruction-text, ol.wprm-recipe-instructions li, .wprm-recipe-instruction-text')
    .map((_, el) => clean($(el).text()))
    .get();

  // Tasty Recipes (Pinch of Yum)
  if (!ingredients.length) {
    ingredients = $('.tasty-recipes-ingredients li')
      .map((_, el) => clean($(el).text()))
      .get();
  }
  if (!steps.length) {
    steps = $('.tasty-recipes-instructions li')
      .map((_, el) => clean($(el).text()))
      .get();
  }

  // Obecné zálohy: najít H2/H3 "Ingredients" / "Method" (Ottolenghi)
  const grabSection = (headingRegex) => {
    const start = $('h1,h2,h3')
      .filter((_, el) => headingRegex.test($(el).text().trim()))
      .first();
    if (!start.length) return [];
    const out = [];
    let n = start.next();
    while (n.length && !/^(H1|H2|H3)$/i.test(n.get(0).tagName || '')) {
      if (n.is('ul,ol')) {
        n.find('li').each((_, li) => out.push(clean($(li).text())));
      } else if (n.is('p')) {
        const t = clean(n.text());
        if (t) out.push(t);
      }
      n = n.next();
    }
    return out.filter(Boolean);
  };

  if (!ingredients.length) ingredients = grabSection(/ingredients?/i);
  if (!steps.length)
    steps = grabSection(/method|instructions?|procedure|postup/i);

  const title =
    clean($('meta[property="og:title"]').attr('content')) ||
    clean($('title').first().text());
  const description =
    clean($('meta[name="description"]').attr('content')) || '';
  const image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    '';

  return {
    title,
    description,
    image,
    ingredients,
    steps,
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url' }), {
      status: 400,
    });
  }

  try {
    const res = await fetch(target, {
      // Klíčové hlavičky, jinak některé weby vrací 403/404
      headers: {
        'user-agent': UA,
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-GB,en;q=0.9,cs;q=0.8',
        referer: new URL(target).origin + '/',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      // Pro jistotu, ať se Vercel nepokouší o revalidaci
      cache: 'no-store',
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: 'Fetch failed', status: res.status }),
        { status: 502 }
      );
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // 1) JSON-LD (Schema.org/Recipe) – nejspolehlivější
    let jsonldData = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      const txt = $(el).contents().text();
      try {
        const parsed = JSON.parse(txt);
        jsonldData.push(parsed);
      } catch {}
    });
    let recipe = pickRecipeFromJsonLd(jsonldData);

    // 2) Selektory (WPRM / Tasty / fallback pro Ottolenghi)
    if (!recipe) {
      const scraped = extractBySelectors($);
      if (scraped.ingredients.length || scraped.steps.length) {
        recipe = scraped;
      }
    }

    // 3) Poslední pojistka: aspoň titulek / popis
    if (!recipe) {
      const dom = new JSDOM(html, { url: target });
      const t =
        clean($('meta[property="og:title"]').attr('content')) ||
        clean(dom.window.document.title) ||
        'Recept';
      const d =
        clean($('meta[name="description"]').attr('content')) || '';
      const img =
        $('meta[property="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') ||
        '';
      recipe = {
        title: t,
        description: d,
        image: img,
        ingredients: [],
        steps: [],
      };
    }

    // doplnění + tagy
    recipe.title = recipe.title || 'Recept';
    recipe.description = recipe.description || '';
    recipe.image = recipe.image || '';
    recipe.source = target;

    // jednoduché štítky (heuristika)
    const textBlob =
      [recipe.title, recipe.description, ...recipe.ingredients, ...recipe.steps]
        .join(' ')
        .toLowerCase();

    const tags = new Set();
    if (/lentil|čo(č|c)ka/.test(textBlob)) tags.add('luštěniny');
    if (/beef|hov(ě|e)z(í|i)|short rib/.test(textBlob)) tags.add('hovězí');
    if (/chicken|ku(ř|r)e/.test(textBlob)) tags.add('kuřecí');
    if (/noodle|ramen|udon|soba|nudle/.test(textBlob)) tags.add('nudle');
    if (/soup|pol(é|e)vka/.test(textBlob)) tags.add('polévka');
    if (/salad|sal(á|a)t/.test(textBlob)) tags.add('salát');
    if (/gochujang|kimchi|ramen/.test(textBlob)) tags.add('asijské');
    if (/za'?atar|tahini|labneh|sumac|urfa|harissa/.test(textBlob))
      tags.add('blízký východ');

    recipe.tags = Array.from(tags);

    // ID – když už jedno je v query parametrech frontendu, respektujeme ho
    const id =
      (req.headers.get('x-recipe-id') || '') ||
      crypto.randomUUID();

    const payload = {
      id,
      ...recipe,
    };

    return new Response(JSON.stringify(payload), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500 }
    );
  }
}
