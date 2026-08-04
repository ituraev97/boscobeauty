#!/usr/bin/env node
// Генератор раздела /blog. Единственный источник правды — blog/posts.json.
// Запуск: node tools/build-blog.mjs
// Только встроенные модули Node, никаких зависимостей и шагов сборки на Netlify.
// Вывод детерминирован: повторный прогон не меняет ни одного байта.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://boscobeauty.uz';
const PER_PAGE = 12;
const CATEGORIES = ['Ногти', 'Волосы', 'Брови и ресницы', 'Подология', 'Полезное'];
const CAT_CLASS = {
  'Ногти': 'c-nails',
  'Волосы': 'c-hair',
  'Брови и ресницы': 'c-brows',
  'Подология': 'c-podo',
  'Полезное': 'c-useful',
};
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const p = (...a) => join(ROOT, ...a);
const read = (f) => readFileSync(p(f), 'utf8');
const changed = [];

function write(f, content) {
  const prev = existsSync(p(f)) ? readFileSync(p(f), 'utf8') : null;
  if (prev === content) return;
  mkdirSync(dirname(p(f)), { recursive: true });
  writeFileSync(p(f), content);
  changed.push(f);
}

function fail(msg) {
  console.error(`\n  Ошибка сборки блога:\n  ${msg}\n`);
  process.exit(1);
}

// ---------- утилиты ----------

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dateRu = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// RFC 822 без обращения к текущему времени — иначе сборка перестанет быть детерминированной
const rfc822 = (iso) => new Date(`${iso}T09:00:00Z`).toUTCString();

function replaceRegion(text, name, body, file) {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1 || j < i) {
    fail(`в ${file} не найдены маркеры ${start} … ${end}`);
  }
  return text.slice(0, i + start.length) + body + text.slice(j);
}

// ---------- загрузка и валидация ----------

function loadPosts() {
  let posts;
  try {
    posts = JSON.parse(read('blog/posts.json'));
  } catch (e) {
    fail(`blog/posts.json не разбирается как JSON: ${e.message}`);
  }
  if (!Array.isArray(posts)) fail('blog/posts.json должен содержать массив объектов');

  const seen = new Set();
  for (const post of posts) {
    const { slug } = post;
    const at = `статья "${slug ?? '(без slug)'}"`;

    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      fail(`${at}: slug должен быть непустым и состоять из латиницы, цифр и дефисов`);
    }
    if (seen.has(slug)) fail(`${at}: слаг дублируется в posts.json`);
    seen.add(slug);

    const file = `blog/${slug}.html`;
    if (!existsSync(p(file))) fail(`${at}: нет файла ${file}`);

    for (const field of ['title', 'cardTitle', 'description', 'excerpt', 'category', 'date', 'updated', 'ogImage']) {
      if (typeof post[field] !== 'string' || !post[field].trim()) {
        fail(`${at}: поле "${field}" отсутствует или пустое`);
      }
    }
    if (post.title.length > 60) {
      fail(`${at}: title длиннее 60 символов (${post.title.length}) — «${post.title}»`);
    }
    if (post.description.length < 140 || post.description.length > 160) {
      fail(`${at}: description должен быть 140–160 символов, сейчас ${post.description.length}`);
    }
    if (!CATEGORIES.includes(post.category)) {
      fail(`${at}: категория «${post.category}» не из списка: ${CATEGORIES.join(', ')}`);
    }
    for (const field of ['date', 'updated']) {
      const v = post[field];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        fail(`${at}: ${field} = "${v}" — ожидается корректная дата в формате ГГГГ-ММ-ДД`);
      }
    }
    if (!Number.isInteger(post.readingMinutes) || post.readingMinutes < 1) {
      fail(`${at}: readingMinutes должно быть целым числом больше нуля`);
    }

    // posts.json — источник правды: расхождение с самим файлом статьи ловим здесь,
    // иначе витрина и <head> статьи со временем разъедутся
    const html = read(file);
    const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
    const desc = /<meta name="description" content="([\s\S]*?)">/.exec(html)?.[1];
    if (title !== post.title) {
      fail(`${at}: <title> в ${file} не совпадает с posts.json\n    в файле:     «${title}»\n    в posts.json: «${post.title}»`);
    }
    if (desc !== post.description) {
      fail(`${at}: meta description в ${file} не совпадает с posts.json\n    в файле:     «${desc}»\n    в posts.json: «${post.description}»`);
    }
  }

  // свежие сверху; при равных датах — по слагу, чтобы порядок был воспроизводимым
  posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
  return posts;
}

