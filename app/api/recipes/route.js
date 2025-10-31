export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';

const UNITS = [
  'g','kg','ml','l','dl','ks','plátků?','stroužk(?:ů|y)?','lžičk(?:a|y|y)','lžic(?:e|í)',
  'hrst(?:i)?','špetk(?:a|y)','balíčk(?:ek|y)','plechov(?:ka|ky)','kost(?:ka|ky)','kaps(?:a|y)'
];
const UNIT_RE = new RegExp(`\\b(\\d+[\\d\\.,\\/]*\\s*(?:${UNITS.join('|')}))\\b`, 'i');

function clean(s=''){ return s.replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim(); }
const hasQty = (t)=> UNIT_RE.test(t) || /^\d+[.,]?\d*\s*[a-zá-ž]/i.test(t);
const isJunk = (t)=> /newsletter|kuchařk|sleva|kód|do obchodu|kulina|sledujte|kupte|novinky|děkuji/i.test(t);

function collectList($, rootSel){
  return $(rootSel).map((_,el)=>clean($(el).text())).get().filter(Boolean);
}

// — INGREDIENTS — (CZ/SK first)
function extractIngredients($){
  // 1) typické „Ingredience“ / „Na …“ nadpisy
  const sectionHeads = $('h2,h3,h4').filter((_,h)=>/ingred|na\s+[^:]+|surovin/i.test($(h).text()));
  let ing = [];
  sectionHeads.each((_,h)=>{
    const next = $(h).nextAll('ul,ol').first();
    if(next.length){
      ing.push(...collectList($, $('li', next)));
    }
  });
  // 2) obvyklé třídy
  if (ing.length < 3){
    ing = collectList($, '[class*="ingred" i] li, [itemprop="recipeIngredient"]');
  }
  // 3) fallback – všechny LI v článku, které vypadají jako suroviny
  if (ing.length < 3){
    const inArticle = $('article li, main li, .content li');
    ing = inArticle.map((_,li)=>clean($(li).text()))
      .get()
      .filter(Boolean)
      .filter(t => hasQty(t) || /^na\s+/i.test(t));
  }
  // odfiltrovat zjevný balast
  ing = ing.filter(t=>!isJunk(t) && t.length<=140);
  // spojit duplicity
  return Array.from(new Set(ing));
}

// — STEPS —
function extractSteps($){
  // 1) strukturované instrukce
  let steps = $('[itemprop="recipeInstructions"] li, [class*="instruction" i] li').map((_,el)=>clean($(el).text())).get();
  // 2) „Postup“ sekce
  if (steps.length < 2){
    $('h2,h3,h4').each((_,h)=>{
      if(/postup|příprava|how to/i.test($(h).text())){
        const next = $(h).nextAll('ol,ul').first();
        if(next.length){
          steps = $('li', next).map((_,li)=>clean($(li).text())).get();
        }
      }
    });
  }
  // 3) fallback – odstavce, ale bez promo
  if (steps.length < 2){
    steps = $('article p, main p, .content p').map((_,p)=>clean($(p).text())).get()
      .filter(Boolean)
      .filter(t => !isJunk(t))
      .filter(t => /míchej|vmíchej|přidej|osmaž|vař|dus|peč|nakráj|promíchej|podlij|povař|podávej|servíruj|osol|opepř/i.test(t));
  }
  // čistka a zkrácení
  steps = steps
    .map(t=>t.replace(/^\d+\.\s*/, '').trim())
    .filter(t=>t && t.length<=400 && !isJunk(t));

  return steps;
}

function extractMeta($){
  const time = clean($('time,[class*="time" i]').first().text());
  const servings = clean($('[itemprop*="serving" i],[class*="serving" i],[class*="porc" i],[class*="portion" i]').first().text());
  return { time: time || undefined, servings: servings || undefined };
}

