// Behavioral tests for gazeta-reader.user.js, run under jsdom.
// The userscript is an IIFE that reads globals (document, location,
// GM_*). We load it into a fresh jsdom window per test via vm, stub the
// GM_* APIs, and dispatch the load events it listens for.
//
//   npm test
//
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'gazeta-reader.user.js'),
  'utf8',
);

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) {
    pass++;
    console.log('  OK  ' + msg);
  } else {
    fail++;
    console.log('  XX  ' + msg);
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Build a jsdom window, inject the userscript, fire its start events.
function makeDom(html, url, store, gmxhr) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const ctx = dom.getInternalVMContext();
  dom.window.GM_getValue = (k, d) => (k in store ? store[k] : d);
  dom.window.GM_setValue = (k, v) => {
    store[k] = v;
  };
  if (gmxhr) dom.window.GM_xmlhttpRequest = gmxhr;
  vm.runInContext(SRC, ctx);
  // jsdom reports readyState 'loading' at injection time, so fire the
  // events the script waits on to make rendering happen synchronously.
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  dom.window.dispatchEvent(new dom.window.Event('load'));
  return dom;
}

const LIST_HTML = `<!doctype html><html><head><title>orig</title></head><body>
  <a href="https://wiadomosci.gazeta.pl/wiadomosci/7,114871,30000001,pierwszy-dlugi-tytul.html" title="Pierwszy dłuższy tytuł artykułu">x</a>
  <a href="https://www.sport.pl/sport/7,65021,30000002,drugi-dlugi-tytul.html" title="Drugi dłuższy tytuł sportowy">y</a>
  <img src="x.jpg"><iframe></iframe>
</body></html>`;

const ART_HTML = `<!doctype html><html><head><title>Tytuł — Gazeta</title></head><body>
  <h1 id="article_title">Prawdziwy tytuł artykułu</h1>
  <div class="article_author">Jan Kowalski</div>
  <div class="article_date">27.06.2026</div>
  <p id="gazeta_article_lead">To jest lead artykułu, dłuższy niż próg.</p>
  <div id="gazeta_article_body">
    <p class="art_paragraph">Pierwszy akapit treści artykułu, wystarczająco długi.</p>
    <h2 class="art_sub_title">Śródtytuł</h2>
    <p class="art_paragraph">Drugi akapit treści, też odpowiednio długi tekst.</p>
  </div>
</body></html>`;

const LIST_URL = 'https://www.gazeta.pl/0,0.html';
const ART_URL =
  'https://wiadomosci.gazeta.pl/wiadomosci/7,114871,30000003,trzeci.html';
const SPORT_KEY =
  'https://www.sport.pl/sport/7,65021,30000002,drugi-dlugi-tytul.html';

const metaHtml = (iso) =>
  `<html><head><meta property="article:published_time" content="${iso}">` +
  `</head><body></body></html>`;
const daysAgoISO = (n) =>
  new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();
