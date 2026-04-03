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

Zie `.env.example` voor een volledig overzicht. De belangrijkste:

| Variable | Standaard | Beschrijving |
|---|---|---|
| `SESSION_SECRET` | *(dev fallback)* | **Verplicht in productie.** Genereer met `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_USERNAME` | `joosts` | Gebruikersnaam die admin-rechten krijgt bij eerste start (alleen als er nog geen admin bestaat) |
| `DATA_DIR` | `./data` | Map voor SQLite database bestanden |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | *(auto-gegenereerd)* | Stel in via Railway Variables zodat push-keys overleven na herstart |
| `PORT` | `3000` | Poort waarop de server draait |

---

## Toekomstige verbeterpunten

### Avatar-opslag migreren van database naar bestandssysteem

Avatars worden momenteel opgeslagen als base64 data-URL in de SQLite-database.
Dit werkt prima voor kleine groepen, maar schaalt slecht bij meer gebruikers
(database groeit snel, elke pagina-load verstuurt grote blobs).

**Stappenplan wanneer je wil migreren:**

1. **Kies een opslaglocatie**
   - *Eenvoudigst:* lokale map (`/data/avatars/`) op het persistent volume
   - *Schaalbaarder:* object storage zoals Cloudflare R2, AWS S3 of Supabase Storage

2. **Upload-endpoint toevoegen** (`POST /api/auth/avatar`)
   - Ontvang multipart/form-data (`multer`-package)
   - Valideer bestandstype (alleen `image/jpeg`, `image/png`, `image/webp`)
   - Sla op als `{userId}.jpg` of gebruik een UUID als bestandsnaam
   - Sla het pad/de URL op in `users.avatar` in plaats van de base64 string

3. **Statische bestanden serveren**
   - Lokaal: `app.use('/avatars', express.static('/data/avatars'))`
   - Object storage: gebruik de publieke CDN-URL direct

4. **Frontend aanpassen**
   - `handleAvatarChange()` en `handleWelcomeAvatarChange()` in `app.js`:
     stuur `FormData` naar het nieuwe upload-endpoint i.p.v. base64 in JSON
   - `renderAvatarEl()` blijft ongewijzigd (gebruikt al een URL)

5. **Bestaande base64 avatars migreren**
   - Schrijf een eenmalig migratiescript dat alle `users` met een data-URL avatar
     omzet naar een bestand en de database bijwerkt
