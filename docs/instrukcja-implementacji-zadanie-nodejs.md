# Instrukcja implementacji zadania Node.js

Dokument powstal na podstawie pliku `docs/zadanie_nodejs`. Celem jest
przeksztalcenie tresci zadania rekrutacyjnego w kompletna instrukcje
implementacji programu realizujacego temat `Event Processing Engine`.

## 1. Kontekst zadania

Implementacja jest zadaniem rekrutacyjnym.

- Zakladany czas pracy kandydata: okolo `6-10 godzin`.
- Czas dostepny na wykonanie: `3 MD`.
- Jesli nie uda sie wykonac calosci w terminie, nalezy tak rozplanowac prace,
  aby oddac przynajmniej dzialajacy fragment aplikacji.
- Kod nalezy umiescic we wlasnym repozytorium na GitHub.

Temat zadania:

- `Event Processing Engine`.

## 2. Opis biznesowy

Firma posiada wiele zewnetrznych integracji, ktore wysylaja rozne zdarzenia
(`events`). Dla przykladu kazde zdarzenie:

- przychodzi asynchronicznie,
- moze pojawic sie wielokrotnie,
- moze przyjsc w zlej kolejnosci,
- moze zostac opoznione,
- moze czesciowo nadpisywac poprzedni stan.

Zadaniem aplikacji jest stworzenie silnika przetwarzania zdarzen dla systemu
zamowien.

## 3. Dane wejsciowe

System otrzymuje eventy w formacie JSON.

Przykladowy event:

```json
{
  "eventId": "evt-1001",
  "orderId": "ord-501",
  "type": "ORDER_UPDATED",
  "timestamp": 1710001000,
  "payload": {
    "status": "PAID",
    "amount": 199.99
  }
}
```

Wymagane znaczenie pol:

- `eventId`: zewnetrzny identyfikator eventu, uzywany do deduplikacji.
- `orderId`: identyfikator zamowienia, ktorego dotyczy event.
- `type`: typ eventu.
- `timestamp`: czas wygenerowania eventu, uzywany przy strategii kolejnosci,
  konfliktow i laczenia danych.
- `payload`: dane biznesowe eventu; moze zawierac tylko czesc pol.

Obslugiwane typy eventow:

- `ORDER_CREATED`
- `ORDER_UPDATED`
- `PAYMENT_CAPTURED`
- `ORDER_CANCELLED`
- `REFUND_ISSUED`

## 4. Problem do rozwiazania

Silnik musi poprawnie obsluzyc sytuacje, w ktorych eventy:

- moga przyjsc wiele razy,
- moga przyjsc w innej kolejnosci niz zostaly wygenerowane,
- moga miec konfliktujace dane,
- nie wszystkie sa poprawne,
- czesc eventow moze byc przestarzala.

System ma utrzymywac:

1. Aktualny stan zamowienia.
2. Historie zmian.
3. Audit log decyzji silnika.

## 5. Wymagane API

Nalezy stworzyc REST API z trzema endpointami biznesowymi.

### 5.1. `POST /events`

Endpoint przyjmuje batch eventow, czyli tablice obiektow JSON.

Minimalne wymagania implementacyjne:

- request body musi byc tablica,
- kazdy element tablicy nalezy potraktowac jako osobna dostawe eventu,
- aplikacja powinna zapisac otrzymane eventy i uruchomic albo wykonac ich
  przetwarzanie,
- przetwarzanie powinno zapisac decyzje silnika w audit logu.

Przykladowy request:

```json
[
  {
    "eventId": "evt-1001",
    "orderId": "ord-501",
    "type": "ORDER_UPDATED",
    "timestamp": 1710001000,
    "payload": {
      "status": "PAID",
      "amount": 199.99
    }
  }
]
```

### 5.2. `GET /orders/:id`

Endpoint zwraca informacje o zamowieniu.

Odpowiedz musi zawierac:

- aktualny stan zamowienia,
- historie zmian,
- informacje, ktore eventy zostaly odrzucone i dlaczego.

Rekomendowane pola odpowiedzi:

- `currentState`: aktualny stan zamowienia,
- `history`: zaakceptowane zmiany stanu,
- `rejectedEvents`: eventy odrzucone wraz z powodami,
- `duplicateEvents`: eventy zignorowane jako duplikaty,
- `pendingEvents`: eventy oczekujace, jesli implementacja wspiera odkladanie
  eventow,
- `auditLog`: komplet decyzji silnika dotyczacych zamowienia.

### 5.3. `GET /stats`

Endpoint zwraca statystyki przetwarzania.

Odpowiedz musi zawierac:

- liczbe poprawnych eventow,
- liczbe odrzuconych eventow,
- liczbe duplikatow,
- sredni czas przetwarzania.

Rekomendowane pola odpowiedzi:

- `validEventsCount`
- `rejectedEventsCount`
- `duplicateEventsCount`
- `averageProcessingTimeMs`

Mozna dodac pola diagnostyczne, np. liczbe eventow zaakceptowanych,
czesciowo zastosowanych, oczekujacych albo przeniesionych do kolejki bledow.

## 6. Reguly biznesowe

### 6.1. Deduplication

Jesli `eventId` juz istnieje:

- event ma zostac zignorowany,
- event nie moze ponownie zmienic stanu zamowienia,
- fakt ponownego otrzymania eventu musi zostac zapisany w audit logu.

Instrukcja implementacyjna:

- utrzymuj zbior przetworzonych albo zarejestrowanych `eventId`,
- przy kazdym nowym evencie sprawdz, czy `eventId` zostal juz uzyty,
- jezeli tak, zapisz decyzje np. `DUPLICATE` z powodem `DUPLICATE_EVENT`,
- licz duplikaty w `GET /stats`.

### 6.2. Ordering

Jesli event przyjdzie starszy niz ostatni zaakceptowany event, system musi
zdecydowac:

- czy go odrzucic,
- czy czesciowo zastosowac,
- czy zmergowac.

Kandydat musi sam zaproponowac strategie. Strategia musi byc jawnie opisana w
README albo dokumentacji projektu.

Minimalna instrukcja strategii:

- nie opieraj sie wylacznie na kolejnosci dostarczenia eventow,
- uzywaj `timestamp` do rozstrzygania konfliktow,
- dla przestarzalych eventow zapisz decyzje w audit logu,
- dla eventow czesciowo przydatnych dopusc decyzje typu
  `PARTIALLY_APPLIED`,
- dla eventow calkowicie nieaktualnych dopusc decyzje typu `REJECTED`.

Przykladowa strategia zgodna z dokumentacja w tym repozytorium:

- eventy sa czytane deterministycznie w kolejnosci dostarczenia,
- pola typu "ostatnia znana wartosc" stosuja zasade: wygrywa scisle nowszy
  `timestamp`,
- przy tym samym `timestamp` wygrywa pierwsza zaakceptowana wartosc,
- brakujace pola nigdy nie kasuja poprzedniego stanu,
- platnosci i zwroty sa traktowane jako fakty finansowe, a nie jako zwykle
  nadpisania pol.

### 6.3. State transitions

Niektore przejscia stanu sa niedozwolone.

Przyklady z zadania:

- `CANCELLED -> PAID` powinno byc niemozliwe,
- `PAID -> REFUNDED` jest poprawne.

Kandydat sam definiuje sensowny state machine.

Instrukcja implementacyjna:

- zdefiniuj jawna liste stanow zamowienia,
- zdefiniuj jawna liste dozwolonych przejsc,
- kazda zmiana statusu musi przejsc przez state machine,
- odrzucone przejscia musza zachowac poprzedni stan zamowienia,
- kazde odrzucone przejscie musi trafic do audit logu z powodem.

Przykladowy state machine:

- `NEW -> CREATED` przez `ORDER_CREATED`,
- `CREATED -> PAID` przez `PAYMENT_CAPTURED`,
- `CREATED -> CANCELLED` przez `ORDER_CANCELLED`,
- `PAID -> PARTIALLY_REFUNDED` przez czesciowy `REFUND_ISSUED`,
- `PAID -> REFUNDED` przez pelny `REFUND_ISSUED`,
- `PARTIALLY_REFUNDED -> REFUNDED` przez kolejny zwrot.

Przykladowe przejscia zabronione:

- `CANCELLED -> PAID`,
- `CANCELLED -> REFUNDED`,
- `REFUNDED -> PAID`,
- `NEW -> PAID`.

### 6.4. Partial updates

Niektore eventy zawieraja tylko czesc danych.

Przyklad:

```json
{
  "payload": {
    "amount": 250
  }
}
```

Silnik nie moze usuwac brakujacych pol.

Instrukcja implementacyjna:

- aktualizuj tylko pola obecne w `payload`,
- brak pola w `payload` oznacza "nie zmieniaj", a nie `null`,
- przy merge'u kilku pol dopusc zastosowanie tylko tej czesci, ktora nadal
  jest aktualna,
- zapisz w historii, ktore pola zmieniono,
- zapisz w audit logu, ktore pola pominieto jako przestarzale, jesli taka
  sytuacja wystapi.

## 7. Walidacja eventow

Zadanie mowi, ze nie wszystkie eventy sa poprawne, wiec implementacja musi
rozroznic eventy poprawne i odrzucone.

Minimalne walidacje:

- event musi byc obiektem JSON,
- `eventId` musi istniec i byc niepustym stringiem,
- `orderId` musi istniec i byc niepustym stringiem,
- `type` musi byc jednym z obslugiwanych typow,
- `timestamp` musi byc poprawna liczba,
- `payload`, jesli istnieje, musi byc obiektem,
- pola finansowe, jesli wystepuja, musza miec sensowny format liczbowy.

Kazdy blad walidacji powinien:

- odrzucic dany event,
- zapisac powod odrzucenia,
- zwiekszyc licznik odrzuconych eventow,
- nie blokowac przetwarzania calego batcha, o ile sam request byl poprawna
  tablica.

## 8. Model danych

Implementacja powinna przechowywac przynajmniej ponizsze informacje.

### 8.1. Surowe dostawy eventow

Kazdy element przyjety przez `POST /events` powinien zostac zapisany w
append-only inbox logu.

Przykladowe pola:

- `id`
- `eventId`, jesli da sie go wyciagnac
- `orderId`, jesli da sie go wyciagnac
- typ eventu, jesli da sie go wyciagnac
- `timestamp`, jesli da sie go wyciagnac
- surowy event
- payload, jesli jest obiektem
- `receivedAt`

Surowy wpis nie powinien zawierac statusu przetwarzania, liczby prob ani
ostatniej decyzji. Te dane naleza do technicznego joba przetwarzania.

### 8.2. Joby przetwarzania

Dla kazdej surowej dostawy powinien powstac techniczny job przetwarzania.

Przykladowe pola:

- identyfikator joba
- identyfikator surowej dostawy
- status techniczny, np. `PENDING`, `DEFERRED`, `DONE`, `DEAD_LETTERED`
- czas nastepnej dostepnosci do przetwarzania
- liczba prob technicznych
- ostatni blad techniczny, jesli wystapil
- ostatnia decyzja silnika, jesli zostala juz zapisana

Worker aktualizuje joby przetwarzania, ale nie aktualizuje surowego inbox logu.

### 8.3. Zamowienia

Przykladowe pola aktualnego stanu:

- `orderId`
- `status`
- `amount`
- `currency`
- `paidAmount`
- `refundedAmount`
- `lastAcceptedEventId`
- `lastAcceptedTimestamp`
- `createdAt`
- `updatedAt`

