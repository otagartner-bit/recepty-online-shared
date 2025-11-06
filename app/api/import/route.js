// app/api/import/route.js
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const H = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,cs;q=0.8',
  'upgrade-insecure-requests': '1',
  'cache-control': 'no-cache',
};

const clean = (t) => (t || '').replace(/\u00a0/g,' ').replace(/[ \t]{2,}/g,' ').replace(/\s+\n/g,'\n').replace(/\n\s+/g,'\n').trim();
const toArr = (v) => Array.isArray(v) ? v : v ? [v] : [];
const uniq = (a) => Array.from(new Set(a.filter(Boolean).map(clean)));

async function fetchHtml(url, useProxy=false){
  const u = new URL(url);
  const headers = { ...H, referer: u.origin + '/' };
  let finalUrl = url;

  // Proxy fallback: r.jina.ai vrátí čistý text HTML vykuchaný (bypass bot check)
  if (useProxy){
    const scheme = u.protocol.replace(':','');
    finalUrl = `https://r.jina.ai/${scheme}://${u.host}${u.pathname}${u.search}`;
  }

  const res = await fetch(finalUrl, { headers, redirect: 'follow', cache:'no-store' });
  const text = await res.text().catch(()=>'');

  return { ok: res.ok, status: res.status, text };
}

/* JSON-LD (Recipe) */
function isRecipeType(v){
  if (!v) return false;
  if (Array.isArray(v)) return v.some(x => String(x).toLowerCase()==='recipe');
  return String(v).toLowerCase()==='recipe';
}
function pickRecipeNode(node){
  if (!node) return null;
  if (isRecipeType(node['@type'])) return node;
  if (Array.isArray(node)){
    for (const n of node){ const r = pickRecipeNode(n); if (r) return r; }
    return null;
  }
  for (const k of ['@graph','graph','mainEntity','itemListElement']){
    const r = pickRecipeNode(node[k]); if (r) return r;
  }
  return null;
}
function parseJsonLd($){
  const scripts = $('script[type="application/ld+json"]').map((_,el)=>$(el).contents().text()).get().filter(Boolean);
  let cand = null;
  for (const raw of scripts){
    // ld+json bývá zřetězený → rozsekej a parsuj postupně
    const parts = raw.split(/(?<=\})\s*(?=\{)/);
    for (const p of parts){
      try{
        const data = JSON.parse(p);
        const r = pickRecipeNode(data);
        if (r){ cand = r; break; }
      }catch{}
    }
    if (cand) break;
  }
  if (!cand) return null;

  const recipeInstructions = (ri)=>{
    if (!ri) return [];
    const out = [];
    const walk = (n)=>{
      if (!n) return;
      if (typeof n === 'string') { out.push(clean(n)); return; }
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.itemListElement) { walk(n.itemListElement); return; }
      if (n.steps) { walk(n.steps); return; }
      out.push(clean(n.text || n.name || n.description || ''));
    };
    walk(ri);
    return uniq(out);
  };

  return {
    title: clean(cand.name),
    description: clean(cand.description || ''),
    image: clean(Array.isArray(cand.image) ? cand.image[0] : (cand.image?.url || cand.image || '')),
    ingredients: uniq(toArr(cand.recipeIngredient)),
    steps: recipeInstructions(cand.recipeInstructions),
    servings: clean(cand.recipeYield || ''),
    time: clean([cand.totalTime, cand.cookTime, cand.prepTime].filter(Boolean).join(' ')),
  };
}

/* Pluginy: Tasty / WPRM / Mediavine / WPZOOM / EasyRecipe */
const grab = ($, sel) => $(sel).map((_,el)=>clean($(el).text())).get().filter(Boolean);

