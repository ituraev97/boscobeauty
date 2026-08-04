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

// Русский — основной язык, лежит в /blog/. Остальные — в подкаталогах.
// titleMax и descRange заданы на язык: в поисковой выдаче ограничение по ширине,
// а иероглиф занимает примерно вдвое больше места, чем латинская буква. Держать
// китайское описание в 140–160 знаках бессмысленно — оно всё равно обрежется.
const LANGS = [
  { code: 'ru', dir: '',    htmlLang: 'ru',    locale: 'ru_RU', titleMax: 60, descRange: [140, 160] },
  { code: 'uz', dir: 'uz/', htmlLang: 'uz',    locale: 'uz_UZ', titleMax: 60, descRange: [140, 160] },
  { code: 'en', dir: 'en/', htmlLang: 'en',    locale: 'en_US', titleMax: 60, descRange: [140, 160] },
  { code: 'zh', dir: 'zh/', htmlLang: 'zh-CN', locale: 'zh_CN', titleMax: 30, descRange: [70, 90] },
];
const BASE = LANGS[0];
const byCode = (c) => LANGS.find((l) => l.code === c);

const CATEGORIES = ['Ногти', 'Волосы', 'Брови и ресницы', 'Подология', 'Полезное'];
const CAT_CLASS = {
  'Ногти': 'c-nails', 'Волосы': 'c-hair', 'Брови и ресницы': 'c-brows',
  'Подология': 'c-podo', 'Полезное': 'c-useful',
};
// Подписи категорий и служебные строки витрин по языкам
const CAT_LABEL = {
  ru: { 'Ногти': 'Ногти', 'Волосы': 'Волосы', 'Брови и ресницы': 'Брови и ресницы', 'Подология': 'Подология', 'Полезное': 'Полезное' },
  uz: { 'Ногти': 'Tirnoqlar', 'Волосы': 'Sochlar', 'Брови и ресницы': 'Qosh va kiprik', 'Подология': 'Podologiya', 'Полезное': 'Foydali' },
  en: { 'Ногти': 'Nails', 'Волосы': 'Hair', 'Брови и ресницы': 'Brows & lashes', 'Подология': 'Podiatry', 'Полезное': 'Useful' },
  zh: { 'Ногти': '美甲', 'Волосы': '头发', 'Брови и ресницы': '眉毛与睫毛', 'Подология': '足部护理', 'Полезное': '实用' },
};
const READ_LABEL = { ru: (n) => `~${n} мин`, uz: (n) => `~${n} daqiqa`, en: (n) => `~${n} min`, zh: (n) => `~${n} 分钟` };
const RSS_TEXT = {
  ru: { title: 'Блог BOSCO Beauty Club', desc: 'Статьи мастеров BOSCO Beauty Club о маникюре, волосах, бровях и ресницах, подологии и уходе в ташкентском климате.' },
  uz: { title: 'BOSCO Beauty Club blogi', desc: 'BOSCO Beauty Club ustalarining manikyur, soch, qosh va kiprik, podologiya hamda Toshkent iqlimida parvarish haqidagi maqolalari.' },
  en: { title: 'BOSCO Beauty Club blog', desc: 'Articles by BOSCO Beauty Club specialists on nails, hair, brows and lashes, podiatry and care in the Tashkent climate.' },
  zh: { title: 'BOSCO Beauty Club 博客', desc: 'BOSCO Beauty Club 美容师撰写的美甲、头发、眉睫、足部护理以及塔什干气候下的护理文章。' },
};
const EMPTY_NOTE = {
  ru: 'Статьи на этом языке ещё готовятся.',
  uz: "Bu tilda maqolalar hali tayyorlanmoqda.",
  en: 'Articles in this language are still being prepared.',
  zh: '该语言的文章仍在准备中。',
};
const MONTHS = {
  ru: ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'],
  uz: ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'],
  en: ['January','February','March','April','May','June','July','August','September','October','November','December'],
  zh: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
};

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

function dateLocal(iso, code) {
  const [y, m, d] = iso.split('-').map(Number);
  if (code === 'zh') return `${y}年${m}月${d}日`;
  if (code === 'en') return `${MONTHS.en[m - 1]} ${d}, ${y}`;
  if (code === 'uz') return `${d}-${MONTHS.uz[m - 1]} ${y}`;
  return `${d} ${MONTHS.ru[m - 1]} ${y}`;
}

// RFC 822 без обращения к текущему времени — иначе сборка перестанет быть детерминированной
const rfc822 = (iso) => new Date(`${iso}T09:00:00Z`).toUTCString();

