export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 RecipeImporter/1.0';

const clean = (t) =>
  (t || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---- JSON-LD helpers -------------------------------------------------------
function findRecipeNode(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const r = findRecipeNode(x);
      if (r) return r;
    }
    return null;
  }
  const type = obj['@type'];
  const hasRecipeType =
    type &&
    (Array.isArray(type) ? type.includes('Recipe') : String(type) === 'Recipe');

  if (hasRecipeType) return obj;

  // časté zabalení: mainEntity / graph / itemListElement / @graph
  if (obj.mainEntity) {
    const r = findRecipeNode(obj.mainEntity);
    if (r) return r;
  }
  if (obj['@graph']) {
    const r = findRecipeNode(obj['@graph']);
    if (r) return r;
  }
  if (obj.graph) {
    const r = findRecipeNode(obj.graph);
    if (r) return r;
  }
  if (obj.itemListElement) {
    const r = findRecipeNode(obj.itemListElement);
    if (r) return r;
  }
  return null;
}

function parseLdSteps(val) {
  if (!val) return [];
  if (typeof val === 'string') return [clean(val)];
  if (!Array.isArray(val)) return [];

  const out = [];
  for (const step of val) {
    if (typeof step === 'string') {
      out.push(clean(step));
    } else if (step) {
      // HowToStep, HowToSection
      if (Array.isArray(step.itemListElement)) {
        for (const s of step.itemListElement) {
          if (typeof s === 'string') out.push(clean(s));
          else out.push(clean(s.text || s.name || ''));
        }
      } else {
        out.push(clean(step.text || step.name || ''));
      }
    }
  }
  return out.filter(Boolean);
}

function normalizeList(val) {
  if (!val) return [];
  if (typeof val === 'string') return [clean(val)];
  if (Array.isArray(val)) return val.map((x) => clean(String(x))).filter(Boolean);
  return [];
}

// ---- DOM fallback (když není JSON-LD) --------------------------------------
function listAfterHeading($, regex) {
  // najdi první nadpis se slovem „Ingredients / Ingredience / Suroviny“ atd.
  const candidates = $('h1,h2,h3,h4,strong,b').filter((_, el) =>
    regex.test(clean($(el).text()).toLowerCase())
  );

  for (const el of candidates) {
    // nejbližší následující <ul> nebo <ol>
    const list = $(el).nextAll('ul,ol').first();
    if (list && list.length) {
      const items = list
        .find('li')
        .map((_, li) => clean($(li).text()))
        .get()
        .filter(Boolean);
      if (items.length) return items;
    }
  }

  // univerzální fallback: první větší <ul>/<ol> s 4+ položkami
  const bigList = $('ul,ol')
    .filter((_, el) => $(el).find('li').length >= 4)
    .first();
  if (bigList && bigList.length) {
    return bigList
      .find('li')
      .map((_, li) => clean($(li).text()))
      .get()
      .filter(Boolean);
  }
  return [];
}

// ---- hlavní GET -------------------------------------------------------------
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');
    if (!url) {
      return new Response(JSON.stringify({ error: 'Missing url' }), {
        status: 400,
      });
    }

    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'cs,en;q=0.9',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: 'Fetch failed', status: res.status }),
        { status: res.status }
      );
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // ---- JSON-LD (preferované) ----
    let recipeLd = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).contents().text();
        const data = JSON.parse(raw);
        const r = findRecipeNode(data);
        if (r && !recipeLd) recipeLd = r;
      } catch {
        /* ignore */
      }
    });

    // základní metadatové hodnoty
    const ogTitle = clean(
      $('meta[property="og:title"]').attr('content') || $('title').text()
    );
    const ogDesc = clean($('meta[name="description"]').attr('content') || '');
    const ogImg = clean($('meta[property="og:image"]').attr('content') || '');

    // slož ingredience a kroky
    let ingredients = [];
    let steps = [];

    if (recipeLd) {
      ingredients = normalizeList(recipeLd.recipeIngredient);
      steps = parseLdSteps(recipeLd.recipeInstructions);
    }

    // DOM fallbacky
    if (ingredients.length === 0) {
      ingredients = listAfterHeading(
        $,
        /(ingredients|ingredience|suroviny)/i
      );
    }
    if (steps.length === 0) {
      steps = listAfterHeading($, /(instructions|postup|method|directions|kroky)/i);
      // pokud jsme vybrali zrovna jiný seznam (např. blogový TOC), ještě filtruj
      if (steps.length && ingredients.length && steps.length < 2) {
        // necháme raději prázdné – ať se neplete
        steps = [];
      }
    }

    // titulek/obrázek/desc z JSON-LD, pokud jsou lepší
    const title = clean(recipeLd?.name || ogTitle || 'Recept');
    const description = clean(recipeLd?.description || ogDesc || '');
    const image =
      clean(
        (Array.isArray(recipeLd?.image) ? recipeLd.image[0] : recipeLd?.image) ||
          ogImg
      ) || '';

    // značky
    let tags = [];
    const keywords =
      recipeLd?.keywords ||
      $('meta[name="keywords"]').attr('content') ||
      '';
    if (typeof keywords === 'string') {
      tags = keywords
        .split(/[|,;/]/g)
        .map((t) => clean(t.toLowerCase()))
        .filter(Boolean)
        .slice(0, 12);
    }

    // výstup
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