### 8.4. Historia zmian

Kazdy zaakceptowany albo czesciowo zastosowany event powinien utworzyc wpis w
historii zmian.

Wpis historii powinien zawierac:

- identyfikator eventu,
- typ eventu,
- `timestamp` eventu,
- poprzedni stan albo poprzedni status,
- nowy stan albo nowy status,
- liste zmienionych pol,
- liste pominietych pol, jesli dotyczy,
- czas przetworzenia.

### 8.5. Audit log decyzji silnika

Audit log jest wymagany przez zadanie.

Powinien obejmowac decyzje takie jak:

- event zaakceptowany,
- event czesciowo zastosowany,
- event odrzucony,
- event zignorowany jako duplikat,
- event przestarzaly,
- event z konfliktujacymi danymi,
- event z niedozwolonym przejsciem stanu.

Kazdy wpis audit logu powinien zawierac:

- `eventId`, jesli jest dostepny,
- `orderId`, jesli jest dostepny,
- identyfikator surowej dostawy,
- identyfikator joba przetwarzania,
- typ eventu, jesli jest dostepny,
- decyzje silnika,
- kod powodu,
- opis powodu,
- czas przetwarzania.

## 9. Obsluga typow eventow

### 9.1. `ORDER_CREATED`

Cel:

- utworzyc nowe zamowienie.

Reguly:

- jesli zamowienie nie istnieje, utworz je,
- ustaw status poczatkowy, np. `CREATED`,
- zastosuj pola obecne w `payload`, np. `amount`,
- jesli zamowienie juz istnieje, zdecyduj czy event jest duplikatem,
  konfliktem albo odrzuceniem biznesowym,
- zapisz decyzje w audit logu.

### 9.2. `ORDER_UPDATED`

Cel:

- czesciowo aktualizowac dane zamowienia.

Reguly:

- aktualizuj tylko pola obecne w `payload`,
- brakujace pola nie moga kasowac poprzedniego stanu,
- jesli `payload.status` probuje zmienic status, sprawdz state machine,
- rozstrzygaj konflikty przez przyjeta strategie ordering/merge,
- zapisz zmienione i pominiete pola.

### 9.3. `PAYMENT_CAPTURED`

Cel:

- oznaczyc przechwycenie platnosci.

Reguly:

- typowo przejscie `CREATED -> PAID`,
- `CANCELLED -> PAID` jest niedozwolone,
- event powinien byc idempotentny przez deduplikacje `eventId`,
- kwota platnosci, jesli wystepuje, musi byc poprawna,
- zapisz zmiane stanu i decyzje.

### 9.4. `ORDER_CANCELLED`

Cel:

- anulowac zamowienie.

Reguly:

- typowo przejscie `CREATED -> CANCELLED`,
- anulowanie po niedozwolonym stanie powinno zostac odrzucone,
- odrzucenie musi zachowac poprzedni stan,
- decyzja musi trafic do audit logu.

### 9.5. `REFUND_ISSUED`

Cel:

- obsluzyc zwrot.

Reguly:

- `PAID -> REFUNDED` jest poprawne,
- dla zwrotu czesciowego mozna zastosowac stan posredni, np.
  `PARTIALLY_REFUNDED`,
- zwrot przed platnoscia powinien zostac odrzucony albo odlozony, zgodnie z
  przyjeta strategia,
- kwota zwrotu, jesli wystepuje, musi byc poprawna,
- laczna kwota zwrotow nie powinna przekraczac kwoty zaplaconej.

## 10. Wymagania techniczne

Wymagane technologie:

- Node.js
- TypeScript
- Yarn
- lokalna baza SQLite
- krotkie README z zalozeniami dzialania aplikacji oraz opisem uruchomienia
  aplikacji

Testy jednostkowe:

- opcjonalne,
- traktowane jako dodatkowy bonus point.

Dozwolone frameworki i podejscia:

