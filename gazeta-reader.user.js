// ==UserScript==
// @name         Gazeta.pl — czysta lista artykułów
// @namespace    https://github.com/tunguski/gazeta-tampermonkey
// @version      1.5.1
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
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      gazeta.pl
// @connect      sport.pl
// @connect      moto.pl
// @connect      plotek.pl
// @connect      czterykaty.pl
// @connect      haps.pl
// @connect      edziecko.pl
// @connect      tokfm.pl
// @noframes
// ==/UserScript==

/*
 * Jak to działa:
 *
 *   1. document-start: wstrzykujemy <meta CSP> "script-src 'none';
 *      img-src 'none'; frame-src 'none'; ..." => JS strony, obrazy i iframe
 *      są martwe. Serwerowy HTML i tak się parsuje, więc linki do artykułów
 *      mamy w DOM-ie.
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

  // === 1. Wyłącz JS / obrazy / ramki oryginalnej strony (zanim ruszą skrypty)
  try {
    const root = document.documentElement;
    let head = document.head;
    if (!head) {
      head = document.createElement('head');
      root.insertBefore(head, root.firstChild);
    }
    const csp = document.createElement('meta');
    csp.setAttribute('http-equiv', 'Content-Security-Policy');
    csp.setAttribute(
      'content',
      [
        "script-src 'none'",
        "frame-src 'none'",
        "img-src 'none'",
        "media-src 'none'",
        "object-src 'none'",
        "worker-src 'none'",
      ].join('; '),
    );
    head.insertBefore(csp, head.firstChild);
  } catch (e) {
    console.error('[gazeta-reader] CSP error:', e);
  }
  console.info(
    '[gazeta-reader] v1.5.1 aktywny — tryb:',
    /,\d+,\d{4,},[^/]*\.html(\?|#|$)/i.test(location.pathname) &&
      !/\/0,0?\.html/.test(location.pathname)
      ? 'artykuł'
      : 'lista',
  );

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
      node.append(
        child.nodeType ? child : document.createTextNode(String(child)),
      );
    }
    return node;
  };

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------------------
  // Rozpoznawanie linków do artykułów
  // ---------------------------------------------------------------------------
  const ARTICLE_RE = /,\d+,\d{4,},[^/]*\.html(\?|#|$)/i;

  const AD_HOST_TOKENS = [
    'doubleclick',
    'googlesyndication',
    'googleadservices',
    'adservice',
    'taboola',
    'outbrain',
    'criteo',
    'adform',
    'gemius',
    'smartadserver',
    'rubiconproject',
    'pubmatic',
    'openx',
    'amazon-adsystem',
    'teads',
    'tradedoubler',
    'awin',
    'ceneo',
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
    ARTICLE_RE.test(location.pathname) &&
    !/\/0,0?\.html/.test(location.pathname);

  const SECTION_NAMES = {
    wiadomosci: 'Wiadomości',
    next: 'Biznes (Next)',
    sport: 'Sport',
    plotek: 'Plotek',
    weekend: 'Weekend',
    kobieta: 'Kobieta',
    avanti24: 'Moda (Avanti)',
    wysokieobcasy: 'Wysokie Obcasy',
    moto: 'Moto',
    czterykaty: 'Cztery Kąty',
    haps: 'Haps (Jedzenie)',
    edziecko: 'eDziecko',
    kultura: 'Kultura',
    podroze: 'Podróże',
    horoskopy: 'Horoskopy',
    pogoda: 'Pogoda',
    buzz: 'Buzz',
    metrowarszawa: 'Metro Warszawa',
    tokfm: 'TOK FM',
  };

  const sectionFor = (url) => {
    let u;
    try {
      u = new URL(url, location.href);
    } catch {
      return 'Inne';
    }
    const host = u.hostname.replace(/^www\./, '');
    const key = host.split('.')[0];
    if (SECTION_NAMES[key]) return SECTION_NAMES[key];
    if (key && key !== 'gazeta')
      return key.charAt(0).toUpperCase() + key.slice(1);
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    if (SECTION_NAMES[seg]) return SECTION_NAMES[seg];
    return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : 'Gazeta.pl';
  };

  // Całe sekcje (po pierwszym członie hosta) do pominięcia.
  // Avanti = w większości reklamy; Wyborcza = płatna; Horoskopy i Wysokie
  // Obcasy — na życzenie.
  const BLOCKED_SECTION_KEYS = new Set([
    'avanti24',
    'horoskopy',
    'wysokieobcasy',
    'wyborcza',
  ]);

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
  // sekcje zwinięte (po nazwie) — trzymane poza DOM-em, żeby przetrwały
  // ponowne rendery (timery, przełączenie motywu)
  const collapsed = new Set();
  // sekcje, którym nadaliśmy już domyślny stan zwinięcia (raz na sekcję)
  const collapseInit = new Set();

  // ---------------------------------------------------------------------------
  // Daty publikacji: mapa „klucz linku (origin+pathname) -> data (ms)" lub
  // 'unknown' (gdy w HTML nie znaleziono daty). Trzymana w GM wspólnie dla
  // domen grupy, więc artykuł datujemy tylko raz. Linki starsze niż rok
  // znikają z listy (a puste sekcje są pomijane).
  // ---------------------------------------------------------------------------
  const PUBDATES_KEY = 'gz-pubdates';
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  const loadPubDates = () => {
    try {
      const v = GM_getValue(PUBDATES_KEY, {});
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  };
  const pubDates = loadPubDates();

  let savePubTimer = null;
  const savePubDates = () => {
    try {
      GM_setValue(PUBDATES_KEY, pubDates);
    } catch (e) {
      console.error('[gazeta-reader] zapis dat:', e);
    }
  };
  const persistPubSoon = () => {
    if (savePubTimer) return;
    savePubTimer = setTimeout(() => {
      savePubTimer = null;
      savePubDates();
    }, 1000);
  };

  // nieznana data => link zostaje (filtrujemy tylko potwierdzone „starsze")
  const isOldLink = (key) => {
    const v = pubDates[key];
    return typeof v === 'number' && Date.now() - v > ONE_YEAR_MS;
  };

  const collectArticles = () => {
    let added = 0;
    for (const a of document.querySelectorAll('a[href]')) {
      // pomiń naszą własną listę
      if (a.closest && a.closest('#gz-root')) continue;
      const href = a.href;
      if (!isArticleHref(href)) continue;

      let u;
      try {
        u = new URL(href);
      } catch {
        continue;
      }

      // pomiń całe zablokowane sekcje
      const key = u.hostname.replace(/^www\./, '').split('.')[0];
      if (BLOCKED_SECTION_KEYS.has(key)) continue;

      // pomiń płatne (SUBSKRYPCJA) i reklamowe (MATERIAŁ PROMOCYJNY)
      const titleAttr = a.getAttribute('title') || '';
      if (PROMO_RE.test(flatten(a.textContent + ' ' + titleAttr))) continue;

      // tytuł: preferuj atrybut title (czysty nagłówek), w razie czego
      // tekst linku
      let title = norm(titleAttr);
      if (title.length < 12) title = norm(a.textContent);
      if (title.length < 12)
        title = norm(a.getAttribute('aria-label') || title);
      if (title.length < 12) continue;

      const dedupKey = u.origin + u.pathname;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const section = sectionFor(href);
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push({ title, href, key: dedupKey });
      added++;
    }
    return added;
  };

  // ---------------------------------------------------------------------------
  // Motyw kolorów + zapamiętany wybór (ciepłe „nocne" tło)
  // ---------------------------------------------------------------------------
  // Dwie palety: jasna (domyślna) i ciepła/sepiowa — mniej niebieskiego
  // światła, łagodniejsza dla oczu (na wzór Night light w Windows).
  const PALETTES = {
    light: {
      bg: '#fafafa',
      text: '#1a1a1a',
      title: '#111',
      secTitle: '#222',
      accent: '#c00',
      link: '#14396b',
      sub: '#666',
      meta: '#888',
      count: '#999',
      rule: '#ddd',
      itemRule: '#eee',
      btnBg: '#fff',
    },
    warm: {
      bg: '#f4ecd8',
      text: '#2b2618',
      title: '#241d10',
      secTitle: '#2a2417',
      accent: '#a33',
      link: '#8a4b1f',
      sub: '#7a6f57',
      meta: '#8a7e63',
      count: '#a89c80',
      rule: '#ddcca8',
      itemRule: '#e7dcc2',
      btnBg: '#ece0c4',
    },
  };

  // GM_*Value trzyma ustawienie wspólnie dla WSZYSTKICH serwisów grupy
  // (gazeta.pl, sport.pl, ...), inaczej niż per-domenowy localStorage.
  const THEME_KEY = 'gz-theme';
  const loadTheme = () => {
    try {
      return GM_getValue(THEME_KEY) === 'warm' ? 'warm' : 'light';
    } catch {
      return 'light';
    }
  };
  const saveTheme = (t) => {
    try {
      GM_setValue(THEME_KEY, t);
    } catch (e) {
      console.error('[gazeta-reader] zapis motywu:', e);
    }
  };

  let theme = loadTheme();

  // ---------------------------------------------------------------------------
  // Style inline (nie zależymy od arkuszy strony)
  // ---------------------------------------------------------------------------
  const makeStyles = (p) => ({
    body: `margin:0;padding:0;background:${p.bg};`,
    root:
      'max-width:760px;margin:0 auto;padding:24px 16px 64px;' +
      'font-family:-apple-system,system-ui,"Segoe UI",Roboto,Arial,' +
      `sans-serif;color:${p.text};line-height:1.5;`,
    h1: `font-size:24px;margin:0 0 4px;color:${p.accent};`,
    head:
      `border-bottom:2px solid ${p.accent};padding-bottom:12px;` +
      'margin-bottom:8px;',
    sub: `margin:0;font-size:13px;color:${p.sub};`,
    section: 'margin-top:28px;',
    secTitle:
      'font-size:18px;margin:0 0 8px;padding-bottom:4px;' +
      'cursor:pointer;user-select:none;' +
      `border-bottom:1px solid ${p.rule};color:${p.secTitle};`,
    caret:
      'display:inline-block;width:0.9em;margin-right:4px;' +
      `font-size:0.8em;color:${p.count};`,
    count: `font-weight:normal;color:${p.count};font-size:14px;`,
    list: 'list-style:none;margin:0;padding:0;',
    item: `padding:6px 0;border-bottom:1px solid ${p.itemRule};`,
    link: `color:${p.link};text-decoration:none;font-size:16px;display:block;`,
    // strona artykułu
    back:
      `display:inline-block;margin:0 0 16px;font-size:13px;color:${p.accent};` +
      'text-decoration:none;',
    artTitle:
      'font-size:28px;line-height:1.25;margin:0 0 10px;' + `color:${p.title};`,
    meta: `margin:0 0 20px;font-size:13px;color:${p.meta};`,
    lead:
      'font-size:18px;font-weight:600;line-height:1.5;margin:0 0 20px;' +
      `color:${p.title};`,
    para: `margin:0 0 16px;font-size:17px;line-height:1.65;color:${p.text};`,
    subtitle:
      'font-size:20px;line-height:1.3;margin:26px 0 10px;' +
      `color:${p.title};`,
    // pasek przełącznika motywu — w treści, wyrównany do prawej
    toggleBar: 'text-align:right;margin:0 0 4px;',
    // przełącznik motywu — sama ikona, w normalnym przepływie strony
    toggle:
      'position:relative;width:36px;height:36px;padding:0;font-size:18px;' +
      'line-height:1;display:inline-flex;align-items:center;' +
      `justify-content:center;cursor:pointer;color:${p.text};` +
      `background:${p.btnBg};border:1px solid ${p.rule};border-radius:50%;` +
      'box-shadow:0 1px 3px rgba(0,0,0,.18);',
  });

  let S = makeStyles(PALETTES[theme]);

  // ---------------------------------------------------------------------------
  // Przebudowa: usuń media + całą treść, narysuj listę wprost w <body>
  // ---------------------------------------------------------------------------
  const ROOT_ID = 'gz-root';

  // Kolejność sekcji: najpierw te „główne" (w tej kolejności), potem reszta
  // wg liczby artykułów. Domyślnie rozwinięta tylko „Wiadomości".
  const SECTION_ORDER = [
    'Wiadomości',
    'Biznes (Next)',
    'Sport',
    'Moto',
    'Kultura',
  ];
  const DEFAULT_OPEN_SECTION = 'Wiadomości';
  const sectionRank = (name) => {
    const i = SECTION_ORDER.indexOf(name);
    return i === -1 ? SECTION_ORDER.length : i;
  };

  const buildRoot = () => {
    const root = el('div', { id: ROOT_ID, style: S.root });
    const sub = el('p', { class: 'gz-sub', style: S.sub });
    root.append(
      el(
        'header',
        { style: S.head },
        el('h1', { style: S.h1, text: 'Gazeta.pl — lista artykułów' }),
        sub,
      ),
    );

    // odfiltruj linki starsze niż rok; sekcje bez linków pomijamy
    const sections = Array.from(bySection.entries())
      .map(([name, items]) => [name, items.filter((it) => !isOldLink(it.key))])
      .filter(([, items]) => items.length)
      .sort((a, b) => {
        const ra = sectionRank(a[0]);
        const rb = sectionRank(b[0]);
        if (ra !== rb) return ra - rb;
        return b[1].length - a[1].length;
      });

    const visibleCount = sections.reduce((n, [, items]) => n + items.length, 0);
    sub.textContent = visibleCount
      ? `Znaleziono ${visibleCount} artykułów w ${sections.length} ` +
        'sekcjach. JavaScript, obrazy, ramki i reklamy usunięte.'
      : 'Nie znaleziono artykułów na tej stronie.';

    for (const [name, items] of sections) {
      // przy pierwszym pokazaniu sekcji: zwiń wszystko poza „Wiadomości"
      if (!collapseInit.has(name)) {
        collapseInit.add(name);
        if (name !== DEFAULT_OPEN_SECTION) collapsed.add(name);
      }

      const sec = el('section', { style: S.section });

      const isCollapsed = collapsed.has(name);
      const caret = el('span', {
        style: S.caret,
        text: isCollapsed ? '▸' : '▾',
      });

      const list = el('ul', {
        style: S.list + (isCollapsed ? 'display:none;' : ''),
      });
      for (const it of items) {
        list.append(
          el(
            'li',
            { style: S.item },
            el('a', { style: S.link, href: it.href, text: it.title }),
          ),
        );
      }

      const head = el(
        'h2',
        { style: S.secTitle, title: 'Kliknij, aby zwinąć/rozwinąć sekcję' },
        caret,
        name,
        el('span', { style: S.count, text: ` (${items.length})` }),
      );
      head.addEventListener('click', () => {
        const hide = !collapsed.has(name);
        if (hide) collapsed.add(name);
        else collapsed.delete(name);
        list.style.display = hide ? 'none' : '';
        caret.textContent = hide ? '▸' : '▾';
      });

      sec.append(head, list);
      root.append(sec);
    }
    return root;
  };

  // ---------------------------------------------------------------------------
  // Strona artykułu — sama treść, bez listy powiązanych
  // ---------------------------------------------------------------------------
  // Przodkowie, których treść NIE jest właściwym artykułem
  // (do trybu zapasowego).
  const JUNK_ANCESTOR = [
    '#' + ROOT_ID,
    '.relatedBox',
    '.art_embed',
    '[class*="related" i]',
    '[class*="recommend" i]',
    '[class*="newsletter" i]',
    '[class*="embed" i]',
    '[class*="social" i]',
    '[class*="comment" i]',
    '[class*="footer" i]',
    '[class*="header" i]',
    'nav',
    '[class*="menu" i]',
    '[class*="advert" i]',
    '[class*="-ad" i]',
    '[class*="ad-" i]',
    '[class*="banner" i]',
  ].join(', ');

  const pickBody = () =>
    document.querySelector('#gazeta_article_body') ||
    document.querySelector('.art_content') ||
    document.querySelector('[itemprop="articleBody"]') ||
    document.querySelector('#article_wrapper') ||
    document.body;

  // Wstawki do usunięcia z treści artykułu:
  //   - linki/CTA do serwisów społecznościowych
  //     (np. „Dołącz do … na Facebooku!"),
  //   - cross-promo „Zobacz:" / „Sprawdź:" linkujące inny artykuł,
  //   - bloki „To także może cię zainteresować:" (lista powiązanych).
  const SOCIAL_HOST_RE = new RegExp(
    [
      'facebook\\.com',
      'fb\\.(?:com|me)',
      'instagram\\.com',
      '(?:twitter|x)\\.com',
      'tiktok\\.com',
      'youtube\\.com',
      'youtu\\.be',
      'threads\\.net',
      'snapchat\\.com',
      'linkedin\\.com',
      't\\.me',
    ].join('|'),
    'i',
  );
  // bez \b wokół słów: polskie litery (ź, ł…) nie tworzą granicy \w,
  // a odmiany („Instagramie", „Facebooku") i tak mają trafiać
  const SOCIAL_CTA_RE = new RegExp(
    '(?:dołącz|polub|obserwuj|śledź|znajdziesz nas|jesteśmy)' +
      '[^.]{0,60}' +
      '(?:facebook|instagram|twitter|tiktok|youtube|threads|snapchat)',
    'i',
  );
  // lookahead zamiast \b: chroni przed „Zobaczyłem to:", działa po „sprawdź"
  const CROSSLINK_RE = /^\s*(?:zobacz|sprawdź)(?![a-ząćęłńóśźż])[^:]{0,24}:/i;
  // „(To także) może cię zainteresować/zainteresuje" — nagłówek powiązanych
  const RELATED_RE = /może ci[eę].{0,16}zaintereso/i;

  const isJunkBlock = (node, t) => {
    const links = node.querySelectorAll ? node.querySelectorAll('a[href]') : [];
    for (const a of links) {
      if (SOCIAL_HOST_RE.test(a.getAttribute('href') || '')) return true;
    }
    if (SOCIAL_CTA_RE.test(t)) return true;
    if (RELATED_RE.test(t)) return true;
    // „Zobacz:" / „Sprawdź:" liczą się jako śmieć tylko gdy faktycznie linkują
    if (links.length && CROSSLINK_RE.test(t)) return true;
    return false;
  };

  // Wyciągamy treść artykułu do modelu RAZ (źródło znika po czyszczeniu),
  // a render z modelu można powtarzać — np. przy przełączaniu motywu.
  const extractArticle = () => {
    const titleEl =
      document.querySelector('#article_title') || document.querySelector('h1');
    const title =
      norm(titleEl && titleEl.textContent) || norm(document.title) || 'Artykuł';

    const authorEl = document.querySelector('.article_author');
    const dateEl = document.querySelector('.article_date');
    const meta = [
      norm(authorEl && authorEl.textContent),
      norm(dateEl && dateEl.textContent),
    ]
      .filter(Boolean)
      .join(' • ');

    const lead = norm(
      (document.querySelector('#gazeta_article_lead') || {}).textContent,
    );

    const body = pickBody();
    // 1) preferowane: dokładny tekst artykułu gazeta.pl
    const specific = body.querySelectorAll(
      'p.art_paragraph, h2.art_sub_title, h3.art_sub_title',
    );
    const usingSpecific = specific.length > 0;
    // 2) zapas: dowolne akapity/śródtytuły (dla nietypowych szablonów)
    const nodes = usingSpecific
      ? specific
      : body.querySelectorAll('p, h2, h3, h4, blockquote, li');

    const blocks = [];
    for (const n of nodes) {
      if (n.closest(JUNK_ANCESTOR)) continue;
      const t = norm(n.textContent);
      if (!t || /^reklama$/i.test(t)) continue;
      if (isJunkBlock(n, t)) continue;
      const head = /^h[2-4]$/i.test(n.tagName);
      // w trybie zapasowym odrzucamy krótkie „śmieci" (menu, podpisy itp.)
      if (!usingSpecific && !head && t.length < 25) continue;
      blocks.push({ head, text: t });
    }
    return { title, meta, lead, blocks };
  };

  const renderArticle = (model) => {
    const root = el('div', { id: ROOT_ID, style: S.root });

    root.append(
      el('a', {
        style: S.back,
        href: 'https://www.gazeta.pl/0,0.html',
        text: '‹ Gazeta.pl — lista artykułów',
      }),
    );

    root.append(el('h1', { style: S.artTitle, text: model.title }));
    if (model.meta) root.append(el('p', { style: S.meta, text: model.meta }));
    if (model.lead) root.append(el('p', { style: S.lead, text: model.lead }));

    for (const b of model.blocks) {
      root.append(
        el(b.head ? 'h2' : 'p', {
          style: b.head ? S.subtitle : S.para,
          text: b.text,
        }),
      );
    }

    if (!model.blocks.length && !model.lead) {
      root.append(
        el('p', {
          style: S.para,
          text: 'Nie udało się wyodrębnić treści artykułu z tej strony.',
        }),
      );
    }
    return root;
  };

  // ---------------------------------------------------------------------------
  // Przebudowa
  // ---------------------------------------------------------------------------
  // na stronie artykułu renderujemy raz (źródło znika po czyszczeniu);
  // treść trzymamy w modelu, więc render da się powtórzyć przy zmianie motywu
  let articleDone = false;
  let articleModel = null;

  const TOGGLE_ID = 'gz-theme-toggle';

  // Przycisk przełącznika motywu (tworzony od nowa przy każdym renderze).
  const makeToggle = () => {
    const warm = theme === 'warm';
    const label = warm
      ? 'Przełącz na jasne tło'
      : 'Przełącz na ciepłe (nocne) tło';
    const btn = el('button', {
      id: TOGGLE_ID,
      type: 'button',
      style: S.toggle,
      title: label,
      'aria-label': label,
      text: warm ? '☀️' : '🌙',
    });
    btn.addEventListener('click', toggleTheme);
    return btn;
  };

  // Narysuj bieżący widok wg aktywnego motywu (z modelu lub zebranych linków).
  const paint = () => {
    if (!document.body) return;
    const articleMode = isArticlePage();
    const root =
      articleMode && articleModel ? renderArticle(articleModel) : buildRoot();
    // przełącznik w treści (przewija się ze stroną), wyrównany do prawej
    root.prepend(el('div', { style: S.toggleBar }, makeToggle()));
    document.body.replaceChildren(root);
    document.body.setAttribute('style', S.body);
    document.body.className = '';
    document.documentElement.style.background = PALETTES[theme].bg;
    if (!articleMode) document.title = 'Gazeta.pl — lista artykułów';
  };

  function toggleTheme() {
    theme = theme === 'warm' ? 'light' : 'warm';
    saveTheme(theme);
    S = makeStyles(PALETTES[theme]);
    paint();
  }

  // ---------------------------------------------------------------------------
  // Pobieranie dat publikacji w tle (GM_xmlhttpRequest omija CORS między
  // domenami grupy). Link pojawia się od razu; gdy okaże się starszy niż rok,
  // znika przy najbliższym (odroczonym) przerysowaniu.
  // ---------------------------------------------------------------------------
  const MAX_DATE_FETCHES = 4;
  const dateQueue = [];
  const datePending = new Set();
  let activeDateFetches = 0;
  let repaintTimer = null;

  const repaintSoon = () => {
    if (repaintTimer) return;
    repaintTimer = setTimeout(() => {
      repaintTimer = null;
      try {
        paint();
      } catch (e) {
        console.error('[gazeta-reader]', e);
      }
    }, 400);
  };

  // rekurencyjnie znajdź pierwsze datePublished w danych JSON-LD
  const findDatePublished = (data) => {
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data)) {
      for (const x of data) {
        const d = findDatePublished(x);
        if (d) return d;
      }
      return null;
    }
    if (typeof data.datePublished === 'string') return data.datePublished;
    for (const k of Object.keys(data)) {
      const d = findDatePublished(data[k]);
      if (d) return d;
    }
    return null;
  };

  // wyłuskaj datę publikacji z HTML-a artykułu (ms) albo null
  const parsePubDate = (html) => {
    let doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch {
      return null;
    }
    const metas = [
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[itemprop="datePublished"]',
      'meta[property="og:article:published_time"]',
    ];
    for (const sel of metas) {
      const m = doc.querySelector(sel);
      const t = m && Date.parse(m.getAttribute('content') || '');
      if (t) return t;
    }
    const time = doc.querySelector('time[datetime]');
    const tt = time && Date.parse(time.getAttribute('datetime') || '');
    if (tt) return tt;
    for (const s of doc.querySelectorAll(
      'script[type="application/ld+json"]',
    )) {
      try {
        const d = findDatePublished(JSON.parse(s.textContent));
        const t = d && Date.parse(d);
        if (t) return t;
      } catch {
        /* niepoprawny JSON-LD — pomiń */
      }
    }
    return null;
  };

  // cb(date) gdzie date: ms (znana), 'unknown' (brak w HTML) lub null (błąd)
  const fetchPubDate = (href, cb) => {
    const xhr =
      typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null;
    if (!xhr) {
      cb(null);
      return;
    }
    try {
      xhr({
        method: 'GET',
        url: href,
        timeout: 15000,
        onload: (res) => {
          if (res.status >= 200 && res.status < 400) {
            const d = parsePubDate(res.responseText);
            cb(typeof d === 'number' ? d : 'unknown');
          } else {
            cb(null);
          }
        },
        onerror: () => cb(null),
        ontimeout: () => cb(null),
      });
    } catch {
      cb(null);
    }
  };

  const pumpDateFetches = () => {
    while (activeDateFetches < MAX_DATE_FETCHES && dateQueue.length) {
      const { key, href } = dateQueue.shift();
      activeDateFetches++;
      fetchPubDate(href, (date) => {
        activeDateFetches--;
        datePending.delete(key);
        if (date != null) {
          pubDates[key] = date; // ms albo 'unknown'
          persistPubSoon();
          if (typeof date === 'number' && Date.now() - date > ONE_YEAR_MS) {
            repaintSoon(); // stary link — zniknie przy przerysowaniu
          }
        }
        // przy błędzie nie zapisujemy — spróbujemy ponownie następnym razem
        pumpDateFetches();
      });
    }
  };

  // dokolejkuj nieznane linki do datowania (bez duplikatów)
  const scheduleDateFetches = () => {
    for (const items of bySection.values()) {
      for (const it of items) {
        if (it.key in pubDates || datePending.has(it.key)) continue;
        datePending.add(it.key);
        dateQueue.push({ key: it.key, href: it.href });
      }
    }
    pumpDateFetches();
  };

  const rebuild = () => {
    if (!document.body) return;

    const articleMode = isArticlePage();
    if (articleMode && articleDone) return; // już narysowane

    if (articleMode) {
      articleModel = extractArticle();
      articleDone = true;
    } else {
      collectArticles();
      scheduleDateFetches();
    }

    // usuń wszelkie media z całego dokumentu
    document
      .querySelectorAll(
        'img, picture, source, iframe, video, audio, embed, object, svg,' +
          ' canvas',
      )
      .forEach((n) => n.remove());

    // wyczyść <body> ze wszystkiego i wstaw nasz widok
    paint();
  };

  // ---------------------------------------------------------------------------
  // Start (JS strony jest martwy, więc DOM jest stabilny —
  // kilka przebiegów wystarczy)
  // ---------------------------------------------------------------------------
  const run = () => {
    try {
      rebuild();
    } catch (e) {
      console.error('[gazeta-reader]', e);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  window.addEventListener('load', run, { once: true });
  // dwa dodatkowe przebiegi na wypadek, gdyby część HTML dochodziła
  // z opóźnieniem
  setTimeout(run, 800);
  setTimeout(run, 2000);
})();