const sectionNames = (d) =>
  [...d.querySelectorAll('#gz-root section h2')].map((h) =>
    h.textContent
      .replace(/^[▾▸]\s*/, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim(),
  );

async function main() {
  console.log('T1: lista — render, jasny motyw, przycisk motywu');
  {
    const dom = makeDom(LIST_HTML, LIST_URL, {});
    const d = dom.window.document;
    const btn = d.getElementById('gz-theme-toggle');
    ok(!!d.getElementById('gz-root'), 'gz-root wyrenderowany');
    ok(!!btn, 'przycisk motywu istnieje');
    ok(d.title === 'Gazeta.pl — lista artykułów', 'tytuł listy ustawiony');
    ok(/background:#fafafa/.test(d.body.getAttribute('style')), 'tło jasne');
    ok(btn.style.position === 'relative', 'przycisk position:relative');
    ok(d.querySelector('#gz-root #gz-theme-toggle'), 'przycisk wewnątrz treści');
    ok(btn.textContent.trim() === '🌙', 'ikona = księżyc');
    ok(/ciepłe/i.test(btn.getAttribute('title') || ''), 'tooltip opisuje akcję');
    ok(d.querySelectorAll('img,iframe').length === 0, 'media usunięte');
    dom.window.close();
  }

  console.log('T2: klik motywu -> ciepłe, zapis GM, kolory');
  {
    const store = {};
    const dom = makeDom(LIST_HTML, LIST_URL, store);
    const d = dom.window.document;
    d.getElementById('gz-theme-toggle').dispatchEvent(
      new dom.window.Event('click'),
    );
    const btn = d.getElementById('gz-theme-toggle');
    ok(store['gz-theme'] === 'warm', 'GM zapisał gz-theme=warm');
    ok(/background:#f4ecd8/.test(d.body.getAttribute('style')), 'tło ciepłe');
    ok(btn.textContent.trim() === '☀️', 'ikona = słońce');
    const a = d.querySelector('#gz-root a[href*=".html"]');
    const col = a && a.style.color;
    ok(col === 'rgb(138, 75, 31)' || /#?8a4b1f/i.test(col || ''), 'link amber');
    btn.dispatchEvent(new dom.window.Event('click'));
    ok(store['gz-theme'] === 'light', 'ponowny klik => light');
    dom.window.close();
  }

  console.log('T3: zapamiętany motyw warm wczytany przy starcie');
  {
    const dom = makeDom(LIST_HTML, LIST_URL, { 'gz-theme': 'warm' });
    const d = dom.window.document;
    ok(/background:#f4ecd8/.test(d.body.getAttribute('style')), 'start warm');
    dom.window.close();
  }

  console.log('T4: artykuł — render + przełącznik z modelu po czyszczeniu DOM');
  {
    const dom = makeDom(ART_HTML, ART_URL, {});
    const d = dom.window.document;
    const root = d.getElementById('gz-root');
    ok(/Prawdziwy tytuł artykułu/.test(root.textContent), 'tytuł obecny');
    ok(/Pierwszy akapit/.test(root.textContent), 'akapit obecny');
    ok(/Śródtytuł/.test(root.textContent), 'śródtytuł obecny');
    ok(!d.getElementById('gz-timeframe-toggle'), 'brak zakresu na artykule');
    d.getElementById('gz-theme-toggle').dispatchEvent(
      new dom.window.Event('click'),
    );
    ok(
      /Pierwszy akapit/.test(d.getElementById('gz-root').textContent),
      'po przełączeniu treść z modelu nadal obecna',
    );
    dom.window.close();
  }

  console.log('T5: nagłówek sekcji zwija/rozwija i stan trwa render');
  {
    const dom = makeDom(LIST_HTML, LIST_URL, {});
    const d = dom.window.document;
    const sec = d.querySelector('#gz-root section');
    const list = sec.querySelector('ul');
    ok(list.style.display !== 'none', 'pierwsza sekcja widoczna');
    sec.querySelector('h2').dispatchEvent(new dom.window.Event('click'));
    ok(sec.querySelector('ul').style.display === 'none', 'po kliknięciu ukryta');
    d.getElementById('gz-theme-toggle').dispatchEvent(
      new dom.window.Event('click'),
    );
    const sec2 = d.querySelector('#gz-root section');
    ok(
      sec2.querySelector('ul').style.display === 'none',
      'stan zwinięcia trwa po re-renderze (motyw)',
    );
    dom.window.close();
  }

  console.log('T6: usuwanie wstawek social / „Zobacz:" / „zainteresować"');
  {
    const html = `<!doctype html><html><head><title>T</title></head><body>
      <h1 id="article_title">Tytuł artykułu szóstego</h1>
      <div id="gazeta_article_body">
        <p class="art_paragraph">Prawdziwa treść akapitu, wystarczająco długa.</p>
        <p class="art_paragraph"><a href="https://www.facebook.com/x">Dołącz do  na Facebooku!</a></p>
        <p class="art_paragraph">Polub nas na Instagramie, by nie przegapić.</p>
        <p class="art_paragraph">ZOBACZ TEŻ: <a href="https://wiadomosci.gazeta.pl/wiadomosci/7,1,2,i.html">Inny artykuł powiązany</a></p>
        <p class="art_paragraph">Sprawdź: <a href="https://www.sport.pl/sport/7,3,4,m.html">Wynik meczu</a></p>
        <p class="art_paragraph">Drugi prawdziwy akapit, też odpowiednio długi tekst.</p>
        <p class="art_paragraph">Premier napisał na Facebooku, że to nieprawda i dodał szczegóły.</p>
        <p class="art_paragraph">To także może cię zainteresować: <a href="https://wiadomosci.gazeta.pl/wiadomosci/7,5,6,p.html">Powiązany temat dnia</a></p>
      </div></body></html>`;
    const dom = makeDom(html, ART_URL, {});
    const txt = dom.window.document.getElementById('gz-root').textContent;
    ok(/Prawdziwa treść akapitu/.test(txt), 'zwykły akapit zachowany');
    ok(/Drugi prawdziwy akapit/.test(txt), 'drugi zwykły akapit zachowany');
    ok(!/Facebooku!/.test(txt), 'usunięto „Dołącz … na Facebooku!"');
    ok(!/Polub nas na Instagramie/.test(txt), 'usunięto CTA Instagram');
    ok(!/Inny artykuł powiązany/.test(txt), 'usunięto „ZOBACZ TEŻ:"');
    ok(!/Wynik meczu/.test(txt), 'usunięto „Sprawdź:"');
    ok(!/Powiązany temat dnia/.test(txt), 'usunięto „…zainteresować:"');
    ok(/Premier napisał na Facebooku/.test(txt), 'zdanie w treści zachowane');
    dom.window.close();
  }

  console.log('T7: kolejność sekcji + domyślne zwinięcie poza Wiadomości');
  {
    const a = (host, p, id, t) =>
      `<a href="https://${host}/${p}/7,1,${id},x.html" title="${t}">x</a>`;
    const html = `<!doctype html><html><head><title>o</title></head><body>
      ${a('moto.pl', 'moto', 30000020, 'Nowy model auta na rynku')}
      ${a('kultura.gazeta.pl', 'kultura', 30000021, 'Premiera filmu w kinach')}
      ${a('www.sport.pl', 'sport', 30000022, 'Wynik wczorajszego meczu')}
      ${a('next.gazeta.pl', 'next', 30000023, 'Notowania giełdowe w górę')}
      ${a('wiadomosci.gazeta.pl', 'wiadomosci', 30000024, 'Najnowsze doniesienia')}
      ${a('www.plotek.pl', 'plotek', 30000025, 'Gwiazda na premierze gali')}
    </body></html>`;
    const dom = makeDom(html, LIST_URL, {});
    const d = dom.window.document;
    ok(
      sectionNames(d).slice(0, 5).join('|') ===
        ['Wiadomości', 'Biznes (Next)', 'Sport', 'Moto', 'Kultura'].join('|'),
      'kolejność: Wiadomości, Biznes, Sport, Moto, Kultura',
    );
    const ulFor = (nm) =>
      [...d.querySelectorAll('#gz-root section')]
        .find((s) => s.querySelector('h2').textContent.includes(nm))
        .querySelector('ul');
    ok(ulFor('Wiadomości').style.display !== 'none', 'Wiadomości rozwinięte');
    ok(ulFor('Sport').style.display === 'none', 'Sport zwinięty domyślnie');
    ok(ulFor('Plotek').style.display === 'none', 'Plotek zwinięty domyślnie');
    dom.window.close();
  }

  console.log('T8: datowanie w tle usuwa stary link i pustą sekcję');
  {
    const store = {};
    let xhr = 0;
    const dom = makeDom(LIST_HTML, LIST_URL, store, (opts) => {
      xhr++;
      const iso = /sport\.pl/.test(opts.url)
        ? '2019-01-01T10:00:00+01:00'
        : daysAgoISO(30);
      opts.onload({ status: 200, responseText: metaHtml(iso) });
    });
    const d = dom.window.document;
    await wait(1300); // repaint (400ms) + zapis (1000ms)
    const txt = d.getElementById('gz-root').textContent;
    ok(/Pierwszy dłuższy/.test(txt), 'świeży artykuł zostaje');
    ok(!/Drugi dłuższy/.test(txt), 'stary (>1 rok) usunięty');
    ok(!sectionNames(d).includes('Sport'), 'pusta sekcja Sport usunięta');
    ok(xhr === 2, 'pobrano daty obu nieznanych linków');
    ok(store['gz-pubdates'] && store['gz-pubdates'][SPORT_KEY] != null, 'zapis');
    dom.window.close();
  }

  console.log('T9: znana data z mapy filtruje od razu, bez pobierania');
  {
    const store = { 'gz-pubdates': { [SPORT_KEY]: Date.parse('2019-01-01') } };
    let xhr = 0;
    const dom = makeDom(LIST_HTML, LIST_URL, store, (opts) => {
      xhr++;
      opts.onload({ status: 200, responseText: metaHtml(daysAgoISO(30)) });
    });
    const txt = dom.window.document.getElementById('gz-root').textContent;
    ok(!/Drugi dłuższy/.test(txt), 'znany stary link odfiltrowany od razu');
    ok(/Pierwszy dłuższy/.test(txt), 'świeży link obecny');
    ok(xhr === 1, 'pobrano tylko nieznaną datę (znaną pominięto)');
    dom.window.close();
  }

  console.log('T10: przycisk zakresu dat filtruje i przełącza cyklicznie');
  {
    const store = { 'gz-timeframe': '7d' };
    const dom = makeDom(LIST_HTML, LIST_URL, store, (opts) => {
      const iso = /sport\.pl/.test(opts.url) ? daysAgoISO(200) : daysAgoISO(3);
      opts.onload({ status: 200, responseText: metaHtml(iso) });
    });
    const d = dom.window.document;
    await wait(900);
    const btn = () => d.getElementById('gz-timeframe-toggle');
    const click = () => btn().dispatchEvent(new dom.window.Event('click'));
    ok(/7 dni/.test(btn().textContent), 'przycisk pokazuje „7 dni"');
    ok(!sectionNames(d).includes('Sport'), '7 dni: 200-dniowy ukryty');
    click();
    ok(/1 miesiąc/.test(btn().textContent), 'klik -> „1 miesiąc"');
    ok(!sectionNames(d).includes('Sport'), '1 miesiąc: nadal ukryty');
    click();
    ok(/1 rok/.test(btn().textContent), 'klik -> „1 rok"');
    ok(sectionNames(d).includes('Sport'), '1 rok: Sport znów widoczny');
    ok(store['gz-timeframe'] === '1y', 'wybór zakresu zapisany w GM');
    dom.window.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main();
