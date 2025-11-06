export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const HEADERS = {
  'user-agent': UA,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,cs;q=0.8',
  'upgrade-insecure-requests': '1',
};

const clean = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };
const listify = (v) => Array.isArray(v) ? v.map(x=>clean(String(x))).filter(Boolean)
  : (typeof v === 'string' ? [clean(v)] : []);

function okRecipeType(v){ if(!v) return false; if(Array.isArray(v)) return v.some(x=>String(x).toLowerCase()==='recipe'); return String(v).toLowerCase()==='recipe'; }
function pickRecipe(node){
  if(!node) return null;
  if(okRecipeType(node['@type'])) return node;
  if(Array.isArray(node)){ for(const n of node){ const r = pickRecipe(n); if(r) return r; } return null; }
  for(const k of ['mainEntity','@graph','graph','itemListElement']){ const r=pickRecipe(node[k]); if(r) return r; }
  return null;
}
function parseLdSteps(v){
  if(!v) return [];
  const out=[]; const push=s=>{const t=clean(s); if(t) out.push(t);};
  const walk=n=>{
    if(!n) return;
    if(typeof n==='string'){ push(n); return; }
    if(Array.isArray(n)){ n.forEach(walk); return; }
    if(n.itemListElement){ walk(n.itemListElement); return; }
    if(n.steps){ walk(n.steps); return; }
    push(n.text || n.name || n.description || '');
  };
  walk(v);
  return out;
}
function textListFrom($, root){
  if(!root || root.length===0) return [];
  const li = root.find('li');
  if(li.length) return li.map((_,el)=>clean($(el).text())).get().filter(Boolean);
  const p = root.find('p');
  if(p.length) return p.map((_,el)=>clean($(el).text())).get().filter(Boolean);
  const txt = clean(root.text());
  if(!txt) return [];
  if(txt.includes('\n')) return txt.split('\n').map(clean).filter(Boolean);
  return [txt];
}

// Najdi UL/OL podle nejbližšího předcházejícího nadpisu s daným regexem
function listByNearestHeading($, re){
  // projdi všechny UL/OL a podívej se na předchozí sourozence a rodiče, zda obsahují nadpis
  const candidates = [];
  $('ul,ol').each((_, el)=>{
    const $el=$(el);
    // nejbližší předcházející nadpis v rámci stejného rodiče
    let prev = $el.prevAll('h2,h3,h4,strong,b').first();
    if(!prev.length){
      // zkus rodiče a jeho předchozí sourozence
      const parent = $el.parent();
      if(parent && parent.length){
        prev = parent.prevAll('h2,h3,h4,strong,b').first();
      }
    }
    if(prev && prev.length){
      const head = clean(prev.text()).toLowerCase();
      if(re.test(head)){
        const items = $el.find('li').map((_,li)=>clean($(li).text())).get().filter(Boolean);
        if(items.length) candidates.push(items);
      }
    }
  });
  return candidates[0] || [];
}

async function fetchHtml(url){
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow', cache: 'no-store' });
  if(!res.ok) throw new Error('Fetch failed: '+res.status);
  const html = await res.text();
  return { $, html, url, $: cheerio.load(html) };
}