const postUrl = (lang, slug) => `${SITE}/blog/${lang.dir}${slug}`;
const listUrl = (lang) => `${SITE}/blog/${lang.dir}`;
const postFile = (lang, slug) => `blog/${lang.dir}${slug}.html`;
const listFile = (lang) => `blog/${lang.dir}index.html`;

// Приводит страницу блога к её языку. Делается на каждой сборке, поэтому не может
// разъехаться: data-page-lang читает assets/site.js и не подменяет ни интерфейс, ни
// атрибут lang; ссылки «Блог» в шапке и футере ведут на витрину своего языка, а не
// на русскую. Оба места опознаются по data-ru="Блог" — обычных ссылок это не касается.
function applyLangChrome(html, lang) {
  let out = html.replace(/<html lang="([^"]*)"(?: data-page-lang="[^"]*")?>/,
    `<html lang="$1" data-page-lang="${lang.code}">`);
  out = out.replace(/(<a class="nl" href=")\/blog\/[a-z]*\/?("[^>]*data-ru="Блог")/,
    `$1/blog/${lang.dir}$2`);
  out = out.replace(/(<a href=")\/blog\/[a-z]*\/?("\s+data-ru="Блог")/,
    `$1/blog/${lang.dir}$2`);
  return out;
}

function replaceRegion(text, name, body, file) {
  const start = `<!-- ${name}:START -->`;
  const end = `<!-- ${name}:END -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1 || j < i) fail(`в ${file} не найдены маркеры ${start} … ${end}`);
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

    if (!CATEGORIES.includes(post.category)) {
      fail(`${at}: категория «${post.category}» не из списка: ${CATEGORIES.join(', ')}`);
    }
    for (const field of ['date', 'updated']) {
      const v = post[field];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        fail(`${at}: ${field} = "${v}" — ожидается корректная дата в формате ГГГГ-ММ-ДД`);
      }
    }
    if (typeof post.ogImage !== 'string' || !post.ogImage) fail(`${at}: не задан ogImage`);

    if (!post.languages || typeof post.languages !== 'object') {
      fail(`${at}: нет блока languages. Ожидается объект с ключами ${LANGS.map((l) => l.code).join(', ')}`);
    }
    for (const lang of LANGS) {
      const L = post.languages[lang.code];
      if (!L) fail(`${at}: в languages нет ключа "${lang.code}"`);
      if (typeof L.published !== 'boolean') fail(`${at} [${lang.code}]: published должно быть true или false`);
      if (!L.published) continue;

      for (const field of ['title', 'cardTitle', 'description', 'excerpt']) {
        if (typeof L[field] !== 'string' || !L[field].trim()) {
          fail(`${at} [${lang.code}]: поле "${field}" отсутствует или пустое, а published: true`);
        }
      }
      if (L.title.length > lang.titleMax) {
        fail(`${at} [${lang.code}]: title длиннее ${lang.titleMax} символов (${L.title.length}) — «${L.title}»`);
      }
      const [dmin, dmax] = lang.descRange;
      if (L.description.length < dmin || L.description.length > dmax) {
        fail(`${at} [${lang.code}]: description должен быть ${dmin}–${dmax} символов, сейчас ${L.description.length}`);
      }
      if (!Number.isInteger(L.readingMinutes) || L.readingMinutes < 1) {
        fail(`${at} [${lang.code}]: readingMinutes должно быть целым числом больше нуля`);
      }

      const file = postFile(lang, slug);
      if (!existsSync(p(file))) {
        fail(`${at} [${lang.code}]: published: true, но файла ${file} нет. Либо создай файл, либо поставь published: false`);
      }

      // posts.json — источник правды: расхождение с файлом ловим здесь,
      // иначе витрина и <head> статьи со временем разъедутся
      const html = read(file);
      const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
      const desc = /<meta name="description" content="([\s\S]*?)">/.exec(html)?.[1];
      if (title !== L.title) {
        fail(`${at} [${lang.code}]: <title> в ${file} не совпадает с posts.json\n    в файле:      «${title}»\n    в posts.json: «${L.title}»`);
      }
      if (desc !== L.description) {
        fail(`${at} [${lang.code}]: meta description в ${file} не совпадает с posts.json\n    в файле:      «${desc}»\n    в posts.json: «${L.description}»`);
      }

      const canonical = /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1];
      const want = postUrl(lang, slug);
      if (!canonical) {
        fail(`${at} [${lang.code}]: в ${file} нет <link rel="canonical">. Добавь после meta description:\n    <link rel="canonical" href="${want}">`);
      }
      if (canonical !== want) {
        fail(`${at} [${lang.code}]: canonical в ${file} — «${canonical}», ожидается «${want}». Каждая языковая версия ссылается на саму себя, не на русскую`);
      }

      const robots = /<meta name="robots" content="([^"]*)">/.exec(html)?.[1] ?? '';
      if (/noindex/i.test(robots)) {
        fail(`${at} [${lang.code}]: в ${file} стоит <meta name="robots" content="${robots}"> — осталось от шаблона. Замени на "index, follow"`);
      }

      const htmlLangAttr = /<html lang="([^"]*)"/.exec(html)?.[1];
      if (htmlLangAttr !== lang.htmlLang) {
        fail(`${at} [${lang.code}]: <html lang="${htmlLangAttr}">, ожидается <html lang="${lang.htmlLang}">`);
      }
      const ogLocale = /<meta property="og:locale" content="([^"]*)">/.exec(html)?.[1];
      if (ogLocale !== lang.locale) {
        fail(`${at} [${lang.code}]: og:locale = "${ogLocale}", ожидается "${lang.locale}"`);
      }
    }

    if (!post.languages[BASE.code].published) {
      fail(`${at}: русская версия должна быть published: true — она базовая для hreflang x-default`);
    }
  }

  // свежие сверху; при равных датах — по слагу, чтобы порядок был воспроизводимым
  posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
  return posts;
}

const publishedIn = (posts, code) => posts.filter((x) => x.languages[code].published);

// ---------- фрагменты разметки ----------

function hreflangBlock(post, indent = '') {
  const rows = LANGS
    .filter((l) => post.languages[l.code].published)
    .map((l) => `${indent}<link rel="alternate" hreflang="${l.code}" href="${postUrl(l, post.slug)}">`);
  rows.push(`${indent}<link rel="alternate" hreflang="x-default" href="${postUrl(BASE, post.slug)}">`);
  return rows.join('\n');
}

function hreflangList(indent = '') {
  const rows = LANGS.map((l) => `${indent}<link rel="alternate" hreflang="${l.code}" href="${listUrl(l)}">`);
  rows.push(`${indent}<link rel="alternate" hreflang="x-default" href="${listUrl(BASE)}">`);
  return rows.join('\n');
}

// Переключатель языков на страницах блога — обычные ссылки, а не только JS.
// Нет перевода этой статьи — ведём на витрину языка, чтобы не было 404.
function langNav(post, current) {
  return LANGS.map((l) => {
    const href = post && post.languages[l.code].published ? `/blog/${l.dir}${post.slug}` : `/blog/${l.dir}`;
    const label = { ru: 'RU', uz: 'UZ', en: 'EN', zh: '中文' }[l.code];
    const active = l.code === current ? ' aria-current="page"' : '';
    return `      <a class="lang-btn" data-lang="${l.code}" href="${href}" hreflang="${l.code}"${active}>${label}</a>`;
  }).join('\n');
}

const cardHtml = (post, lang) => {
  const L = post.languages[lang.code];
  return `        <a class="post-card ${CAT_CLASS[post.category]}" href="/blog/${lang.dir}${post.slug}">
          <div class="cat">${esc(CAT_LABEL[lang.code][post.category])}</div>
          <b>${L.cardTitle}</b>
          <span class="excerpt">${L.excerpt}</span>
          <span class="dates">${dateLocal(post.date, lang.code)} · ${READ_LABEL[lang.code](L.readingMinutes)}</span>
        </a>`;
};

const relCardHtml = (post, lang) => {
  const L = post.languages[lang.code];
  return `        <a class="rel-card" href="/blog/${lang.dir}${post.slug}">
          <div class="cat">${esc(CAT_LABEL[lang.code][post.category])}</div>
          <b>${L.cardTitle}</b>
          <span>${L.excerpt}</span>
        </a>`;
};

// 3 свежие статьи той же категории, добор до 3 самыми свежими из остальных.
// Берём только те, что опубликованы на этом же языке — иначе ссылка уйдёт в 404.
function relatedFor(post, posts, code) {
  const rest = publishedIn(posts, code).filter((x) => x.slug !== post.slug);
  const same = rest.filter((x) => x.category === post.category);
  const other = rest.filter((x) => x.category !== post.category);
  return [...same, ...other].slice(0, 3);
}

function paginationHtml(lang, page, totalPages) {
  if (totalPages < 2) return '';
  const href = (n) => (n === 1 ? `/blog/${lang.dir}` : `/blog/${lang.dir}page/${n}/`);
  const parts = [];
  if (page > 1) parts.push(`        <a class="page-link" rel="prev" href="${href(page - 1)}">←</a>`);
  for (let n = 1; n <= totalPages; n++) {
    parts.push(n === page
      ? `        <span class="page-link is-current" aria-current="page">${n}</span>`
      : `        <a class="page-link" href="${href(n)}">${n}</a>`);
  }
  if (page < totalPages) parts.push(`        <a class="page-link" rel="next" href="${href(page + 1)}">→</a>`);
  // именно div, а не nav: в assets/styles.css селектор nav{} написан по элементу
  return `\n      <div class="pagination" role="navigation">\n${parts.join('\n')}\n      </div>\n      `;
}

const blogJsonLd = (pagePosts, lang, canonical) => `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Blog",
  "name": ${JSON.stringify(RSS_TEXT[lang.code].title)},
  "description": ${JSON.stringify(RSS_TEXT[lang.code].desc)},
  "url": "${canonical}",
  "inLanguage": "${lang.htmlLang}",
  "publisher": {
    "@type": "Organization",
    "name": "BOSCO Beauty Club",
    "url": "${SITE}/",
    "logo": {"@type": "ImageObject", "url": "${SITE}/web-app-manifest-512x512.png"}
  },
  "blogPost": [
${pagePosts.map((x) => `    {"@type": "BlogPosting", "headline": ${JSON.stringify(x.languages[lang.code].cardTitle)}, "url": "${postUrl(lang, x.slug)}", "datePublished": "${x.date}"}`).join(',\n')}
  ]
}
</script>`;

// ---------- сборка ----------

function buildList(posts, lang) {
  const file = listFile(lang);
  if (!existsSync(p(file))) fail(`нет витрины ${file} для языка "${lang.code}" — создай её по образцу blog/index.html`);
  const base = read(file);
  const mine = publishedIn(posts, lang.code);
  const totalPages = Math.max(1, Math.ceil(mine.length / PER_PAGE));

  for (let page = 1; page <= totalPages; page++) {
    const slice = mine.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const canonical = page === 1 ? listUrl(lang) : `${listUrl(lang)}page/${page}/`;

    let out = base;
    out = replaceRegion(out, 'POSTS', slice.length
      ? `\n${slice.map((x) => cardHtml(x, lang)).join('\n\n')}\n        `
      : `\n        <p class="empty-note">${EMPTY_NOTE[lang.code]}</p>\n        `, file);
    out = replaceRegion(out, 'PAGINATION', paginationHtml(lang, page, totalPages), file);
    out = replaceRegion(out, 'BLOGLD', `\n${blogJsonLd(slice, lang, canonical)}\n`, file);
    out = replaceRegion(out, 'HREFLANG', `\n${hreflangList()}\n`, file);
    // витрина без единой статьи в индекс не нужна
    out = replaceRegion(out, 'ROBOTS', mine.length
      ? '\n<meta name="robots" content="index, follow">\n'
      : '\n<meta name="robots" content="noindex, follow">\n', file);
    out = replaceRegion(out, 'LANGNAV', `\n${langNav(null, lang.code)}\n      `, file);

    out = applyLangChrome(out, lang);
    // витрина — это листинг, а не статья
    out = out.replace('<meta property="og:type" content="article">', '<meta property="og:type" content="website">');

    if (page === 1) {
      const t = /<title>([\s\S]*?)<\/title>/.exec(out)?.[1] ?? '';
      const d = /<meta name="description" content="([\s\S]*?)">/.exec(out)?.[1] ?? '';
      const [dmin, dmax] = lang.descRange;
      if (t.length > lang.titleMax) fail(`витрина ${file}: title длиннее ${lang.titleMax} символов (${t.length}) — «${t}»`);
      if (d.length < dmin || d.length > dmax) fail(`витрина ${file}: description должен быть ${dmin}–${dmax} символов, сейчас ${d.length}`);
      write(file, out);
      continue;
    }
    out = out
      .replace(/<title>([\s\S]*?)<\/title>/, (_, t) => `<title>${t} — ${page}</title>`)
      .replace(`<link rel="canonical" href="${listUrl(lang)}">`, `<link rel="canonical" href="${canonical}">`)
      .replace(`<meta property="og:url" content="${listUrl(lang)}">`, `<meta property="og:url" content="${canonical}">`);
    write(`blog/${lang.dir}page/${page}/index.html`, out);
  }

  const pagesDir = p(`blog/${lang.dir}page`);
  if (existsSync(pagesDir)) {
    for (const name of readdirSync(pagesDir)) {
      const n = Number(name);
      if (!Number.isInteger(n) || n < 2 || n > totalPages) {
        rmSync(join(pagesDir, name), { recursive: true, force: true });
        changed.push(`blog/${lang.dir}page/${name} (удалено)`);
      }
    }
    if (readdirSync(pagesDir).length === 0) rmSync(pagesDir, { recursive: true, force: true });
  }
  return mine.length;
}

function buildArticles(posts) {
  for (const post of posts) {
    for (const lang of LANGS) {
      if (!post.languages[lang.code].published) continue;
      const file = postFile(lang, post.slug);
      let html = read(file);
      const rel = relatedFor(post, posts, lang.code);
      html = replaceRegion(html, 'RELATED',
        rel.length ? `\n${rel.map((x) => relCardHtml(x, lang)).join('\n\n')}\n        ` : '\n        ', file);
      html = replaceRegion(html, 'HREFLANG', `\n${hreflangBlock(post)}\n`, file);
      html = replaceRegion(html, 'LANGNAV', `\n${langNav(post, lang.code)}\n      `, file);
      html = applyLangChrome(html, lang);
      write(file, html);
    }
  }
}

function buildSitemap(posts) {
  const urls = [];
  const alternates = (make) => LANGS
    .filter((l) => make.published(l))
    .map((l) => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${make.url(l)}"/>`)
    .concat(`    <xhtml:link rel="alternate" hreflang="x-default" href="${make.url(BASE)}"/>`)
    .join('\n');

  for (const lang of LANGS) {
    if (!publishedIn(posts, lang.code).length) continue;
    urls.push(`  <url>
    <loc>${listUrl(lang)}</loc>
    <lastmod>${posts[0].updated}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority>
${alternates({ published: (l) => publishedIn(posts, l.code).length > 0, url: (l) => listUrl(l) })}
  </url>`);
  }
  for (const post of posts) {
    for (const lang of LANGS) {
      if (!post.languages[lang.code].published) continue;
      urls.push(`  <url>
    <loc>${postUrl(lang, post.slug)}</loc>
    <lastmod>${post.updated}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority>
${alternates({ published: (l) => post.languages[l.code].published, url: (l) => postUrl(l, post.slug) })}
  </url>`);
    }
  }
  for (const lang of LANGS) {
    if (!publishedIn(posts, lang.code).length) continue;
    urls.push(`  <url><loc>${listUrl(lang)}rss.xml</loc><lastmod>${posts[0].updated}</lastmod><changefreq>weekly</changefreq><priority>0.3</priority></url>`);
  }
  write('sitemap.xml', replaceRegion(read('sitemap.xml'), 'BLOG', `\n${urls.join('\n')}\n  `, 'sitemap.xml'));
}

