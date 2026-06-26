// ==UserScript==
// @name         Gazeta.pl — czysta lista artykułów
// @namespace    https://github.com/tunguski/gazeta-tampermonkey
// @version      1.0.0
// @description  Wyłącza JavaScript oryginalnej strony gazeta.pl (CSP), usuwa obrazy, ramki i reklamy. Na stronach z listą pokazuje prostą listę artykułów; na stronie artykułu pokazuje samą treść w minimalistycznym stylu.
// @author       tunguski
// @match        *://*.gazeta.pl/*
// @match        *://www.sport.pl/*
// @match        *://moto.pl/*
// @match        *://www.plotek.pl/*
// @match        *://avanti24.pl/*
// @match        *://czterykaty.pl/*
// @match        *://haps.pl/*
// @match        *://www.edziecko.pl/*
// @run-at       document-start
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

/*
 * Jak to działa:
 *
 *   1. document-start: wstrzykujemy <meta CSP> "script-src 'none'; img-src 'none';
 *      frame-src 'none'; ..." => JS strony, obrazy i iframe są martwe. Serwerowy
 *      HTML i tak się parsuje, więc linki do artykułów mamy w DOM-ie.
 *   2. Po sparsowaniu zbieramy linki, a potem FIZYCZNIE usuwamy wszystkie media
 *      i CAŁĄ pierwotną zawartość <body>, po czym renderujemy własną listę
 *      bezpośrednio w <body>. Style ustawiamy inline na elementach, więc nie
 *      zależymy od żadnego arkusza CSS strony.
 *
 * Skoro JS strony jest wyłączony, DOM się nie odbudowuje — jeden przebieg
 * wystarcza (kilka powtórek tylko dla pewności).
 *
 * UWAGA: po edycji pliku trzeba wkleić nową wersję do edytora Tampermonkey
 * i zapisać — edycja pliku na dysku nie aktualizuje skryptu w przeglądarce.
 */