- Express,
- Fastify,
- Nest,
- wlasne minimalne rozwiazanie.

Ograniczenia:

- nie uzywaj ORM generujacych cala logike,
- nie uzywaj gotowych workflow engine,
- nie uzywaj event sourcing frameworkow.

## 11. Sugerowana architektura implementacji

Ta sekcja nie dodaje nowych wymagan rekrutacyjnych, ale przeklada je na
praktyczny plan implementacji.

### 11.1. Warstwy aplikacji

Rekomendowany podzial:

- controller API dla `POST /events`,
- controller API dla `GET /orders/:id`,
- controller API dla `GET /stats`,
- serwis ingestii eventow,
- serwis tworzenia jobow przetwarzania,
- serwis przetwarzania eventow,
- serwis state machine,
- serwis merge/orderingu,
- serwis deduplikacji,
- serwis statystyk,
- warstwa persystencji lokalnej.

### 11.2. Przeplyw przetwarzania

1. `POST /events` przyjmuje tablice eventow.
2. Aplikacja zapisuje kazdy element jako surowa dostawe w append-only inbox
   logu.
3. Aplikacja tworzy dla kazdej surowej dostawy job przetwarzania.
4. Worker pobiera dostepne joby i dolacza do nich surowe dane eventu.
5. Dla kazdego joba silnik wykonuje walidacje eventu.
6. Silnik sprawdza deduplikacje po `eventId`.
7. Silnik pobiera aktualny stan zamowienia.
8. Silnik stosuje reguly typu eventu.
9. Silnik rozstrzyga ordering, konflikty i partial updates.
10. Silnik sprawdza state machine.
11. Silnik zapisuje aktualny stan zamowienia.
12. Silnik zapisuje historie zmian.
13. Silnik zapisuje audit log decyzji.
14. Silnik aktualizuje statystyki.
15. Worker aktualizuje status joba przetwarzania.

### 11.3. Decyzje silnika

Warto uzyc stabilnych nazw decyzji, np.:

- `ACCEPTED`
- `PARTIALLY_APPLIED`
- `REJECTED`
- `DUPLICATE`

Opcjonalnie, jesli implementacja obsluguje opoznione eventy:

- `DEFERRED`

Opcjonalnie, jesli implementacja obsluguje techniczne retry:

- `FAILED`

## 12. README wymagane do oddania

README powinno zawierac:

- opis zalozen dzialania aplikacji,
- opis przyjetej strategii ordering/merge,
- opis state machine,
- opis storage, czyli lokalnej bazy SQLite, append-only raw inbox i jobow
  przetwarzania,
- instrukcje instalacji zaleznosci przez Yarn,
- instrukcje uruchomienia aplikacji,
- przyklady wywolan `POST /events`, `GET /orders/:id`, `GET /stats`,
- informacje o testach, jesli zostaly dodane.

## 13. Minimalny dzialajacy fragment

Poniewaz zadanie wprost mowi, zeby w razie braku czasu oddac dzialajacy fragment
aplikacji, priorytety implementacji powinny byc nastepujace:

1. Dzialajacy projekt Node.js + TypeScript + Yarn.
2. Dzialajace `POST /events`.
3. Lokalna persystencja na dysku.
4. Rozdzielenie surowych dostaw eventow od jobow przetwarzania.
5. Aktualny stan zamowienia.
6. Deduplication po `eventId`.
7. `GET /orders/:id` pokazujacy stan, historie i odrzucenia.
8. `GET /stats` pokazujacy wymagane liczniki.
9. State machine z przynajmniej przykladami `CANCELLED -> PAID` jako
   niedozwolone i `PAID -> REFUNDED` jako dozwolone.
10. Strategia ordering/merge dla starszych i czesciowych eventow.
11. README.

## 14. Kryteria odbioru

Implementacja realizuje zadanie, jezeli:

- przyjmuje batch eventow przez `POST /events`,
- zapisuje surowe dostawy eventow w append-only inbox logu,
- przechowuje techniczny status przetwarzania w osobnych jobach,
- rozpoznaje wszystkie wymagane typy eventow,
- utrzymuje aktualny stan zamowienia,
- utrzymuje historie zmian,
- utrzymuje audit log decyzji silnika,
- ignoruje duplikaty `eventId` i zapisuje je w audit logu,
- ma jawna strategie dla starszych eventow,
- potrafi odrzucic, czesciowo zastosowac albo zmergowac event wedlug tej
  strategii,
- ma jawny state machine,
- blokuje niedozwolone przejscia, np. `CANCELLED -> PAID`,
- pozwala na poprawne przejscia, np. `PAID -> REFUNDED`,
- poprawnie obsluguje partial updates bez kasowania brakujacych pol,
- zwraca wymagane dane przez `GET /orders/:id`,
- zwraca wymagane statystyki przez `GET /stats`,
- uzywa Node.js, TypeScript i Yarn,
- uzywa lokalnej persystencji na dysku,
- nie uzywa zakazanych klas narzedzi,
- ma README z zalozeniami i uruchomieniem,
- kod jest umieszczony w repozytorium GitHub.

## 15. Scenariusze testowe

Testy jednostkowe sa opcjonalne, ale jako bonus point warto pokryc:

- utworzenie zamowienia przez `ORDER_CREATED`,
- aktualizacje zamowienia przez `ORDER_UPDATED`,
- duplikat tego samego `eventId`,
- event starszy niz ostatni zaakceptowany,
- czesciowe zastosowanie eventu z kilkoma polami,
- event z brakujacymi polami w `payload`,
- niedozwolone `CANCELLED -> PAID`,
- dozwolone `PAID -> REFUNDED`,
- nieznany typ eventu,
- niepoprawny event,
- statystyki poprawnych, odrzuconych i zduplikowanych eventow,
- sredni czas przetwarzania.

## 16. Kontrola kompletnosci wzgledem `docs/zadanie_nodejs`

Ponizsza lista mapuje informacje z pliku zrodlowego na sekcje tej instrukcji.

