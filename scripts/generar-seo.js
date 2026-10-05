#!/usr/bin/env node
/* Generador de paginas SEO estaticas (Fix 215).
 *
 * Por que existe: Renuevate es una SPA de una sola URL, asi que Google solo
 * veia la portada y ninguna ficha de producto. Este script lee el catalogo
 * (la constante V de index.html, fuente unica) y escribe:
 *   - producto/<slug>/index.html  -> una pagina indexable por producto, con
 *                                    title, description, canonical, Open Graph,
 *                                    JSON-LD Product + BreadcrumbList y enlace
 *                                    directo a la tienda (/?producto=SKU)
 *   - catalogo/index.html         -> hub con enlaces a todos los productos
 *   - sitemap.xml                 -> portada + catalogo + productos
 * Uso:  node scripts/generar-seo.js        (desde la raiz del repo)
 * Volver a correrlo cada vez que cambie el catalogo en index.html y subir los
 * archivos generados. No toca index.html. No usa dependencias.
 *
 * Reglas de contenido: sin AggregateRating ni Review (las resenas de ejemplo
 * no son reales y Google sanciona el marcado de calificaciones falsas), sin
 * claims de salud inventados: solo texto que ya vive en el catalogo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://renuevatehoy.vercel.app';
const BRAND = 'SEYTÚ';
const TODAY = new Date().toISOString().slice(0, 10);

// ---------- 1. Leer catalogo desde index.html ----------
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const a = html.indexOf('var V = {');
const b = html.indexOf('\n};', a) + 3;
if (a < 0 || b < 3) throw new Error('No encontre la constante V en index.html');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(a, b), ctx);
const V = ctx.V;

const VERTICALS = [
  { key: 'nacar', label: 'System T-Specialist', blurb: 'Cuidado facial, maquillaje y suplemento de la linea T-Specialist.' },
  { key: 'vigor', label: 'System Hair Specialist', blurb: 'Cuidado capilar: shampoo, locion y suplemento H-Specialist.' },
  { key: 'roble', label: 'System Spot Specialist', blurb: 'Dermolimpiador, gel localizado y suplemento Spot Specialist.' },
];

// ---------- 2. Utilidades ----------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function slugify(s) {
  return oneLine(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56).replace(/-+$/, '');
}
function priceNumber(p) {
  const m = String(p || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}
function priceLabel(p) {
  const n = priceNumber(p);
  return n == null ? '' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' MXN';
}
function cut(s, n) {
  s = oneLine(s);
  if (s.length <= n) return s;
  const c = s.slice(0, n);
  // preferir cortar en fin de oracion, luego en coma, luego en palabra
  let i = Math.max(c.lastIndexOf('. '), c.lastIndexOf('! '));
  if (i >= 50) return c.slice(0, i + 1);
  i = c.lastIndexOf(', ');
  if (i >= 50) return c.slice(0, i).replace(/[,.;:\s]+$/, '') + '.';
  i = c.lastIndexOf(' ');
  return c.slice(0, i > 40 ? i : c.length).replace(/[,.;:\s]+$/, '') + '…';
}
const abs = (u) => (/^https?:/.test(u) ? u : SITE + '/' + String(u).replace(/^\//, ''));
const jsonld = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, '\\u003c') + '</script>';

// ---------- 3. Aplanar productos ----------
const items = [];
for (const v of VERTICALS) {
  const es = V[v.key] && V[v.key].es;
  if (!es || !es.products) continue;
  for (const p of es.products) {
    const slug = slugify(p.name) + '-' + p.sku.toLowerCase();
    items.push({ v, p, slug, url: SITE + '/producto/' + slug + '/', price: priceNumber(p.price) });
  }
}
const bySku = Object.fromEntries(items.map((i) => [i.p.sku, i]));

// ---------- 4. Estilo compartido de las paginas estaticas ----------
const CSS = `
:root{--ink:#1E1E1E;--grey:#5E5E5E;--line:#D9D9D9;--cream:#F8F7F3;--beige:#EFE9E1;--gold-text:#7A5C1E;--btn:#1E1E1E}
*{box-sizing:border-box}
body{margin:0;background:var(--cream);color:var(--ink);font-family:Manrope,system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit}
.top{background:#fff;border-bottom:1px solid var(--line)}
.top .in{max-width:1100px;margin:0 auto;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.logo{font-family:'Playfair Display',Georgia,serif;font-size:24px;letter-spacing:2px;text-decoration:none}
.logo b{color:#C6A86B;font-style:italic;font-weight:600}
.top nav a{font-size:13px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;text-decoration:none;margin-left:20px}
.wrap{max-width:1100px;margin:0 auto;padding:28px 20px 56px}
.crumbs{font-size:13px;color:var(--grey);margin-bottom:22px}
.crumbs a{color:var(--grey)}
.pdp{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:44px;align-items:start}
.pdp figure{margin:0;background:#fff;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.pdp figure img{display:block;width:100%;height:auto}
.eyebrow{font-size:12px;letter-spacing:2.2px;text-transform:uppercase;color:var(--gold-text);font-weight:700}
h1{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:clamp(28px,4vw,40px);line-height:1.15;margin:8px 0 12px}
h2{font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:22px;margin:30px 0 8px}
.price{font-size:26px;font-weight:700;margin:6px 0 4px}
.price small{font-size:13px;color:var(--grey);font-weight:500}
.lead{color:var(--grey);margin:6px 0 18px}
.cta{display:inline-block;background:var(--btn);color:#fff;text-decoration:none;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;font-size:13px;padding:15px 30px;border-radius:2px}
.cta:hover{opacity:.9}
.alt{display:inline-block;margin-left:14px;font-size:14px}
ul.clean{padding-left:20px;margin:6px 0}
.ing{font-size:14px;color:var(--grey)}
.related{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px;margin-top:10px}
.card{background:#fff;border:1px solid var(--line);border-radius:6px;text-decoration:none;display:block;overflow:hidden}
.card img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--beige)}
.card span{display:block;padding:12px 14px 2px;font-weight:600;font-size:15px}
.card em{display:block;padding:0 14px 14px;font-style:normal;color:var(--grey);font-size:14px}
.group{margin-top:34px}
.foot{border-top:1px solid var(--line);background:#fff;color:var(--grey);font-size:13px}
.foot .in{max-width:1100px;margin:0 auto;padding:22px 20px}
@media(max-width:820px){.pdp{grid-template-columns:1fr;gap:24px}.top nav a{margin-left:12px}}
`;
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">';
const HEADER = `<header class="top"><div class="in"><a class="logo" href="/" aria-label="Renuévate, inicio">RENU<b>É</b>VATE</a><nav aria-label="Principal"><a href="/catalogo/">Catálogo</a><a href="/">Tienda</a></nav></div></header>`;
const FOOTER = `<footer class="foot"><div class="in">Renuévate · Cancún, Quintana Roo, México · Productos ${BRAND} by Omnilife. Precios en pesos mexicanos (MXN). La información de esta página es de carácter informativo y no sustituye la orientación de un profesional de la salud.</div></footer>`;

function head({ title, description, canonical, image, imageAlt, type, extra }) {
  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Renuévate">
<meta property="og:locale" content="es_MX">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">
<link rel="icon" type="image/png" sizes="32x32" href="/media/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/media/favicon-180.png">
${extra}
${FONTS}
<style>${CSS}</style>
</head>`;
}

// ---------- 5. Pagina de producto ----------
function productPage(it) {
  const { v, p, slug, url, price } = it;
  const name = p.name;
  const pLabel = priceLabel(p.price);
  let title = `${name} | ${BRAND} Omnilife México`;
  if (title.length > 68) title = `${name} | ${BRAND} Omnilife`;
  if (title.length > 68) title = `${name} | ${BRAND}`;
  const base = cut(p.desc || (typeof p.longDesc === 'string' ? p.longDesc : ''), 112);
  const description = cut(`${base}${/[.!?…]$/.test(base) ? '' : '.'} ${BRAND} by Omnilife${pLabel ? ', ' + pLabel : ''}. Envío a todo México.`, 158);
  const ogImg = SITE + '/media/og/' + p.sku.toLowerCase() + '.jpg';
  const gallery = [p.img].concat(p.gallery || []).filter(Boolean).map(abs);
  const proximamente = /pr[oó]ximamente/i.test(V[v.key].es.tag || '');

  const product = {
    '@context': 'https://schema.org', '@type': 'Product',
    name, sku: p.sku, mpn: p.sku, url,
    image: gallery,
    description: oneLine(typeof p.longDesc === 'string' ? p.longDesc : (p.desc || '')) || oneLine(p.desc),
    brand: { '@type': 'Brand', name: BRAND },
    category: p.tag || v.label,
  };
  if (price != null) {
    product.offers = {
      '@type': 'Offer', url, priceCurrency: 'MXN', price: price.toFixed(2),
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'Renuévate' },
    };
    // Hair y Spot figuran como "Proximamente" en la tienda: no se declara
    // disponibilidad para no afirmar stock que no esta confirmado.
    if (!proximamente) product.offers.availability = 'https://schema.org/InStock';
  }
  const crumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Catálogo', item: SITE + '/catalogo/' },
      { '@type': 'ListItem', position: 3, name },
    ],
  };

  const long = Array.isArray(p.longDesc)
    ? `<ul class="clean">${p.longDesc.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : (p.longDesc ? `<p>${esc(p.longDesc)}</p>` : '');
  const usage = p.usage ? `<h2>Modo de uso</h2><p>${esc(p.usage)}</p>` : '';
  const ing = (p.ingredients && p.ingredients.length)
    ? `<h2>Ingredientes</h2><p class="ing">${esc(p.ingredients.join(', '))}</p>` : '';
  const shades = (p.shades && p.shades.length)
    ? `<h2>Tonos</h2><p>${esc(p.shades.filter((s) => s.available !== false).map((s) => s.name).join(', '))}</p>` : '';
  const rel = (p.related || []).map((s) => bySku[s]).filter(Boolean).slice(0, 4);
  const relHtml = rel.length ? `<h2>También te puede interesar</h2><div class="related">${rel.map((r) =>
    `<a class="card" href="/producto/${r.slug}/"><img src="/${esc(r.p.thumb || r.p.img)}" alt="${esc(r.p.name)}" loading="lazy" width="300" height="300"><span>${esc(r.p.name)}</span><em>${esc(priceLabel(r.p.price))}</em></a>`).join('')}</div>` : '';

  const body = `<body>
${HEADER}
<main class="wrap">
<nav class="crumbs" aria-label="Ruta"><a href="/">Inicio</a> › <a href="/catalogo/">Catálogo</a> › ${esc(name)}</nav>
<article class="pdp">
<figure><img src="/${esc(p.img)}" alt="${esc(name)} ${BRAND}" width="1200" height="1200" fetchpriority="high"></figure>
<div>
<div class="eyebrow">${esc(v.label)}${p.tag ? ' · ' + esc(p.tag) : ''}</div>
<h1>${esc(name)}</h1>
${pLabel ? `<div class="price">${esc(pLabel)}</div>` : ''}
<p class="lead">${esc(oneLine(p.desc))}</p>
<p><a class="cta" href="/?producto=${encodeURIComponent(p.sku)}">Comprar en Renuévate</a><a class="alt" href="/catalogo/">Ver todo el catálogo</a></p>
<h2>Descripción</h2>
${long}
${shades}
${usage}
${ing}
</div>
</article>
${relHtml}
</main>
${FOOTER}
</body>
</html>
`;
  return head({
    title, description, canonical: url, image: ogImg, imageAlt: `${name} ${BRAND}`, type: 'product',
    extra: jsonld(product) + '\n' + jsonld(crumbs),
  }) + '\n' + body;
}

// ---------- 6. Catalogo (hub) ----------
function catalogPage() {
  const url = SITE + '/catalogo/';
  const title = `Catálogo de productos ${BRAND} by Omnilife en México | Renuévate`;
  const description = cut(`Catálogo completo ${BRAND} by Omnilife: cuidado facial, maquillaje, cuidado capilar y suplementos. ${items.length} productos con envío a todo México.`, 158);
  const list = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: `Catálogo ${BRAND} Renuévate`,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: it.url, name: it.p.name })),
  };
  const crumbs = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Catálogo' },
    ],
  };
  const groups = VERTICALS.map((v) => {
    const its = items.filter((i) => i.v.key === v.key);
    if (!its.length) return '';
    return `<section class="group"><h2>${esc(v.label)}</h2><p class="lead">${esc(v.blurb)}</p><div class="related">${its.map((r) =>
      `<a class="card" href="/producto/${r.slug}/"><img src="/${esc(r.p.thumb || r.p.img)}" alt="${esc(r.p.name)}" loading="lazy" width="300" height="300"><span>${esc(r.p.name)}</span><em>${esc(priceLabel(r.p.price))}</em></a>`).join('')}</div></section>`;
  }).join('\n');
  return head({
    title, description, canonical: url, image: SITE + '/media/og-image.jpg', imageAlt: 'Catálogo Renuévate', type: 'website',
    extra: jsonld(list) + '\n' + jsonld(crumbs),
  }) + `
<body>
${HEADER}
<main class="wrap">
<nav class="crumbs" aria-label="Ruta"><a href="/">Inicio</a> › Catálogo</nav>
<div class="eyebrow">Renuévate</div>
<h1>Catálogo de productos ${BRAND} by Omnilife</h1>
<p class="lead">Cuidado facial, maquillaje, cuidado capilar y suplementos ${BRAND}, con envío a todo México. Elige un producto para ver su descripción, modo de uso e ingredientes, o entra a la tienda para comprarlo.</p>
<p><a class="cta" href="/">Ir a la tienda</a></p>
${groups}
</main>
${FOOTER}
</body>
</html>
`;
}

// ---------- 7. Sitemap ----------
function sitemap() {
  const rows = [
    { loc: SITE + '/', freq: 'weekly', pr: '1.0' },
    { loc: SITE + '/catalogo/', freq: 'weekly', pr: '0.9' },
  ].concat(items.map((i) => ({ loc: i.url, freq: 'monthly', pr: '0.8', img: abs(i.p.img) })));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    rows.map((r) => `  <url>\n    <loc>${r.loc}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>${r.freq}</changefreq>\n    <priority>${r.pr}</priority>${r.img ? `\n    <image:image><image:loc>${r.img}</image:loc></image:image>` : ''}\n  </url>`).join('\n') +
    '\n</urlset>\n';
}

// ---------- 8. Escribir ----------
function write(rel, content) {
  const f = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content, 'utf8');
}
for (const it of items) write(`producto/${it.slug}/index.html`, productPage(it));
write('catalogo/index.html', catalogPage());
write('sitemap.xml', sitemap());
write('scripts/seo-slugs.json', JSON.stringify(items.map((i) => ({ sku: i.p.sku, slug: i.slug, name: i.p.name })), null, 1));
console.log(`OK: ${items.length} productos, catalogo/ y sitemap.xml (${items.length + 2} URLs)`);