(function () {
  'use strict';

  // === 1. Wyłącz JS / obrazy / ramki oryginalnej strony (zanim ruszą skrypty) ===
  try {
    const root = document.documentElement;
    let head = document.head;
    if (!head) { head = document.createElement('head'); root.insertBefore(head, root.firstChild); }
    const csp = document.createElement('meta');
    csp.setAttribute('http-equiv', 'Content-Security-Policy');
    csp.setAttribute('content', [
      "script-src 'none'", "frame-src 'none'", "img-src 'none'",
      "media-src 'none'", "object-src 'none'", "worker-src 'none'",
    ].join('; '));
    head.insertBefore(csp, head.firstChild);
  } catch (e) {
    console.error('[gazeta-reader] CSP error:', e);
  }
  console.info('[gazeta-reader] v1.0.0 aktywny — tryb:',
    /,\d+,\d{4,},[^/]*\.html(\?|#|$)/i.test(location.pathname) && !/\/0,0?\.html/.test(location.pathname)
      ? 'artykuł' : 'lista');

  // ---------------------------------------------------------------------------
  // Drobne narzędzia
  // ---------------------------------------------------------------------------
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k === 'href') node.setAttribute('href', v);
      else node.setAttribute(k, v);
    }
    for (const child of children.flat()) {
      if (child == null) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------------------
  // Rozpoznawanie linków do artykułów
  // ---------------------------------------------------------------------------
  const ARTICLE_RE = /,\d+,\d{4,},[^/]*\.html(\?|#|$)/i;

  const AD_HOST_TOKENS = [
    'doubleclick', 'googlesyndication', 'googleadservices', 'adservice',
    'taboola', 'outbrain', 'criteo', 'adform', 'gemius', 'smartadserver',
    'rubiconproject', 'pubmatic', 'openx', 'amazon-adsystem', 'teads',
    'tradedoubler', 'awin', 'ceneo',
  ];

  const isArticleHref = (href) => {
    if (!href) return false;
    if (href.startsWith('#') || href.startsWith('javascript:')) return false;
    if (/\/0,0?\.html/.test(href)) return false;
    const low = href.toLowerCase();
    if (AD_HOST_TOKENS.some((t) => low.includes(t))) return false;
    return ARTICLE_RE.test(href);
  };

  // Czy BIEŻĄCY adres to strona artykułu (a nie lista / front sekcji)?
  const isArticlePage = () =>
    ARTICLE_RE.test(location.pathname) && !/\/0,0?\.html/.test(location.pathname);

  const SECTION_NAMES = {
    'wiadomosci': 'Wiadomości', 'next': 'Biznes (Next)', 'sport': 'Sport',
    'plotek': 'Plotek', 'weekend': 'Weekend', 'kobieta': 'Kobieta',
    'avanti24': 'Moda (Avanti)', 'wyborcza': 'Wyborcza',
    'wysokieobcasy': 'Wysokie Obcasy', 'moto': 'Moto',
    'czterykaty': 'Cztery Kąty', 'haps': 'Haps (Jedzenie)',
    'edziecko': 'eDziecko', 'kultura': 'Kultura', 'podroze': 'Podróże',
    'horoskopy': 'Horoskopy', 'pogoda': 'Pogoda', 'buzz': 'Buzz',
    'metrowarszawa': 'Metro Warszawa', 'tokfm': 'TOK FM',
  };

  const sectionFor = (url) => {
    let u;
    try { u = new URL(url, location.href); } catch { return 'Inne'; }
    const host = u.hostname.replace(/^www\./, '');
    const key = host.split('.')[0];
    if (SECTION_NAMES[key]) return SECTION_NAMES[key];
    if (key && key !== 'gazeta') return key.charAt(0).toUpperCase() + key.slice(1);
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    if (SECTION_NAMES[seg]) return SECTION_NAMES[seg];
    return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : 'Gazeta.pl';
  };

  // Całe sekcje (po pierwszym członie hosta) do pominięcia.
  // Avanti = w większości reklamy; Horoskopy i Wysokie Obcasy — na życzenie.
  const BLOCKED_SECTION_KEYS = new Set(['avanti24', 'horoskopy', 'wysokieobcasy']);

  // Etykiety linków do pominięcia:
  //   SUBSKRYPCJA        -> treść za paywallem
  //   MATERIAŁ PROMOCYJNY -> reklama
  // Etykieta siedzi w kafelku WEWNĄTRZ <a>, więc trafia do tekstu linku.
  const PROMO_RE = /SUBSKRYPCJA|MATERIAL PROMOCYJNY/;
  const flatten = (s) => (s || '').toUpperCase().replace(/Ł/g, 'L');

  // ---------------------------------------------------------------------------
  // Zbieranie artykułów (akumulacja, dedup po URL)
  // ---------------------------------------------------------------------------
  const seen = new Set();
  const bySection = new Map();
  let totalCount = 0;

  const collectArticles = () => {
    let added = 0;
    for (const a of document.querySelectorAll('a[href]')) {
      if (a.closest && a.closest('#gz-root')) continue; // pomiń naszą własną listę
      const href = a.href;
      if (!isArticleHref(href)) continue;

      let u;
      try { u = new URL(href); } catch { continue; }

      // pomiń całe zablokowane sekcje
      const key = u.hostname.replace(/^www\./, '').split('.')[0];
      if (BLOCKED_SECTION_KEYS.has(key)) continue;

      // pomiń płatne (SUBSKRYPCJA) i reklamowe (MATERIAŁ PROMOCYJNY)
      const titleAttr = a.getAttribute('title') || '';
      if (PROMO_RE.test(flatten(a.textContent + ' ' + titleAttr))) continue;

      // tytuł: preferuj atrybut title (czysty nagłówek), w razie czego tekst linku
      let title = norm(titleAttr);
      if (title.length < 12) title = norm(a.textContent);
      if (title.length < 12) title = norm(a.getAttribute('aria-label') || title);
      if (title.length < 12) continue;

      const dedupKey = u.origin + u.pathname;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const section = sectionFor(href);
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push({ title, href });
      added++; totalCount++;
    }
    return added;
  };

  // ---------------------------------------------------------------------------
  // Style inline (nie zależymy od arkuszy strony)
  // ---------------------------------------------------------------------------
  const S = {
    body: 'margin:0;padding:0;background:#fafafa;',
    root: 'max-width:760px;margin:0 auto;padding:24px 16px 64px;'
        + 'font-family:-apple-system,system-ui,"Segoe UI",Roboto,Arial,sans-serif;'
        + 'color:#1a1a1a;line-height:1.5;',
    h1: 'font-size:24px;margin:0 0 4px;color:#c00;',
    head: 'border-bottom:2px solid #c00;padding-bottom:12px;margin-bottom:8px;',
    sub: 'margin:0;font-size:13px;color:#666;',
    section: 'margin-top:28px;',
    secTitle: 'font-size:18px;margin:0 0 8px;padding-bottom:4px;border-bottom:1px solid #ddd;color:#222;',
    count: 'font-weight:normal;color:#999;font-size:14px;',
    list: 'list-style:none;margin:0;padding:0;',
    item: 'padding:6px 0;border-bottom:1px solid #eee;',
    link: 'color:#14396b;text-decoration:none;font-size:16px;display:block;',
    // strona artykułu
    back: 'display:inline-block;margin:0 0 16px;font-size:13px;color:#c00;text-decoration:none;',
    artTitle: 'font-size:28px;line-height:1.25;margin:0 0 10px;color:#111;',
    meta: 'margin:0 0 20px;font-size:13px;color:#888;',
    lead: 'font-size:18px;font-weight:600;line-height:1.5;margin:0 0 20px;color:#111;',
    para: 'margin:0 0 16px;font-size:17px;line-height:1.65;color:#1a1a1a;',
    subtitle: 'font-size:20px;line-height:1.3;margin:26px 0 10px;color:#111;',
  };

  // ---------------------------------------------------------------------------
  // Przebudowa: usuń media + całą treść, narysuj listę wprost w <body>
  // ---------------------------------------------------------------------------
  const ROOT_ID = 'gz-root';

  const buildRoot = () => {
    const root = el('div', { id: ROOT_ID, style: S.root });
    const sub = el('p', { class: 'gz-sub', style: S.sub });
    root.append(
      el('header', { style: S.head },
        el('h1', { style: S.h1, text: 'Gazeta.pl — lista artykułów' }),
        sub,
      ),
    );

    const sections = Array.from(bySection.entries())
      .filter(([, items]) => items.length)
      .sort((a, b) => b[1].length - a[1].length);

    sub.textContent = totalCount
      ? `Znaleziono ${totalCount} artykułów w ${sections.length} sekcjach. JavaScript, obrazy, ramki i reklamy usunięte.`
      : 'Nie znaleziono artykułów na tej stronie.';

    for (const [name, items] of sections) {
      const sec = el('section', { style: S.section });
      sec.append(el('h2', { style: S.secTitle },
        name, el('span', { style: S.count, text: ` (${items.length})` }),
      ));
      const list = el('ul', { style: S.list });
      for (const it of items) {
        list.append(el('li', { style: S.item },
          el('a', { style: S.link, href: it.href, text: it.title }),
        ));
      }
      sec.append(list);
      root.append(sec);
    }
    return root;
  };

  // ---------------------------------------------------------------------------
  // Strona artykułu — sama treść, bez listy powiązanych
  // ---------------------------------------------------------------------------
  // Przodkowie, których treść NIE jest właściwym artykułem (do trybu zapasowego).
  const JUNK_ANCESTOR = [
    '#' + ROOT_ID, '.relatedBox', '.art_embed',
    '[class*="related" i]', '[class*="recommend" i]', '[class*="newsletter" i]',
    '[class*="embed" i]', '[class*="social" i]', '[class*="comment" i]',
    '[class*="footer" i]', '[class*="header" i]', 'nav', '[class*="menu" i]',
    '[class*="advert" i]', '[class*="-ad" i]', '[class*="ad-" i]', '[class*="banner" i]',
  ].join(', ');

  const pickBody = () =>
    document.querySelector('#gazeta_article_body') ||
    document.querySelector('.art_content') ||
    document.querySelector('[itemprop="articleBody"]') ||
    document.querySelector('#article_wrapper') ||
    document.body;

  const buildArticle = () => {
    const root = el('div', { id: ROOT_ID, style: S.root });

    root.append(el('a', { style: S.back,
      href: 'https://www.gazeta.pl/0,0.html', text: '‹ Gazeta.pl — lista artykułów' }));

    const titleEl = document.querySelector('#article_title') || document.querySelector('h1');
    root.append(el('h1', { style: S.artTitle,
      text: norm(titleEl && titleEl.textContent) || norm(document.title) || 'Artykuł' }));

    const authorEl = document.querySelector('.article_author');
    const dateEl = document.querySelector('.article_date');
    const meta = [norm(authorEl && authorEl.textContent), norm(dateEl && dateEl.textContent)]
      .filter(Boolean).join(' • ');
    if (meta) root.append(el('p', { style: S.meta, text: meta }));

    const leadText = norm((document.querySelector('#gazeta_article_lead') || {}).textContent);
    if (leadText) root.append(el('p', { style: S.lead, text: leadText }));

    const body = pickBody();
    // 1) preferowane: dokładny tekst artykułu gazeta.pl
    const specific = body.querySelectorAll('p.art_paragraph, h2.art_sub_title, h3.art_sub_title');
    const usingSpecific = specific.length > 0;
    // 2) zapas: dowolne akapity/śródtytuły (dla nietypowych szablonów)
    const nodes = usingSpecific
      ? specific
      : body.querySelectorAll('p, h2, h3, h4, blockquote, li');

    let count = 0;
    for (const n of nodes) {
      if (n.closest(JUNK_ANCESTOR)) continue;
      const t = norm(n.textContent);
      if (!t || /^reklama$/i.test(t)) continue;
      const isHead = /^h[2-4]$/i.test(n.tagName);
      // w trybie zapasowym odrzucamy krótkie „śmieci" (menu, podpisy itp.)
      if (!usingSpecific && !isHead && t.length < 25) continue;
      root.append(el(isHead ? 'h2' : 'p', { style: isHead ? S.subtitle : S.para, text: t }));
      count++;
    }

    if (!count && !leadText) {
      root.append(el('p', { style: S.para,
        text: 'Nie udało się wyodrębnić treści artykułu z tej strony.' }));
    }
    return root;
  };

  // ---------------------------------------------------------------------------
  // Przebudowa
  // ---------------------------------------------------------------------------
  let articleDone = false; // na stronie artykułu renderujemy raz (źródło znika po czyszczeniu)

  const rebuild = () => {
    if (!document.body) return;

    const articleMode = isArticlePage();
    if (articleMode && articleDone) return; // już narysowane

    let root;
    if (articleMode) {
      root = buildArticle();
      articleDone = true;
    } else {
      collectArticles();
      root = buildRoot();
    }

    // usuń wszelkie media z całego dokumentu
    document.querySelectorAll('img, picture, source, iframe, video, audio, embed, object, svg, canvas')
      .forEach((n) => n.remove());

    // wyczyść <body> ze wszystkiego i wstaw nasz widok
    document.body.replaceChildren(root);
    document.body.setAttribute('style', S.body);
    document.body.className = '';
    document.documentElement.style.background = '#fafafa';
    if (!articleMode) document.title = 'Gazeta.pl — lista artykułów';
  };

  // ---------------------------------------------------------------------------
  // Start (JS strony jest martwy, więc DOM jest stabilny — kilka przebiegów wystarczy)
  // ---------------------------------------------------------------------------
  const run = () => { try { rebuild(); } catch (e) { console.error('[gazeta-reader]', e); } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  window.addEventListener('load', run, { once: true });
  // dwa dodatkowe przebiegi na wypadek, gdyby część HTML dochodziła z opóźnieniem
  setTimeout(run, 800);
  setTimeout(run, 2000);
})();