| Informacja ze zrodla                               | Gdzie jest w instrukcji |
| -------------------------------------------------- | ----------------------- |
| Zadanie rekrutacyjne                               | Sekcja 1                |
| Kandydat powinien spedzic okolo 6-10 godzin        | Sekcja 1                |
| Czas na wykonanie to 3 MD                          | Sekcja 1                |
| W razie braku czasu oddac dzialajacy fragment      | Sekcje 1 i 13           |
| Temat: Event Processing Engine                     | Sekcja 1                |
| Firma ma wiele zewnetrznych integracji             | Sekcja 2                |
| Eventy przychodza asynchronicznie                  | Sekcja 2                |
| Event moze pojawic sie wielokrotnie                | Sekcje 2, 4 i 6.1       |
| Event moze przyjsc w zlej kolejnosci               | Sekcje 2, 4 i 6.2       |
| Event moze zostac opozniony                        | Sekcje 2, 4 i 6.2       |
| Event moze czesciowo nadpisywac poprzedni stan     | Sekcje 2, 4 i 6.4       |
| Stworzenie silnika dla systemu zamowien            | Sekcje 2, 4 i 14        |
| Format JSON eventu                                 | Sekcja 3                |
| `eventId`                                          | Sekcje 3 i 6.1          |
| `orderId`                                          | Sekcja 3                |
| `type`                                             | Sekcja 3                |
| `timestamp`                                        | Sekcje 3 i 6.2          |
| `payload.status` i `payload.amount`                | Sekcje 3, 6.3, 6.4 i 9  |
| Typ `ORDER_CREATED`                                | Sekcje 3 i 9.1          |
| Typ `ORDER_UPDATED`                                | Sekcje 3 i 9.2          |
| Typ `PAYMENT_CAPTURED`                             | Sekcje 3 i 9.3          |
| Typ `ORDER_CANCELLED`                              | Sekcje 3 i 9.4          |
| Typ `REFUND_ISSUED`                                | Sekcje 3 i 9.5          |
| Eventy moga miec konfliktujace dane                | Sekcje 4, 6.2 i 11      |
| Nie wszystkie eventy sa poprawne                   | Sekcje 4 i 7            |
| Czesc eventow moze byc przestarzala                | Sekcje 4 i 6.2          |
| System utrzymuje aktualny stan zamowienia          | Sekcje 4, 8.3 i 14      |
| System utrzymuje historie zmian                    | Sekcje 4, 8.4 i 14      |
| System utrzymuje audit log decyzji                 | Sekcje 4, 8.5 i 14      |
| System zapisuje surowe dostawy eventow             | Sekcje 8.1, 11 i 14     |
| System utrzymuje techniczny status przetwarzania   | Sekcje 8.2, 11 i 14     |
| `POST /events` przyjmuje batch eventow             | Sekcja 5.1              |
| `GET /orders/:id` zwraca aktualny stan             | Sekcja 5.2              |
| `GET /orders/:id` zwraca historie zmian            | Sekcja 5.2              |
| `GET /orders/:id` zwraca odrzucone eventy i powody | Sekcja 5.2              |
| `GET /stats` zwraca liczbe poprawnych eventow      | Sekcja 5.3              |
| `GET /stats` zwraca liczbe odrzuconych eventow     | Sekcja 5.3              |
| `GET /stats` zwraca liczbe duplikatow              | Sekcja 5.3              |
| `GET /stats` zwraca sredni czas przetwarzania      | Sekcja 5.3              |
| Deduplication: istniejacy `eventId` ignorowac      | Sekcja 6.1              |
| Deduplication: zapisac w audit logu                | Sekcja 6.1              |
| Ordering: starszy event wymaga decyzji             | Sekcja 6.2              |
| Ordering: odrzucic/czesciowo zastosowac/zmergowac  | Sekcja 6.2              |
| Kandydat proponuje strategie ordering              | Sekcja 6.2              |
| Niedozwolone przejscia stanu                       | Sekcja 6.3              |
| Przyklad `CANCELLED -> PAID` niemozliwe            | Sekcja 6.3              |
| Przyklad `PAID -> REFUNDED` poprawne               | Sekcja 6.3              |
| Kandydat definiuje state machine                   | Sekcja 6.3              |
| Partial updates z czescia danych                   | Sekcja 6.4              |
| Przyklad `payload.amount = 250`                    | Sekcja 6.4              |
| Brakujace pola nie moga byc usuwane                | Sekcja 6.4              |
| Wymagany Node.js                                   | Sekcja 10               |
| Wymagany TypeScript                                | Sekcja 10               |
| Wymagany Yarn                                      | Sekcja 10               |
| Wymagana lokalna baza SQLite                       | Sekcja 10               |
| Testy jednostkowe opcjonalne jako bonus            | Sekcje 10 i 15          |
| Krotkie README z zalozeniami i uruchomieniem       | Sekcje 10 i 12          |
| Mozna uzyc Express                                 | Sekcja 10               |
| Mozna uzyc Fastify                                 | Sekcja 10               |
| Mozna uzyc Nest                                    | Sekcja 10               |
| Mozna uzyc wlasnego minimalnego rozwiazania        | Sekcja 10               |
| Nie uzywac ORM generujacych cala logike            | Sekcja 10               |
| Nie uzywac gotowych workflow engine                | Sekcja 10               |
| Nie uzywac event sourcing frameworkow              | Sekcja 10               |
| Kod we wlasnym repozytorium GitHub                 | Sekcje 1 i 14           |

Wniosek z kontroli: wszystkie informacje wymaganiowe z `docs/zadanie_nodejs`
maja jawne odwzorowanie w tej instrukcji.
