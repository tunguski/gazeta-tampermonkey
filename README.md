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
- **Listy / fronty sekcji** → prosta lista artykułów pogrupowana w sekcje
  (Wiadomości, Sport, Biznes…), posortowana wg liczby artykułów.
- **Strona artykułu** → sama treść (tytuł, lead, akapity, śródtytuły) w
  minimalistycznym stylu, bez listy artykułów powiązanych.

## Filtry

- Pomija całe sekcje: **Avanti**, **Horoskopy**, **Wysokie Obcasy**.
- Pomija linki oznaczone **SUBSKRYPCJA** (treść płatna) oraz
  **MATERIAŁ PROMOCYJNY** (reklama).
- Odrzuca linki do hostów reklamowych/trackerów (DoubleClick, Taboola,
  Outbrain itp.).

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
