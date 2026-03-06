# 🎾 Padel Planner

Boekingsapp voor padel banen — plan samen je potjes met vrienden.

## Functionaliteiten

- Registreren & inloggen (wachtwoord beveiligd)
- Boeking aanmaken met locatie, datum en tijd
- Inschrijven als speler (max 4) of extra man (5e plek)
- Automatische promotie: extra wordt speler als iemand uitschrijft
- Alleen de aanmaker kan een boeking verwijderen

---

## Lokaal draaien

```bash
npm install
npm start
# → http://localhost:3000
```

---

## Online zetten via Railway (gratis proberen)

### Stap 1 — Maak een Railway account
Ga naar [railway.app](https://railway.app) en log in met GitHub.

### Stap 2 — Nieuw project aanmaken
1. Klik op **"New Project"**
2. Kies **"Deploy from GitHub repo"**
3. Selecteer de repo **ChefJoost/Padel**
4. Railway detecteert Node.js automatisch en start de deployment

### Stap 3 — Persistente schijf toevoegen (voor de database)
Zonder dit raakt de database leeg bij elke herstart.

1. Klik op je service in Railway
2. Ga naar het tabblad **"Volumes"**
3. Klik **"Add Volume"**
4. Stel in:
   - **Mount path**: `/data`
5. Klik **"Add"**

### Stap 4 — Omgevingsvariabelen instellen
1. Ga naar het tabblad **"Variables"**
2. Voeg toe:

| Variable | Waarde |
|---|---|
| `DATA_DIR` | `/data` |
| `SESSION_SECRET` | een willekeurige lange string (bijv. `mijn-geheim-abc123xyz`) |

### Stap 5 — Publieke URL instellen
1. Ga naar het tabblad **"Settings"**
2. Klik onder **"Networking"** op **"Generate Domain"**
3. Je krijgt een URL zoals `padel-planner.up.railway.app`

### Stap 6 — Deel de link
Stuur de URL naar je vrienden — zij kunnen zich registreren en direct meedoen!

---

## Omgevingsvariabelen

| Variable | Standaard | Beschrijving |
|---|---|---|
| `PORT` | `3000` | Poort waarop de server draait |
| `DATA_DIR` | `./data` | Map voor SQLite database bestanden |
| `SESSION_SECRET` | *(hardcoded fallback)* | Geheime sleutel voor sessies — **verander dit in productie!** |
