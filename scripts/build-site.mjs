/**
 * Build the public website from the Aura page mirror.
 *
 * The mirror in Desktoprevive-aura-mirror/aura-pages is a set of complete,
 * standalone HTML pages exported from Aura. They are the source of truth for
 * design and copy; this script turns them into pages we host ourselves:
 *
 *   - images repointed from Aura's storage to /site-assets (already downloaded)
 *   - Aura editor/CMS scaffolding stripped
 *   - internal links rewritten from Aura's slugs to clean canonical URLs
 *   - backend calls made same-origin (no CORS, one less thing to break)
 *   - real per-page SEO metadata injected, replacing Aura's template defaults
 *
 * It is written as a transformation rather than a one-off edit so the mirror
 * stays the editable source: re-export from Aura, re-run this, keep the SEO.
 *
 *   node scripts/build-site.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'Desktoprevive-aura-mirror', 'aura-pages');
const OUT = join(root, 'public');

const SITE = 'https://www.reviveexteriorcleaningsolutions.co.uk';

/**
 * Aura's page slugs, mapped to the clean URLs we serve.
 * Express redirects the old slugs to these (see index.js), and every internal
 * link is rewritten so the site itself only ever links to the canonical form.
 */
const SLUG_MAP = {
  '/home': '/',
  '/services-2': '/services',
  '/contact-us': '/contact',
  '/before-and-after': '/before-after',
  '/instant-quote-page': '/instant-quote',
  '/legal-pages-privacy-cookies-terms': '/legal',
  '/terms': '/legal',
  '/cookies': '/legal',
  '/quote': '/instant-quote'
};

/**
 * One entry per page. `file` is the mirror filename, `url` the canonical path.
 * The title and description are what Google and AI assistants actually show,
 * so they are written for a customer searching for this service in Swansea —
 * not the Aura template boilerplate they replace.
 */
const PAGES = [
  {
    file: 'home.html',
    out: 'index.html',
    url: '/',
    title: 'Revive Exterior Cleaning Solutions | Swansea & South Wales',
    description:
      'Professional exterior cleaning in Swansea and South Wales. Driveway and patio pressure washing, roof soft washing, gutter clearing and render cleaning. Fully insured, free instant online quote.'
  },
  {
    file: 'services.html',
    out: 'services.html',
    url: '/services',
    title: 'Our Cleaning Services | Revive Exterior Cleaning Swansea',
    description:
      'Driveway and patio cleaning, roof soft washing, gutter clearing and repairs, render and conservatory soft washing across Swansea and South Wales. Typical prices from £80. Get an instant estimate.'
  },
  {
    file: 'instant-quote.html',
    out: 'instant-quote.html',
    url: '/instant-quote',
    title: 'Get an Instant Quote | Revive Exterior Cleaning Swansea',
    description:
      'Get a free estimate for exterior cleaning in Swansea in under two minutes. Answer a few questions about your property and receive an instant price range by email — no phone call needed.'
  },
  {
    file: 'before-after.html',
    out: 'before-after.html',
    url: '/before-after',
    title: 'Before & After Gallery | Revive Exterior Cleaning Swansea',
    description:
      'Real results from driveways, roofs, patios and render cleaned across Swansea and South Wales. See the difference professional exterior cleaning makes before you book.'
  },
  {
    file: 'about.html',
    out: 'about.html',
    url: '/about',
    title: 'About Us | Revive Exterior Cleaning Solutions Swansea',
    description:
      'Revive Exterior Cleaning Solutions is a fully insured exterior property cleaning company serving Swansea and South Wales, using professional equipment and eco-friendly cleaning solutions.'
  },
  {
    file: 'contact.html',
    out: 'contact.html',
    url: '/contact',
    title: 'Contact Us | Revive Exterior Cleaning Solutions Swansea',
    description:
      'Get in touch with Revive Exterior Cleaning Solutions in Swansea. Call, WhatsApp or request a free online quote for driveway, roof, gutter and render cleaning across South Wales.'
  },
  {
    file: 'legal.html',
    out: 'legal.html',
    url: '/legal',
    title: 'Privacy, Cookies & Terms | Revive Exterior Cleaning Solutions',
    description:
      'Privacy policy, cookie policy and terms of service for Revive Exterior Cleaning Solutions, Swansea.',
    noindex: true // Legal boilerplate should not compete with service pages.
  }
];

