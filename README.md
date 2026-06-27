# Gazeta.pl — czysta lista artykułów

Userscript (Tampermonkey) zamieniający gazeta.pl w lekki, czytelny widok bez
obrazów, ramek, reklam i całego JavaScriptu strony.

## Co robi

- **Wyłącza JavaScript strony** — na samym starcie wstrzykuje
  `<meta http-equiv="Content-Security-Policy">` z polityką
  `script-src 'none'; img-src 'none'; frame-src 'none'; ...`. Dzięki temu strona
  się nie przebudowuje, nie doładowuje obrazów ani reklam, a skrypt nie musi z
  niczym walczyć. Sam skrypt działa w piaskownicy Tampermonkey, więc CSP go nie
  dotyczy.
- **Usuwa media i reklamy** — fizycznie kasuje `img`, `picture`, `iframe`,
  `video`, `svg`, `canvas` itd.
- **Listy / fronty sekcji** → prosta lista artykułów pogrupowana w sekcje.
  Kolejność jest stała: **Wiadomości, Biznes, Sport, Moto, Kultura**, a dalej
  pozostałe sekcje wg liczby artykułów. Domyślnie rozwinięta jest tylko
  **Wiadomości** — każdy nagłówek można kliknąć, aby zwinąć/rozwinąć (▾ / ▸).
- **Strona artykułu** → sama treść (tytuł, lead, akapity, śródtytuły) w
  minimalistycznym stylu, bez listy artykułów powiązanych.
- **Ciepłe („nocne") tło** — przycisk 🌙 w prawym górnym rogu treści przełącza
  między jasną a ciepłą/sepiową paletą (mniej niebieskiego światła,
  łagodniejszą dla oczu — na wzór *Night light* w Windows). Wybór jest
  zapamiętywany w przeglądarce (`GM_setValue`) i wspólny dla wszystkich
  serwisów grupy.

## Filtry

- Pomija całe sekcje: **Avanti**, **Horoskopy**, **Wysokie Obcasy**.
- Pomija linki oznaczone **SUBSKRYPCJA** (treść płatna) oraz
  **MATERIAŁ PROMOCYJNY** (reklama).
- Odrzuca linki do hostów reklamowych/trackerów (DoubleClick, Taboola,
  Outbrain itp.).
- W treści artykułu usuwa wstawki, które nie są właściwym tekstem:
  - zachęty/linki do social mediów (np. „Dołącz do … na Facebooku!",
    Instagram, X/Twitter, TikTok, YouTube),
  - cross-promo **„Zobacz:"** / **„Sprawdź:"** linkujące inny artykuł,
  - bloki **„To także może cię zainteresować:"** (lista powiązanych).

## Instalacja

1. Zainstaluj rozszerzenie [Tampermonkey](https://www.tampermonkey.net/).
2. Otwórz panel Tampermonkey → **Utwórz nowy skrypt**.
3. Wklej zawartość [`gazeta-reader.user.js`](gazeta-reader.user.js) i zapisz
   (Ctrl+S).
4. Wejdź na [gazeta.pl](https://www.gazeta.pl/) i odśwież stronę.

> **Uwaga:** edycja pliku na dysku **nie** aktualizuje skryptu w przeglądarce —
> po każdej zmianie trzeba ponownie wkleić zawartość do edytora Tampermonkey i
> zapisać. W konsoli (F12) skrypt wypisuje swoją wersję i wykryty tryb
> (`artykuł` / `lista`), co ułatwia diagnozę.

## Rozwój / formatowanie

Kod trzymany jest w limicie **80 znaków na linię**. Do formatowania służy
[Prettier](https://prettier.io/) (konfiguracja w `.prettierrc.json`):

```bash
npm install        # jednorazowo
npm run format        # sformatuj gazeta-reader.user.js
npm run format:check  # sprawdź bez zmian (np. w CI)
```

> Prettier nie zawija komentarzy ani długich literałów — te zawijane są ręcznie.
> Wyjątek: nagłówek `@description` musi pozostać w jednej linii (wymóg
> Tampermonkey).

## Obsługiwane domeny

Oprócz `*.gazeta.pl` skrypt działa też na powiązanych serwisach grupy:
`sport.pl`, `moto.pl`, `plotek.pl`, `avanti24.pl`, `czterykaty.pl`, `haps.pl`,
`edziecko.pl` (zob. nagłówki `@match`).

## Jak to działa (szczegóły)

Artykuły rozpoznawane są **heurystycznie po wzorcu URL-a** (numeryczne ID i
`.html`), a nie po klasach CSS — gazeta.pl często zmienia strukturę znaczników,
więc to podejście jest trwalsze. Treść artykułu pobierana jest z kontenerów
`#article_title` / `#gazeta_article_lead` / `#gazeta_article_body`
(`p.art_paragraph`, `h2.art_sub_title`), z zapasowym, generycznym wyciąganiem
akapitów dla nietypowych szablonów.

## Ograniczenia

- Nietypowe szablony (relacje na żywo, galerie, treści premium `wyborcza.pl`)
  mogą wymagać dopisania selektorów.
- Treści doładowywane wyłącznie przez JavaScript nie pojawią się — to celowy
  efekt wyłączenia skryptów strony.