function buildRss(posts) {
  for (const lang of LANGS) {
    const mine = publishedIn(posts, lang.code);
    const file = `blog/${lang.dir}rss.xml`;
    if (!mine.length) {
      if (existsSync(p(file))) { rmSync(p(file)); changed.push(`${file} (удалено)`); }
      continue;
    }
    const items = mine.slice(0, 20).map((post) => {
      const L = post.languages[lang.code];
      return `    <item>
      <title>${esc(L.cardTitle)}</title>
      <link>${postUrl(lang, post.slug)}</link>
      <guid isPermaLink="true">${postUrl(lang, post.slug)}</guid>
      <category>${esc(CAT_LABEL[lang.code][post.category])}</category>
      <pubDate>${rfc822(post.date)}</pubDate>
      <description>${esc(L.description)}</description>
    </item>`;
    }).join('\n');

    write(file, `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(RSS_TEXT[lang.code].title)}</title>
    <link>${listUrl(lang)}</link>
    <atom:link href="${listUrl(lang)}rss.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(RSS_TEXT[lang.code].desc)}</description>
    <language>${lang.code}</language>
    <lastBuildDate>${rfc822(mine[0].updated)}</lastBuildDate>
${items}
  </channel>
</rss>
`);
  }
}

// ---------- main ----------

const posts = loadPosts();
const counts = LANGS.map((l) => `${l.code}: ${buildList(posts, l)}`);
buildArticles(posts);
buildSitemap(posts);
buildRss(posts);

console.log(`Опубликовано статей по языкам — ${counts.join(', ')}`);
console.log(changed.length ? `Обновлено файлов: ${changed.length}\n  ${changed.join('\n  ')}` : 'Изменений нет — всё уже собрано.');