/* --------- JSON-LD --------- */
function parseJsonLd($){
  const scripts = $('script[type="application/ld+json"]').map((_,el)=>$(el).contents().text()).get().filter(Boolean);
  let cand=null;
  for(const raw of scripts){
    const chunks = raw
      .replace(/<\/?script[^>]*>/gi,'')
      .split(/(?<=\})\s*(?=\{)|\n(?=\s*\{)/).map(s=>s.trim()).filter(Boolean);
    for(const ch of chunks){
      const data = j(ch);
      if(!data) continue;
      const r = pickRecipe(data);
      if(r){ cand=r; break; }
    }
    if(cand) break;
  }
  if(!cand) return null;
  return {
    title: clean(cand.name),
    description: clean(cand.description),
    image: clean(Array.isArray(cand.image)?cand.image[0]:cand.image),
    ingredients: listify(cand.recipeIngredient),
    steps: parseLdSteps(cand.recipeInstructions)
  };
}

/* --------- Parséry pro různé pluginy --------- */
// Tasty Recipes (Pinch of Yum)
function tastyIngredients($){
  return $(
    '.tasty-recipes .tasty-recipes-ingredients li,'+
    '.tasty-recipes-ingredients li,'+
    '.tasty-recipe-ingredients li'
  ).map((_,el)=>clean($(el).text())).get().filter(Boolean);
}
function tastySteps($){
  const li = $(
    '.tasty-recipes .tasty-recipes-instructions li,'+
    '.tasty-recipes-instructions li,'+
    '.tasty-recipe-instructions li'
  ).map((_,el)=>clean($(el).text())).get().filter(Boolean);
  if(li.length) return li;
  const p = $(
    '.tasty-recipes .tasty-recipes-instructions p,'+
    '.tasty-recipes-instructions p'
  ).map((_,el)=>clean($(el).text())).get().filter(Boolean);
  return p;
}

// Mediavine Create
function mvIngredients($){
  return $(
    '.mv-create-ingredients li,'+
    '.mv-create-ingredients .mv-create-list-item'
  ).map((_,el)=>clean($(el).text())).get().filter(Boolean);
}
function mvSteps($){
  return $(
    '.mv-create-instructions li,'+
    '.mv-create-instructions .mv-create-list-item'
  ).map((_,el)=>clean($(el).text())).get().filter(Boolean);
}

// WPZOOM Recipe Card
function wpzoomIngredients($){
  return $(
    '.wpzoom-recipe-card .ingredients-list li,'+
    '.wp-block-wpzoom-recipe-card-block-recipe-card .ingredients-list li'
  ).map((_,el)=>clean($(el).text())).get().filter(Boolean);
}
function wpzoomSteps($){
  return $(
    '.wpzoom-recipe-card .directions-list li,'+
    '.wp-block-wpzoom-recipe-card-block-recipe-card .directions-list li'
  ).map((_,el)=>clean($(el).text())).get().filter(Boolean);
}

// WPRM (rezerva)
function wprmIngredients($){
  const rows = $('.wprm-recipe-ingredients-container .wprm-recipe-ingredient, .wprm-recipe-ingredients .wprm-recipe-ingredient');
  if(rows.length){
    const items = rows.map((_,el)=>{
      const $el=$(el);
      const amount=clean($el.find('.wprm-recipe-ingredient-amount').text());
      const unit  =clean($el.find('.wprm-recipe-ingredient-unit').text());
      const name  =clean($el.find('.wprm-recipe-ingredient-name').text()||$el.find('.wprm-recipe-ingredient').text());
      const notes =clean($el.find('.wprm-recipe-ingredient-notes').text());
      const joined=[amount,unit,name,notes].filter(Boolean).join(' ');
      return clean(joined||$el.text());
    }).get().filter(Boolean);
    if(items.length) return items;
  }
  const simple = $('.wprm-recipe-ingredients-container li, .wprm-recipe-ingredients li').map((_,el)=>clean($(el).text())).get().filter(Boolean);
  return simple;
}
function wprmSteps($){
  const steps = $('.wprm-recipe-instructions-container .wprm-recipe-instruction, .wprm-recipe-instruction')
    .map((_,el)=>clean($(el).find('.wprm-recipe-instruction-text').text()||$(el).text()))
    .get().filter(Boolean);
  if(steps.length) return steps;
  const simple = $('.wprm-recipe-instructions-container li, .wprm-recipe-instructions li').map((_,el)=>clean($(el).text())).get().filter(Boolean);
  return simple;
}

// EasyRecipe / Yumprint (starší blogy)
function easyIngredients($){
  return $('.ERIngredients li, .easyrecipe .ingredients li, .yumprint-recipe-ingredients li')
    .map((_,el)=>clean($(el).text())).get().filter(Boolean);
}
function easySteps($){
  return $('.ERInstructions li, .easyrecipe .instructions li, .yumprint-recipe-directions li')
    .map((_,el)=>clean($(el).text())).get().filter(Boolean);
}

/* --------- Generic fallback --------- */
function genericIngredients($){
  const s1 = $('[itemprop="recipeIngredient"], [itemprop="ingredients"]').map((_,el)=>clean($(el).text())).get().filter(Boolean);
  if(s1.length) return s1;
  for(const sel of ['.ingredients','.ingredient-list','.recipe-ingredients','#ingredients']){
    const items = textListFrom($,$(sel).first());
    if(items.length) return items;
  }
  const byHead = listByNearestHeading($, /(ingredients|ingredience|suroviny)/i);
  if(byHead.length) return byHead;
  return [];
}
function genericSteps($){
  const holder = $('[itemprop="recipeInstructions"]').first();
  if(holder && holder.length){
    const li = holder.find('li'); if(li.length) return li.map((_,el)=>clean($(el).text())).get().filter(Boolean);
    const p  = holder.find('p');  if(p.length)  return p.map((_,el)=>clean($(el).text())).get().filter(Boolean);
    const txt= clean(holder.text());
    if(txt.includes('\n')) return txt.split('\n').map(clean).filter(Boolean);
    if(txt) return [txt];
  }
  for(const sel of ['.instructions','.instruction-list','.recipe-instructions','#instructions']){
    const items = textListFrom($,$(sel).first());
    if(items.length) return items;
  }
  const byHead = listByNearestHeading($, /(instructions|postup|method|directions|kroky)/i);
  if(byHead.length) return byHead;
  return [];
}

/* --------- handler --------- */
export async function GET(req){
  const u = new URL(req.url);
  const target = u.searchParams.get('url');
  if(!target) return new Response(JSON.stringify({error:'Missing url'}),{status:400});

  try{
    // originál
    let { $ } = await fetchHtml(target);

    // JSON-LD
    let meta = parseJsonLd($);

    // Pluginy – Tasty → Mediavine → WPZOOM → WPRM → Easy/Yumprint
    let ingredients =
      tastyIngredients($) ||
      mvIngredients($) ||
      wpzoomIngredients($) ||
      wprmIngredients($) ||
      easyIngredients($);
    let steps =
      tastySteps($) ||
      mvSteps($) ||
      wpzoomSteps($) ||
      wprmSteps($) ||
      easySteps($);

    if(!ingredients.length) ingredients = genericIngredients($);
    if(!steps.length)       steps       = genericSteps($);

    // AMP pokus
    if((!ingredients.length || !steps.length) && !/\/amp\/?$/.test(target)){
      try{
        const ampUrl = target.replace(/\/$/, '') + '/amp/';
        const amp = await fetchHtml(ampUrl);
        const $amp = amp.$;

        if(!meta) meta = parseJsonLd($amp);

        if(!ingredients.length){
          ingredients =
            tastyIngredients($amp) ||
            mvIngredients($amp) ||
            wpzoomIngredients($amp) ||
            wprmIngredients($amp) ||
            easyIngredients($amp) ||
            genericIngredients($amp);
        }
        if(!steps.length){
          steps =
            tastySteps($amp) ||
            mvSteps($amp) ||
            wpzoomSteps($amp) ||
            wprmSteps($amp) ||
            easySteps($amp) ||
            genericSteps($amp);
        }
      }catch{/* ignore */}
    }

    const title = clean(meta?.title) || clean($('meta[property="og:title"]').attr('content') || $('title').text()) || 'Recept';
    const description = clean(meta?.description) || clean($('meta[name="description"]').attr('content')) || '';
    const image = clean(meta?.image) || clean($('meta[property="og:image"]').attr('content') || '');

    return new Response(JSON.stringify({
      id: crypto.randomUUID(),
      title, description, image,
      ingredients, steps,
      tags: [],
      source: target
    }), { headers:{'content-type':'application/json'} });

  }catch(e){
    return new Response(JSON.stringify({error:String(e)}),{status:500});
  }
}