/** The business, described once, for search engines and AI assistants. */
function localBusinessSchema(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${SITE}/#business`,
    name: 'Revive Exterior Cleaning Solutions',
    description:
      'Professional exterior cleaning and property maintenance services in Swansea and South Wales.',
    url: SITE,
    telephone: '+447934032980',
    areaServed: [
      { '@type': 'City', name: 'Swansea' },
      { '@type': 'AdministrativeArea', name: 'South Wales' }
    ],
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Swansea',
      addressRegion: 'Wales',
      addressCountry: 'GB'
    },
    priceRange: '££',
    image: `${SITE}/site-assets/${HERO_IMAGE}`,
    sameAs: ['https://www.facebook.com/ReviveSwansea/'],
    makesOffer: [
      'Driveway and Patio Cleaning',
      'Roof Cleaning and Soft Washing',
      'Gutter Cleaning and Repairs',
      'Render and Conservatory Soft Washing'
    ].map(name => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name }
    })),
    mainEntityOfPage: `${SITE}${page.url}`
  };
}

// A real photo of real work beats a stock template preview as the social card.
const HERO_IMAGE = '7ade882e-bc5a-44e5-8d4f-c8fbafda87c1_3840w.jpg';

function seoHead(page) {
  const canonical = `${SITE}${page.url}`;
  const image = `${SITE}/site-assets/${HERO_IMAGE}`;
  const robots = page.noindex
    ? 'noindex, follow'
    : 'index, follow, max-image-preview:large';

  return `<title>${page.title}</title>
<meta name="description" content="${page.description}" />
<meta name="robots" content="${robots}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Revive Exterior Cleaning Solutions" />
<meta property="og:title" content="${page.title}" />
<meta property="og:description" content="${page.description}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${image}" />
<meta property="og:locale" content="en_GB" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${page.title}" />
<meta name="twitter:description" content="${page.description}" />
<meta name="twitter:image" content="${image}" />
<script type="application/ld+json">${JSON.stringify(localBusinessSchema(page))}</script>`;
}

function transform(html, page) {
  let out = html;

  // 1. Images: Aura's storage -> the copies we now host. Query strings on those
  //    URLs were Aura's resizer; the stored object is the same file either way.
  out = out.replace(
    /https:\/\/hoirqrkdgbmvpwutwuwj\.supabase\.co\/storage\/v1\/object\/public\/assets\/assets\/([^"'\s)]+)/g,
    (_match, file) => `/site-assets/${file.replace(/\?.*$/, '').replace(/&amp;.*$/, '')}`
  );

  // 2. Backend calls become same-origin now that the site and API share a host.
  out = out.replace(
    /https:\/\/revive-backend-repo-production\.up\.railway\.app/g,
    ''
  );

  // 3. Aura's editor and CMS scaffolding has no meaning outside their editor.
  out = out.replace(/<style id="aura-editor-visibility-style">[\s\S]*?<\/style>/g, '');
  out = out.replace(/<style id="cms-loading-styles">[\s\S]*?<\/style>/g, '');
  out = out.replace(/\bcms-loading\b/g, '');

  // 4. Internal links: Aura's slugs -> canonical URLs. Longest first, so
  //    '/instant-quote-page' is matched before '/instant-quote'.
  for (const [from, to] of Object.entries(SLUG_MAP).sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`href="${from}(?=["?#/])`, 'g'), `href="${to}`);
    out = out.replace(new RegExp(`href="${from}"`, 'g'), `href="${to}"`);
  }

  // 5. Replace the whole head SEO section. Aura shipped a <title> and nothing
  //    else useful, so drop the title and insert the real block in its place.
  out = out.replace(/<title>[\s\S]*?<\/title>/, seoHead(page));

  return out;
}

// ---- run ----

if (!existsSync(SRC)) {
  console.error(`Mirror not found at ${SRC}`);
  process.exit(1);
}

console.log('Building site from Aura mirror\n');

let built = 0;
for (const page of PAGES) {
  const src = join(SRC, page.file);
  if (!existsSync(src)) {
    console.log(`  SKIP  ${page.file} — not in mirror`);
    continue;
  }

  const html = readFileSync(src, 'utf8');
  const out = transform(html, page);
  writeFileSync(join(OUT, page.out), out, 'utf8');

  const remaining = (out.match(/hoirqrkdgbmvpwutwuwj\.supabase\.co/g) || []).length;
  console.log(
    `  ${page.out.padEnd(22)} ${page.url.padEnd(16)} ${(out.length / 1024).toFixed(0).padStart(4)} KB` +
    (remaining ? `  ⚠ ${remaining} Aura URL(s) left` : '')
  );
  built++;
}

// Keep the sitemap honest: it must list the URLs we actually serve.
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.filter(p => !p.noindex)
  .map(
    p => `  <url>
    <loc>${SITE}${p.url}</loc>
    <changefreq>weekly</changefreq>
    <priority>${p.url === '/' ? '1.0' : '0.8'}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;
writeFileSync(join(OUT, 'sitemap.xml'), sitemap, 'utf8');

console.log(`\n${built} pages built, sitemap rewritten with ${PAGES.filter(p => !p.noindex).length} URLs`);
