// nav scroll state
const nav = document.getElementById('nav');
if (nav) {
  window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 40));
}

// mobile menu
const burger = document.getElementById('burger');
const navLinks = document.getElementById('navLinks');
if (burger && navLinks) {
  burger.addEventListener('click', () => navLinks.classList.toggle('open'));
  navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));
}

// language toggle: swap innerHTML of every element carrying data-ru/data-uz, remembered across pages
const LANG_KEY = 'bosco_lang';
const langBtns = document.querySelectorAll('.lang-btn');
const translatable = document.querySelectorAll('[data-ru]');
function setLang(lang){
  translatable.forEach(el => {
    const val = el.getAttribute('data-' + lang) || el.getAttribute('data-ru');
    if (val !== null) el.innerHTML = val;
  });
  document.querySelectorAll('[data-ph-ru]').forEach(el => {
    el.placeholder = el.getAttribute('data-ph-' + lang) || el.getAttribute('data-ph-ru');
  });
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  langBtns.forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  // award badge: Russian artwork for RU, English artwork for every other language
  document.querySelectorAll('.award-badge').forEach(img => {
    img.src = (lang === 'ru') ? '2gis-award-ru.png' : '2gis-award-en.png';
  });
  try { localStorage.setItem(LANG_KEY, lang); } catch(e){}
}
langBtns.forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));
let savedLang = 'ru';
try { savedLang = localStorage.getItem(LANG_KEY) || 'ru'; } catch(e){}
setLang(savedLang);

// services tabs
document.querySelectorAll('.svc-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.svc-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.svc-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`.svc-panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
  });
});

// countdown: deadline persisted in localStorage so a reload doesn't reset it to 60:00
const tM = document.getElementById('tM'), tS = document.getElementById('tS');
if (tM && tS) {
  const DEADLINE_KEY = 'bosco_promo_deadline';
  let deadline = Number(localStorage.getItem(DEADLINE_KEY));
  if (!deadline || Number.isNaN(deadline) || deadline <= Date.now()) {
    deadline = Date.now() + 60 * 60 * 1000;
    try { localStorage.setItem(DEADLINE_KEY, String(deadline)); } catch(e){}
  }
  const pad = n => String(n).padStart(2, '0');
  const tick = () => {
    const diff = deadline - Date.now();
    if (diff <= 0){ tM.textContent = '00'; tS.textContent = '00'; return; }
    const m = Math.floor(diff / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    tM.textContent = pad(m); tS.textContent = pad(s);
  };
  tick();
  setInterval(tick, 1000);
}

// scroll reveal
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// ==== Отслеживание конверсий: клики по записи/Telegram/звонку ====
const YM_COUNTER_ID = 111134513;
function trackConversion(label){
  try { if (typeof ym === 'function') ym(YM_COUNTER_ID, 'reachGoal', label); } catch(e){}
  try { if (typeof gtag === 'function') gtag('event', label, { event_category: 'booking' }); } catch(e){}
}
document.querySelectorAll('.dikidi-widget').forEach(el => el.addEventListener('click', () => trackConversion('booking_click')));
document.querySelectorAll('a[href^="https://t.me/"]').forEach(el => el.addEventListener('click', () => trackConversion('telegram_click')));
document.querySelectorAll('a[href^="tel:"]').forEach(el => el.addEventListener('click', () => trackConversion('phone_click')));

// ---- lead form: submit to Netlify Forms, then fire the ad conversion ----
(function(){
  const form = document.getElementById('leadForm');
  if (!form) return;
  const pageField = document.getElementById('fPage');
  if (pageField) pageField.value = location.pathname;
  const okBox = document.getElementById('fOk');
  const errBox = document.getElementById('fErr');
  const btn = document.getElementById('fSubmit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    btn.disabled = true;
    try {
      const body = new URLSearchParams(new FormData(form)).toString();
      const res = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (!res.ok) throw new Error('bad response');
      form.style.display = 'none';
      okBox.style.display = 'block';
      trackConversion('form_submit');
    } catch (err) {
      errBox.style.display = 'block';
      btn.disabled = false;
    }
  });
})();

// ---- 2GIS widget iframe injector ----
(function(r, u){
  const l = document.getElementById(r);
  if (!l) return;
  l.contentWindow.document.open();
  l.contentWindow.document.write(decodeURIComponent(escape(atob(u))));
  l.contentWindow.document.close();
})("big_light_70000001077188388", "PGhlYWQ+PHNjcmlwdCB0eXBlPSJ0ZXh0L2phdmFzY3JpcHQiPgogICAgd2luZG93Ll9fc2l6ZV9fPSdiaWcnOwogICAgd2luZG93Ll9fdGhlbWVfXz0nbGlnaHQnOwogICAgd2luZG93Ll9fYnJhbmNoSWRfXz0nNzAwMDAwMDEwNzcxODgzODgnCiAgICB3aW5kb3cuX19vcmdJZF9fPSc3MDAwMDAwMTA3NzE4ODM4NycKICAgPC9zY3JpcHQ+PHNjcmlwdCBjcm9zc29yaWdpbj0iYW5vbnltb3VzIiB0eXBlPSJtb2R1bGUiIHNyYz0iaHR0cHM6Ly9kaXNrLjJnaXMuY29tL3dpZGdldC1jb25zdHJ1Y3Rvci9hc3NldHMvaWZyYW1lLmpzIj48L3NjcmlwdD48bGluayByZWw9Im1vZHVsZXByZWxvYWQiIGNyb3Nzb3JpZ2luPSJhbm9ueW1vdXMiIGhyZWY9Imh0dHBzOi8vZGlzay4yZ2lzLmNvbS93aWRnZXQtY29uc3RydWN0b3IvYXNzZXRzL2RlZmF1bHRzLmpzIj48bGluayByZWw9InN0eWxlc2hlZXQiIGNyb3Nzb3JpZ2luPSJhbm9ueW1vdXMiIGhyZWY9Imh0dHBzOi8vZGlzay4yZ2lzLmNvbS93aWRnZXQtY29uc3RydWN0b3IvYXNzZXRzL2RlZmF1bHRzLmNzcyI+PC9oZWFkPjxib2R5PjxkaXYgaWQ9ImlmcmFtZSI+PC9kaXY+PC9ib2R5Pg==");