// ---------- фрагменты разметки ----------

const cardHtml = (post) => `        <a class="post-card ${CAT_CLASS[post.category]}" href="/blog/${post.slug}">
          <div class="cat">${esc(post.category)}</div>
          <b>${post.cardTitle}</b>
          <span class="excerpt">${post.excerpt}</span>
          <span class="dates">${dateRu(post.date)} · ~${post.readingMinutes} мин</span>
        </a>`;

const relCardHtml = (post) => `        <a class="rel-card" href="/blog/${post.slug}">
          <div class="cat">${esc(post.category)}</div>
          <b>${post.cardTitle}</b>
          <span>${post.excerpt}</span>
        </a>`;

// 3 свежие статьи той же категории, добор до 3 самыми свежими из остальных
function relatedFor(post, posts) {
  const rest = posts.filter((x) => x.slug !== post.slug);
  const same = rest.filter((x) => x.category === post.category);
  const other = rest.filter((x) => x.category !== post.category);
  return [...same, ...other].slice(0, 3);
}

function paginationHtml(page, totalPages) {
  if (totalPages < 2) return '';
  const href = (n) => (n === 1 ? '/blog/' : `/blog/page/${n}/`);
  const parts = [];
  if (page > 1) parts.push(`        <a class="page-link" rel="prev" href="${href(page - 1)}">← Назад</a>`);
  for (let n = 1; n <= totalPages; n++) {
    parts.push(n === page
      ? `        <span class="page-link is-current" aria-current="page">${n}</span>`
      : `        <a class="page-link" href="${href(n)}">${n}</a>`);
  }
  if (page < totalPages) parts.push(`        <a class="page-link" rel="next" href="${href(page + 1)}">Вперёд →</a>`);
  // именно div, а не nav: в assets/styles.css селектор nav{} написан по элементу
  return `\n      <div class="pagination" role="navigation" aria-label="Страницы блога">\n${parts.join('\n')}\n      </div>\n      `;
}

const blogJsonLd = (pagePosts, canonical) => `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Blog",
  "name": "Блог BOSCO Beauty Club",
  "description": "Статьи мастеров BOSCO Beauty Club о маникюре, волосах, бровях и ресницах, подологии и уходе в ташкентском климате.",
  "url": "${canonical}",
  "inLanguage": "ru-RU",
  "publisher": {
    "@type": "Organization",
    "name": "BOSCO Beauty Club",
    "url": "${SITE}/",
    "logo": {"@type": "ImageObject", "url": "${SITE}/web-app-manifest-512x512.png"}
  },
  "blogPost": [
${pagePosts.map((x) => `    {"@type": "BlogPosting", "headline": ${JSON.stringify(x.cardTitle)}, "url": "${SITE}/blog/${x.slug}", "datePublished": "${x.date}"}`).join(',\n')}
  ]
}
</script>`;

// ---------- сборка ----------

