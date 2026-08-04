#!/usr/bin/env node
// Разовый скаффолдер языковой версии статьи.
// Запуск: node tools/new-article.mjs <lang> <slug> <файл-с-телом>
//
// Тело — фрагмент от <header class="blog-hero"> до </article>: только содержание статьи,
// без <head>, шапки сайта и футера. Всё остальное скрипт берёт из blog/_template.html
// и blog/posts.json, поэтому canonical, og:url, @id, html lang и og:locale не могут
// разъехаться между языками — их подставляет один и тот же код.
//
// FAQPage собирается из видимого текста тела, так что разметка и микроразметка
// совпадают дословно по построению, а не по внимательности автора.
//
// Скрипт не запускается при сборке: создал файл — дальше работает tools/build-blog.mjs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://boscobeauty.uz';
const p = (...a) => join(ROOT, ...a);

const LANGS = {
  ru: { dir: '',    htmlLang: 'ru',    locale: 'ru_RU', inLang: 'ru' },
  uz: { dir: 'uz/', htmlLang: 'uz',    locale: 'uz_UZ', inLang: 'uz' },
  en: { dir: 'en/', htmlLang: 'en',    locale: 'en_US', inLang: 'en' },
  zh: { dir: 'zh/', htmlLang: 'zh-CN', locale: 'zh_CN', inLang: 'zh-CN' },
};
const UI = {
  ru: { home: 'Главная', blog: 'Блог', rss: 'Блог BOSCO Beauty Club' },
  uz: { home: 'Bosh sahifa', blog: 'Blog', rss: 'BOSCO Beauty Club blogi' },
  en: { home: 'Home', blog: 'Blog', rss: 'BOSCO Beauty Club blog' },
  zh: { home: '首页', blog: '博客', rss: 'BOSCO Beauty Club 博客' },
};

const die = (m) => { console.error(`\n  ${m}\n`); process.exit(1); };

const [, , code, slug, bodyPath] = process.argv;
if (!code || !slug || !bodyPath) die('Использование: node tools/new-article.mjs <lang> <slug> <файл-с-телом>');
const lang = LANGS[code];
if (!lang) die(`Неизвестный язык "${code}". Доступны: ${Object.keys(LANGS).join(', ')}`);
if (!existsSync(bodyPath)) die(`Нет файла с телом статьи: ${bodyPath}`);

const posts = JSON.parse(readFileSync(p('blog/posts.json'), 'utf8'));
const post = posts.find((x) => x.slug === slug);
if (!post) die(`В blog/posts.json нет статьи со slug "${slug}"`);
const L = post.languages?.[code];
if (!L) die(`В blog/posts.json у "${slug}" нет блока languages.${code}`);
for (const f of ['title', 'cardTitle', 'description']) {
  if (!L[f]) die(`В blog/posts.json у "${slug}" [${code}] не заполнено поле "${f}"`);
}

const body = readFileSync(bodyPath, 'utf8').trim();
const url = `${SITE}/blog/${lang.dir}${slug}`;
const crumb = L.crumb || L.cardTitle.split(/[:—]/)[0].trim();
const ogDesc = L.ogDescription || L.description;

// FAQPage — строго из видимого текста, иначе микроразметка разойдётся с версткой
const strip = (t) => t.replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const qs = [...body.matchAll(/<summary><h3>([\s\S]*?)<\/h3><\/summary>/g)].map((m) => strip(m[1]));
const as = [...body.matchAll(/<div class="answer"><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => strip(m[1]));
if (!qs.length) die('В теле статьи не найден ни один блок FAQ (<summary><h3>…)');
if (qs.length !== as.length) die(`В FAQ ${qs.length} вопросов и ${as.length} ответов — должно совпадать`);
const faqLd = qs.map((q, i) =>
  `    {"@type": "Question", "name": ${JSON.stringify(q)}, "acceptedAnswer": {"@type": "Answer", "text": ${JSON.stringify(as[i])}}}`
).join(',\n');

let out = readFileSync(p('blog/_template.html'), 'utf8');
out = out.replace(/^<!DOCTYPE html>\n<!--[\s\S]*?-->\n/, '<!DOCTYPE html>\n');   // шапка-инструкция только в шаблоне

const map = {
  '{{LANG}}': lang.htmlLang,
  '{{OG_LOCALE}}': lang.locale,
  '{{IN_LANGUAGE}}': lang.inLang,
  '{{TITLE}}': L.title,
  '{{DESCRIPTION}}': L.description,
  '{{CANONICAL}}': url,
  '{{H1}}': L.cardTitle,
  '{{CRUMB}}': crumb,
  '{{OG_TITLE}}': L.cardTitle,
  '{{OG_DESCRIPTION}}': ogDesc,
  '{{OG_IMAGE}}': post.ogImage,
  '{{DATE}}': post.date,
  '{{UPDATED}}': post.updated,
  '{{RSS_TITLE}}': UI[code].rss,
  '{{RSS_URL}}': `${SITE}/blog/${lang.dir}rss.xml`,
  '{{BLOG_URL}}': `${SITE}/blog/${lang.dir}`,
  '{{HOME_LABEL}}': UI[code].home,
  '{{BLOG_LABEL}}': UI[code].blog,
  '{{FAQ_JSONLD}}': faqLd,
  '{{BODY}}': body,
};
for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);

out = out.replace('<meta name="robots" content="noindex, nofollow">', '<meta name="robots" content="index, follow">');

const left = out.match(/\{\{[A-Z_]+\}\}/g);
if (left) die(`В шаблоне остались незаполненные плейсхолдеры: ${[...new Set(left)].join(', ')}`);

const file = `blog/${lang.dir}${slug}.html`;
mkdirSync(dirname(p(file)), { recursive: true });
writeFileSync(p(file), out);
console.log(`  ${file} — ${out.length} байт, FAQ ${qs.length} шт., canonical ${url}`);
console.log('  дальше: node tools/build-blog.mjs');