function bySelectors($){
  // WPRM
  let ingredients = grab($, '.wprm-recipe-ingredients-container .wprm-recipe-ingredient, ul.wprm-recipe-ingredients li');
  if (!ingredients.length){
    ingredients = $('.wprm-recipe-ingredient').map((_,el)=>{
      const $el=$(el);
      const a = clean($el.find('.wprm-recipe-ingredient-amount').text());
      const u = clean($el.find('.wprm-recipe-ingredient-unit').text());
      const n = clean($el.find('.wprm-recipe-ingredient-name').text());
      const note = clean($el.find('.wprm-recipe-ingredient-notes').text());
      return clean([a,u,n,note].filter(Boolean).join(' ')) || clean($el.text());
    }).get().filter(Boolean);
  }
  let steps = grab($, '.wprm-recipe-instructions-container .wprm-recipe-instruction-text, .wprm-recipe-instruction-text, ol.wprm-recipe-instructions li');

  // Tasty
  if (!ingredients.length) ingredients = grab($, '.tasty-recipes-ingredients li');
  if (!steps.length) steps = grab($, '.tasty-recipes-instructions li');

  // Mediavine Create
  if (!ingredients.length) ingredients = grab($, '.mv-create-ingredients li, .mv-create-ingredients .mv-create-list-item');
  if (!steps.length) steps = grab($, '.mv-create-instructions li, .mv-create-instructions .mv-create-list-item');

  // WPZOOM
  if (!ingredients.length) ingredients = grab($, '.wpzoom-recipe-card .ingredients-list li, .wp-block-wpzoom-recipe-card-block-recipe-card .ingredients-list li');
  if (!steps.length) steps = grab($, '.wpzoom-recipe-card .directions-list li, .wp-block-wpzoom-recipe-card-block-recipe-card .directions-list li');

  // EasyRecipe / Yumprint
  if (!ingredients.length) ingredients = grab($, '.ERIngredients li, .easyrecipe .ingredients li, .yumprint-recipe-ingredients li');
  if (!steps.length) steps = grab($, '.ERInstructions li, .easyrecipe .instructions li, .yumprint-recipe-directions li');

  // Generic itemprop
  if (!ingredients.length) ingredients = grab($, '[itemprop="recipeIngredient"], [itemprop="ingredients"]');
  if (!steps.length){
    const holder = $('[itemprop="recipeInstructions"]').first();
    if (holder.length){
      const li = holder.find('li');
      if (li.length) steps = li.map((_,el)=>clean($(el).text())).get().filter(Boolean);
      else steps = holder.find('p').map((_,el)=>clean($(el).text())).get().filter(Boolean);
    }
  }

  return { ingredients: uniq(ingredients), steps: uniq(steps) };
}

/* Hx sekce (Ingredients / Method) – pro Ottolenghi apod. */
function fromHeadings($){
  const collectAfter = (start)=>{
    const out = [];
    let n = start.next();
    while (n.length && !/^(H1|H2|H3|H4)$/i.test(n.get(0).tagName||'')){
      if (n.is('ul,ol')) n.find('li').each((_,li)=>out.push(clean($(li).text())));
      else if (n.is('p,div,section,article')) { const t=clean(n.text()); if (t) out.push(t); }
      n = n.next();
    }
    return uniq(out);
  };
  let ingredients=[], steps=[];
  const ingHead = $('h1,h2,h3,h4,strong,b').filter((_,el)=>/ingredients?|ingredience|suroviny/i.test(clean($(el).text()))).first();
  if (ingHead.length) ingredients = collectAfter(ingHead);
  const stepHead = $('h1,h2,h3,h4,strong,b').filter((_,el)=>/method|instructions?|postup|directions|kroky/i.test(clean($(el).text()))).first();
  if (stepHead.length) steps = collectAfter(stepHead);
  return { ingredients, steps };
}

/* Čistý text fallback (pro proxy odpověď) */
function textFallback(text){
  const raw = clean(text).replace(/\n{2,}/g,'\n');
  const lower = raw.toLowerCase();

  const find = (labels, from=0)=>{
    let idx=-1; for(const l of labels){ const i=lower.indexOf(l, from); if(i!==-1) idx = idx===-1? i : Math.min(idx,i); }
    return idx;
  };

  const ING = ['\ningredients\n','\ningredience\n','\nsuroviny\n','ingredients\n','ingredience\n','suroviny\n'];
  const STEPS = ['\nmethod\n','\ninstructions\n','\npostup\n','\ndirections\n','method\n','instructions\n','postup\n','directions\n'];

  const iStart = find(ING);
  if (iStart === -1) return { ingredients:[], steps:[] };
  const sStart = find(STEPS, iStart+1);

  const toLines = (s)=> s.split('\n').map(clean).filter(x=>x && !/^(ingredients|ingredience|suroviny|method|instructions?|postup|directions)$/i.test(x));

  let ingredients = toLines(sStart!==-1 ? raw.slice(iStart, sStart) : raw.slice(iStart));
  let steps = toLines(sStart!==-1 ? raw.slice(sStart) : '');

  if (steps.length < 3 && steps.join(' ').includes('. ')){
    steps = steps.join(' ').split(/(?<=\.)\s+/).map(clean).filter(Boolean);
  }
  return { ingredients: uniq(ingredients), steps: uniq(steps) };
}