function buildIndexPages(posts) {
  const base = read('blog/index.html');
  const totalPages = Math.max(1, Math.ceil(posts.length / PER_PAGE));

  for (let page = 1; page <= totalPages; page++) {
    const slice = posts.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const canonical = page === 1 ? `${SITE}/blog/` : `${SITE}/blog/page/${page}/`;

    let out = base;
    out = replaceRegion(out, 'POSTS', `\n${slice.map(cardHtml).join('\n\n')}\n        `, 'blog/index.html');
    out = replaceRegion(out, 'PAGINATION', paginationHtml(page, totalPages), 'blog/index.html');
    out = replaceRegion(out, 'BLOGLD', `\n${blogJsonLd(slice, canonical)}\n`, 'blog/index.html');

    if (page === 1) {
      write('blog/index.html', out);
      continue;
    }

    // страницы 2+ отличаются только заголовком, canonical и rel prev/next
    out = out
      .replace(/<title>([\s\S]*?)<\/title>/, (_, t) => `<title>${t} — страница ${page}</title>`)
      .replace(`<link rel="canonical" href="${SITE}/blog/">`,
        `<link rel="canonical" href="${canonical}">\n<link rel="prev" href="${page === 2 ? `${SITE}/blog/` : `${SITE}/blog/page/${page - 1}/`}">` +
        (page < totalPages ? `\n<link rel="next" href="${SITE}/blog/page/${page + 1}/">` : ''))
      .replace(`<meta property="og:url" content="${SITE}/blog/">`, `<meta property="og:url" content="${canonical}">`);
    write(`blog/page/${page}/index.html`, out);
  }

  // подчищаем страницы, оставшиеся от прошлых прогонов
  const pagesDir = p('blog/page');
  if (existsSync(pagesDir)) {
    for (const name of readdirSync(pagesDir)) {
      const n = Number(name);
      if (!Number.isInteger(n) || n < 2 || n > totalPages) {
        rmSync(join(pagesDir, name), { recursive: true, force: true });
        changed.push(`blog/page/${name} (удалено)`);
      }
    }
    if (readdirSync(pagesDir).length === 0) rmSync(pagesDir, { recursive: true, force: true });
  }
  return totalPages;
}

function buildRelated(posts) {
  for (const post of posts) {
    const file = `blog/${post.slug}.html`;
    const html = read(file);
    const body = `\n${relatedFor(post, posts).map(relCardHtml).join('\n\n')}\n        `;
    write(file, replaceRegion(html, 'RELATED', body, file));
  }
}

function buildSitemap(posts, totalPages) {
  const urls = [`  <url><loc>${SITE}/blog/</loc><lastmod>${posts[0].updated}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`];
  for (let n = 2; n <= totalPages; n++) {
    urls.push(`  <url><loc>${SITE}/blog/page/${n}/</loc><lastmod>${posts[0].updated}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`);
  }
  for (const post of posts) {
    urls.push(`  <url><loc>${SITE}/blog/${post.slug}</loc><lastmod>${post.updated}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`);
  }
  write('sitemap.xml', replaceRegion(read('sitemap.xml'), 'BLOG', `\n${urls.join('\n')}\n  `, 'sitemap.xml'));
}

function buildRss(posts) {
  const items = posts.slice(0, 20).map((post) => `    <item>
      <title>${esc(post.cardTitle)}</title>
      <link>${SITE}/blog/${post.slug}</link>
      <guid isPermaLink="true">${SITE}/blog/${post.slug}</guid>
      <category>${esc(post.category)}</category>
      <pubDate>${rfc822(post.date)}</pubDate>
      <description>${esc(post.description)}</description>
    </item>`).join('\n');

  write('blog/rss.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Блог BOSCO Beauty Club</title>
    <link>${SITE}/blog/</link>
    <atom:link href="${SITE}/blog/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Статьи мастеров BOSCO Beauty Club о маникюре, волосах, бровях и ресницах, подологии и уходе в ташкентском климате.</description>
    <language>ru</language>
    <lastBuildDate>${rfc822(posts[0].updated)}</lastBuildDate>
${items}
  </channel>
</rss>
`);
}

// ---------- main ----------

const posts = loadPosts();
const totalPages = buildIndexPages(posts);
buildRelated(posts);
buildSitemap(posts, totalPages);
buildRss(posts);

console.log(`Статей: ${posts.length}, страниц витрины: ${totalPages}`);
console.log(changed.length ? `Обновлено файлов: ${changed.length}\n  ${changed.join('\n  ')}` : 'Изменений нет — всё уже собрано.');
