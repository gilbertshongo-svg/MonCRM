# MonCRM — Réception automatique des e-mails et messages WhatsApp

Ce dossier contient un serveur (Node.js) qui fait tourner votre CRM et reçoit
automatiquement :
- les **e-mails** entrants depuis un compte Gmail connecté,
- les **messages WhatsApp** entrants sur un numéro WhatsApp (API officielle Meta, gratuite).

Tout le code est déjà écrit. Il vous reste 3 choses à faire vous-même (je ne
peux pas les faire à votre place) :

1. Créer des identifiants Google (gratuit) pour autoriser l'accès à Gmail.
2. Créer un compte Meta for Developers (gratuit) pour recevoir des messages WhatsApp.
3. Déployer ce dossier sur un hébergeur gratuit (Render.com) pour que le
   serveur tourne en permanence avec une adresse publique.

Comptez environ **30-40 minutes** au total la première fois.

---

## Étape 0 — Tester en local (optionnel mais recommandé)

Avant de déployer, vous pouvez vérifier que tout fonctionne sur votre PC :

```bash
cd CRM-Server
npm install
npm start
```

Puis ouvrez http://localhost:3000 — vous devriez voir le CRM, avec un onglet
**Intégrations** indiquant "Non configuré" (normal, tant que les étapes
ci-dessous ne sont pas faites).

Si vous aviez déjà utilisé l'ancienne version du CRM (fichier unique
`index.html`), utilisez son bouton **Exporter** pour télécharger vos données,
puis le bouton **Importer** de cette nouvelle version pour les récupérer.

---

## Étape 1 — Connecter Gmail (gratuit)

1. Allez sur https://console.cloud.google.com/ et connectez-vous avec le
   compte Google que vous utiliserez pour le CRM.
2. En haut, cliquez sur le sélecteur de projet → **Nouveau projet**. Donnez-lui
   un nom (ex. "MonCRM"), puis créez-le.
3. Menu ☰ → **API et services** → **Bibliothèque**. Cherchez **Gmail API** et
   cliquez **Activer**.
4. Menu ☰ → **API et services** → **Écran de consentement OAuth**.
   - Type d'utilisateur : **Externe**, puis Créer.
   - Renseignez un nom d'application ("MonCRM"), votre e-mail comme contact,
     puis Enregistrer et continuer sur les écrans suivants (les scopes/testeurs
     peuvent rester vides pour l'instant).
   - Sur l'écran **Utilisateurs de test**, ajoutez votre propre adresse Gmail.
     C'est cette étape qui vous permet d'utiliser l'appli sans validation
     Google (réservée à un usage personnel/petite structure).
5. Menu ☰ → **API et services** → **Identifiants** → **Créer des
   identifiants** → **ID client OAuth**.
   - Type d'application : **Application Web**.
   - Nom : "MonCRM Server".
   - **URI de redirection autorisés** : ajoutez
     `https://VOTRE-ADRESSE-RENDER.onrender.com/auth/google/callback`
     (vous obtiendrez cette adresse à l'étape 3 — vous pourrez revenir ici
     pour la compléter ensuite ; en attendant, mettez aussi
     `http://localhost:3000/auth/google/callback` pour pouvoir tester en
     local).
6. Notez le **Client ID** et le **Client Secret** affichés — vous les
   collerez dans les variables d'environnement à l'étape 3.

---

## Étape 2 — Connecter WhatsApp (gratuit, API officielle Meta)

Cette méthode respecte les conditions d'utilisation de WhatsApp (pas de
risque de blocage de votre numéro), contrairement aux outils "non officiels".
En contrepartie, Meta impose un mode test au départ.

1. Allez sur https://developers.facebook.com/ et connectez-vous (ou créez un
   compte Facebook si besoin — un compte personnel suffit).
2. **Mes apps** → **Créer une application** → type **Autre** → **Entreprise**
   → donnez un nom (ex. "MonCRM") → Créer l'application.
3. Dans le tableau de bord de l'app, trouvez le produit **WhatsApp** →
   **Configurer**.
4. Vous arrivez sur la page **API Setup**. Vous y trouvez :
   - Un **numéro de téléphone de test** fourni gratuitement par Meta (déjà actif).
   - Un **identifiant de numéro de téléphone** ("Phone number ID") — notez-le.
   - Un **jeton d'accès temporaire** ("Temporary access token", valable 24h)
     — notez-le pour un premier test. Pour un usage durable, voir l'encadré
     "Jeton permanent" plus bas.