/* Hlavní handler */
export async function GET(req){
  const u = new URL(req.url);
  const target = u.searchParams.get('url');
  const debug = u.searchParams.get('debug') === '1';
  if (!target) return new Response(JSON.stringify({ error:'Missing url' }), { status:400 });

  const report = { target, tries: [] };

  const tryOnce = async (label, text) => {
    const $ = cheerio.load(text);
    const meta = {
      title: clean($('meta[property="og:title"]').attr('content') || $('title').text() || ''),
      description: clean($('meta[name="description"]').attr('content') || ''),
      image: clean($('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || ''),
    };

    // 1) JSON-LD
    let fromLd = parseJsonLd($);

    // 2) Pluginy
    let { ingredients, steps } = bySelectors($);

    // 3) Headings
    if (!ingredients.length || !steps.length){
      const hx = fromHeadings($);
      if (!ingredients.length) ingredients = hx.ingredients;
      if (!steps.length) steps = hx.steps;
    }

    const result = {
      source: label,
      title: fromLd?.title || meta.title || 'Recept',
      description: fromLd?.description || meta.description || '',
      image: fromLd?.image || meta.image || '',
      ingredients: fromLd?.ingredients?.length ? fromLd.ingredients : ingredients,
      steps: fromLd?.steps?.length ? fromLd.steps : steps,
    };

    report.tries.push({
      label,
      found: {
        title: !!result.title,
        img: !!result.image,
        ingredients: result.ingredients.length,
        steps: result.steps.length,
      }
    });
    return result;
  };

  try{
    // 1) běžný fetch
    const a = await fetchHtml(target, false);
    if (!a.ok) return new Response(JSON.stringify({ error:'Fetch failed', status:a.status }), { status:502 });

    let result = await tryOnce('direct', a.text);

    // 2) Proxy fallback, pokud nic nenašlo (anti-bot / dynamické načtení)
    if ((!result.ingredients.length || !result.steps.length)){
      const b = await fetchHtml(target, true);
      if (b.ok){
        const fromProxy = await tryOnce('proxy:r.jina.ai', b.text);
        if (fromProxy.ingredients.length || fromProxy.steps.length){
          result = {
            ...result,
            ingredients: fromProxy.ingredients.length ? fromProxy.ingredients : result.ingredients,
            steps: fromProxy.steps.length ? fromProxy.steps : result.steps,
            // titulky/popisy necháme z původního, proxy bývá „očesaná“
          };
        }else{
          // zkus čistý text z proxy
          const tf = textFallback(b.text);
          report.tries.push({ label:'proxy:textFallback', found:{ ingredients: tf.ingredients.length, steps: tf.steps.length }});
          if (tf.ingredients.length) result.ingredients = tf.ingredients;
          if (tf.steps.length) result.steps = tf.steps;
        }
      }
    }

    // doplň meta
    result.id = crypto.randomUUID();
    result.source = target;
    if (!result.title) result.title = 'Recept';
    if (!result.description) result.description = '';

    // jednoduché tagy podle obsahu
    const blob = [result.title, result.description, ...result.ingredients, ...result.steps].join(' ').toLowerCase();
    const tags = new Set();
    if (/lentil|čo(č|c)ka/.test(blob)) tags.add('luštěniny');
    if (/beef|hov(ě|e)z(í|i)|short rib/.test(blob)) tags.add('hovězí');
    if (/chicken|ku(ř|r)e/.test(blob)) tags.add('kuřecí');
    if (/noodle|ramen|udon|soba|nudle/.test(blob)) tags.add('nudle');
    if (/soup|pol(é|e)vka/.test(blob)) tags.add('polévka');
    if (/salad|sal(á|a)t/.test(blob)) tags.add('salát');
    if (/gochujang|kimchi|ramen/.test(blob)) tags.add('asijské');
    if (/za'?atar|tahini|labneh|sumac|urfa|harissa/.test(blob)) tags.add('blízký východ');
    result.tags = Array.from(tags);

    if (debug) result._debug = report;

    return new Response(JSON.stringify(result), { headers:{ 'content-type':'application/json' }});
  }catch(e){
    return new Response(JSON.stringify({ error:String(e?.message||e), _debug:report }), { status:500 });
  }
}