function guessTags({title, description, ingredients=[], steps=[]}){
  const txt = [title, description, ingredients.join(' '), steps.join(' ')].join(' ').toLowerCase();
  const tags = new Set();
  if (/(soy|oyster|hoisin|shaoxing|sezam|wok|stir-?fry|udon|ramen)/.test(txt)) tags.add('asijské');
  if (/(jalape|chipotle|tortilla|salsa|cilantro)/.test(txt)) tags.add('mexické');
  if (/(parme|mozz|ricotta|bazalk|spag|penne)/.test(txt)) tags.add('italské');
  if (/(česk|slovensk)/.test(txt)) tags.add('české');
  if (/(sumac|tahini|za[’']?atar|pomegranate molasses|aleppo)/.test(txt)) tags.add('blízký východ');

  if (/(kuřecí|kuře|chicken)/.test(txt)) tags.add('kuřecí');
  if (/(hovězí|beef)/.test(txt)) tags.add('hovězí');
  if (/(vepř|pork)/.test(txt)) tags.add('vepřové');
  if (/(ryb|salmon|tuna|cod|losos|treska)/.test(txt)) tags.add('ryby');
  if (/(tofu|tempeh|seitan)/.test(txt)) tags.add('vegetariánské');

  if (/(salát|salad)/.test(txt)) tags.add('salát');
  if (/(polévka|soup|boršč|borsch|borscht)/.test(txt)) tags.add('polévka');
  if (/(dezert|dessert)/.test(txt)) tags.add('dezert');

  if (/(15 ?min)/.test(txt)) tags.add('do15minut');
  if (/(30 ?min|rychl)/.test(txt)) tags.add('do30minut');
  return Array.from(tags);
}

export async function GET(req){
  try{
    const { searchParams } = new URL(req.url);
    const target = searchParams.get('url');
    if(!target) return new Response(JSON.stringify({error:'Missing url'}), {status:400});

    const res = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        'accept-language':'cs-CZ,cs;q=0.9,en;q=0.8',
        'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if(!res.ok) return new Response(JSON.stringify({error:'Fetch failed', status:res.status}), {status:res.status});

    const html = await res.text();
    const dom = new JSDOM(html, { url: target });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const $ = cheerio.load(html);

    const title = clean($('meta[property="og:title"]').attr('content')) || clean($('title').text()) || clean(article?.title) || 'Recept';
    const description = clean($('meta[name="description"]').attr('content')) || clean(article?.textContent?.slice(0,200)) || '';
    const image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';

    // structured data (když je)
    let ld = {};
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).contents().text() || '{}');
        const arr = Array.isArray(json) ? json : [json];
        for (const obj of arr) {
          if ((obj['@type'] || '').toLowerCase().includes('recipe')) { ld = obj; break; }
        }
      } catch {}
    });

    let ingredients = [];
    let steps = [];

    if (ld.recipeIngredient) {
      ingredients = (Array.isArray(ld.recipeIngredient) ? ld.recipeIngredient : [ld.recipeIngredient])
        .map(clean).filter(Boolean);
    }
    if (ld.recipeInstructions) {
      if (Array.isArray(ld.recipeInstructions)) {
        steps = ld.recipeInstructions.map(s => typeof s === 'string' ? s : (s.text || s.name || '')).map(clean).filter(Boolean);
      } else if (typeof ld.recipeInstructions === 'string') {
        steps = ld.recipeInstructions.split(/\.\s+|\n+/).map(clean).filter(Boolean);
      }
    }

    if (ingredients.length < 3) ingredients = extractIngredients($);
    if (steps.length < 2) steps = extractSteps($);

    // finální čištění kroků (zkrátit promo a meta texty)
    steps = steps.filter(t => !isJunk(t));

    const meta = extractMeta($);

    const payload = {
      id: crypto.randomUUID(),
      title,
      description,
      image,
      ingredients,
      steps,
      ...meta,
      tags: guessTags({ title, description, ingredients, steps }),
      source: target
    };

    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type':'application/json' }});
  }catch(e){
    return new Response(JSON.stringify({error:'Importer crashed', message:String(e)}), {status:500});
  }
}