5. Toujours sur cette page, section **To** : ajoutez **votre propre numéro de
   téléphone** (celui avec lequel vous voulez tester l'envoi) et vérifiez-le
   par le code reçu. Tant que l'app reste en mode test, vous ne pourrez
   **envoyer** des réponses qu'à des numéros ajoutés ainsi (5 maximum) — mais
   **recevoir** des messages fonctionne depuis n'importe quel numéro dès
   l'étape suivante.
6. Choisissez vous-même une chaîne secrète quelconque (ex.
   `moncrm-verify-8x2k9`) — ce sera votre `WHATSAPP_VERIFY_TOKEN`, à utiliser
   à l'étape 7.

> **Jeton permanent (recommandé avant de partir en usage réel)** : un jeton
> temporaire expire après 24h. Pour un jeton durable, allez dans
> **Meta Business Suite** → **Paramètres de l'entreprise** → **Utilisateurs
> système** → créez un utilisateur système avec le rôle Admin, générez un
> jeton pour l'app WhatsApp avec les permissions `whatsapp_business_messaging`
> et `whatsapp_business_management`, sans date d'expiration. Ce guide reste
> volontairement simple : commencez avec le jeton temporaire pour tester,
> vous pourrez le remplacer plus tard sans rien changer d'autre.

---

## Étape 3 — Déployer sur Render.com (gratuit)

1. Ce dossier doit être dans un dépôt Git (GitHub, GitLab...). Si ce n'est
   pas déjà fait, créez un dépôt et poussez le contenu de `CRM-Server/`
   dedans (le fichier `.gitignore` fourni exclut déjà `.env` et vos données
   — ne les committez jamais).
2. Créez un compte sur https://render.com (gratuit).
3. **New +** → **Web Service** → connectez votre dépôt GitHub.
4. Renseignez :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
5. Dans l'onglet **Environment**, ajoutez ces variables (valeurs des étapes
   1 et 2) :

   | Clé | Valeur |
   |---|---|
   | `APP_BASE_URL` | `https://VOTRE-ADRESSE.onrender.com` (vous la connaîtrez après le premier déploiement — mettez-la à jour ensuite) |
   | `GOOGLE_CLIENT_ID` | (étape 1) |
   | `GOOGLE_CLIENT_SECRET` | (étape 1) |
   | `WHATSAPP_ACCESS_TOKEN` | (étape 2) |
   | `WHATSAPP_PHONE_NUMBER_ID` | (étape 2) |
   | `WHATSAPP_VERIFY_TOKEN` | (étape 2, la chaîne que vous avez inventée) |

6. Cliquez **Create Web Service**. Render construit et démarre le serveur
   (1-2 minutes). Une fois en ligne, copiez l'adresse fournie
   (`https://xxxx.onrender.com`).
7. Mettez à jour la variable `APP_BASE_URL` avec cette adresse exacte, et
   retournez dans Google Cloud (étape 1.5) pour vérifier que l'URI de
   redirection correspond bien à
   `https://xxxx.onrender.com/auth/google/callback`. Render redéploie
   automatiquement après un changement de variable.

⚠️ **Important sur le plan gratuit de Render** : le service peut se mettre en
veille après 15 minutes d'inactivité et redémarrer à la prochaine requête
(quelques secondes de latence), et le stockage n'est pas garanti après un
nouveau déploiement. Pour un usage professionnel régulier, envisagez de
passer au plan payant de Render pour un disque persistant, ou exportez
régulièrement vos données avec le bouton **Exporter**.

---

## Étape 4 — Connecter les intégrations dans le CRM

1. Ouvrez `https://xxxx.onrender.com` (votre CRM en ligne).
2. Onglet **Intégrations** :
   - **E-mail (Gmail)** → cliquez **Connecter mon compte Gmail**, autorisez
     l'accès avec le compte Google ajouté comme testeur à l'étape 1.
   - **WhatsApp** → copiez l'**URL de webhook** affichée.
3. Retournez sur developers.facebook.com → votre app → **WhatsApp** →
   **Configuration** → section **Webhook** → **Modifier** :
   - **Callback URL** : collez l'URL copiée.
   - **Verify token** : la même chaîne que `WHATSAPP_VERIFY_TOKEN`.
   - **Vérifier et enregistrer**, puis abonnez-vous au champ **messages**.

C'est terminé : les e-mails reçus sont synchronisés toutes les 2 minutes, et
les messages WhatsApp arrivent en temps réel. Ils apparaissent dans l'onglet
**Messages** du CRM, rattachés automatiquement au bon contact (par e-mail ou
numéro de téléphone). Un message d'un expéditeur non enregistré apparaît
comme « Expéditeur inconnu » avec un bouton **Assigner**.

---

## Ce que le CRM fait / ne fait pas

- Un message **envoyé** (e-mail ou WhatsApp) depuis le CRM est réellement
  transmis au contact via Gmail/WhatsApp.
- Les appels et SMS restent un **journal manuel** (vous les notez vous-même)
  — les recevoir automatiquement nécessiterait un service payant comme
  Twilio.
- En mode test Meta, l'**envoi** de messages WhatsApp ne fonctionne que vers
  les numéros ajoutés comme destinataires vérifiés (étape 2.5). La
  **réception** fonctionne déjà depuis n'importe quel numéro. Pour lever
  cette limite d'envoi, Meta demande une vérification d'entreprise
  (Meta Business Suite → Paramètres de l'entreprise → Vérification).
