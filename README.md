# Recepty – online import z URL (Next.js)

Vlož odkaz na libovolný recept a tento projekt:
- stáhne stránku na serveru (Next.js API `/api/import`),
- vytáhne název, obrázek, ingredience, postup, porce/čas,
- automaticky odhadne tagy (např. kuřecí, asijské, italské),
- uloží recept do **localStorage** pro rychlé online vyhledávání a filtrování.

## Lokální běh
```bash
npm install
npm run dev
```
Otevři: http://localhost:3000

## Nasazení (Vercel)
- Importuj tento projekt do Vercelu (GitHub / nebo Vercel CLI).
- Build: `next build`, Start: `next start` (výchozí).
- Není potřeba žádná databáze – data se ukládají per uživatel (localStorage).

## Struktura
- `app/page.jsx` – UI (vkládání URL, přehled, filtry, detail)
- `app/api/import/route.js` – server-side extrakce receptu (JSDOM + Readability + Cheerio)