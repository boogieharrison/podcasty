# Podcasty

Prywatna lista odcinków z wybranych kanałów YouTube. Automat na GitHubie co godzinę
czyta kanały RSS i odświeża stronę.

## Uruchomienie (jednorazowo)

1. Załóż darmowe konto na github.com i utwórz nowe repozytorium **Public** (np. `podcasty`).
2. Wgraj do niego całą zawartość tego folderu, łącznie z ukrytym folderem `.github`
   (Add file → Upload files; folder `.github` najłatwiej przeciągnąć z rozpakowanego ZIP-a).
3. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. Settings → Actions → General → Workflow permissions: **Read and write permissions**.
5. Zakładka Actions → „Zbierz odcinki i opublikuj stronę” → Run workflow.
6. Adres strony pojawi się w Settings → Pages (zwykle `https://<login>.github.io/podcasty/`).

## Dodawanie podcastów

Edytuj `channels.json` (ikona ołówka na GitHubie) i wpisz linki do kanałów lub playlist:

```json
[
  "https://www.youtube.com/@nazwakanalu",
  { "url": "https://www.youtube.com/playlist?list=PL...", "name": "Własna nazwa" }
]
```

Żeby z dużego kanału wziąć tylko jedną audycję, dodaj `match` – zostaną tylko filmy
z tym tekstem w tytule:

```json
{ "url": "https://www.youtube.com/channel/UCUtQqcVDOl4_AKQh7rqfMPg", "name": "Nasłuch", "match": "| Nasłuch" }
```

Po zapisaniu (Commit changes) automat uruchomi się sam; odcinki pojawią się po 1–2 minutach.

## Pojedyncze odcinki

Pole „Link do odcinka z YouTube” nad listą dodaje jeden film bez śledzenia całego kanału.
Takie odcinki są w filtrach jako „Pojedyncze odcinki”; przycisk ✕ usuwa je z listy.

## Synchronizacja między urządzeniami

Stan odsłuchu, odłożone i dodane odcinki oraz filtry mogą być wspólne dla wszystkich urządzeń.
Trzymane są w prywatnym (secret) giście na Twoim koncie GitHub.

1. Utwórz token: https://github.com/settings/tokens/new?scopes=gist&description=Podcasty%20sync
   (zaznaczone tylko „gist”, Expiration: No expiration) i skopiuj go.
2. Na stronie: Kanały i filtry → Synchronizacja → wklej token → Połącz.
3. Na kolejnym urządzeniu: kliknij „Link dla innego urządzenia” i otwórz ten link tam
   (albo wklej token ręcznie). Link zawiera token – nie wysyłaj go nikomu.

## Co gdzie jest

- `index.html` – cała aplikacja
- `channels.json` – lista kanałów
- `scripts/fetch.mjs` – zbieranie odcinków
- `data/` – zebrane odcinki (plik zapisuje automat)
