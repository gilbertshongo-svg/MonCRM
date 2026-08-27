# MonCRM — Réception automatique des e-mails, WhatsApp et prospects Facebook

Ce dossier contient un serveur (Node.js) qui fait tourner votre CRM et reçoit
automatiquement :
- les **e-mails** entrants depuis un compte Gmail connecté,
- les **messages WhatsApp** entrants sur un numéro WhatsApp (API officielle Meta, gratuite),
- les **prospects** qui remplissent un formulaire sur vos publicités Facebook/Instagram.

Il permet aussi :
- d'**exporter** vos données en Excel, PDF ou Word (en plus du JSON complet),
- d'avoir **plusieurs utilisateurs**, chacun avec son propre e-mail et mot de passe,
- de voir les **statistiques** de vos campagnes publicitaires Facebook/Instagram.

Tout le code est déjà écrit. Il vous reste 4 choses à faire vous-même (je ne
peux pas les faire à votre place) :

1. Créer des identifiants Google (gratuit) pour autoriser l'accès à Gmail.
2. Créer un compte Meta for Developers (gratuit) pour recevoir des messages WhatsApp.
3. Connecter votre Page Facebook pour recevoir vos prospects publicitaires.
4. Déployer ce dossier sur un hébergeur gratuit (Render.com) pour que le
   serveur tourne en permanence avec une adresse publique.

Comptez environ **40-50 minutes** au total la première fois.

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

## Étape 3 — Connecter les prospects Facebook/Instagram (Lead Ads)

Nécessite d'avoir déjà une Page Facebook professionnelle et de diffuser (ou
prévoir de diffuser) des publicités avec formulaire **"Prospects"**. Utilise
la même application Meta que l'étape 2 (WhatsApp) — pas besoin d'en recréer
une.

1. Sur https://developers.facebook.com/, ouvrez votre app → menu de gauche →
   ajoutez le produit **Webhooks** si ce n'est pas déjà fait (**Ajouter un
   produit** → Webhooks → Configurer).
2. Toujours dans votre app, allez dans **Paramètres de l'app** → **De base**
   → repérez votre **App ID** et **App Secret** (pas nécessaires pour ce
   guide, mais utiles si un jour vous devez déboguer).
3. Obtenez un **jeton d'accès de Page** (Page Access Token) :
   - Allez sur **developers.facebook.com/tools/explorer** (Graph API Explorer).
   - En haut à droite, sélectionnez votre application dans la liste.
   - Bouton **Générer un token d'accès utilisateur**, autorisez les
     permissions `pages_show_list`, `pages_manage_ads`, `leads_retrieval`,
     `pages_read_engagement`.
   - Une fois le token utilisateur généré, changez le menu déroulant
     "Utilisateur ou Page" pour sélectionner **votre Page** — l'outil génère
     alors un **jeton d'accès de Page**. Copiez-le : ce sera votre
     `FACEBOOK_PAGE_ACCESS_TOKEN`.
   - ⚠️ Ce jeton expire après ~1h par défaut. Une fois que tout fonctionne,
     revenez ici pour le remplacer par un jeton longue durée (voir encadré
     ci-dessous).
4. Notez l'**ID de votre Page** (visible dans **Paramètres de la Page** sur
   Facebook, ou via le sélecteur de Page dans Graph API Explorer) — ce sera
   votre `FACEBOOK_PAGE_ID`.
5. Choisissez vous-même une chaîne secrète quelconque (différente de celle
   de WhatsApp), ce sera votre `FACEBOOK_LEADS_VERIFY_TOKEN`.

> **Jeton longue durée (recommandé avant usage réel)** : dans Graph API
> Explorer, utilisez l'outil **Access Token Debugger**
> (developers.facebook.com/tools/debug/accesstoken) pour échanger votre
> jeton de Page contre une version longue durée (~60 jours), ou passez par
> **Meta Business Suite** → **Utilisateurs système** comme pour WhatsApp
> pour un jeton qui n'expire jamais. Commencez avec le jeton court pour
> tester la connexion, vous pourrez le remplacer plus tard sans rien changer
> d'autre au code.

---

## Étape 4 — Déployer sur Render.com (gratuit)

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
   | `FACEBOOK_PAGE_ACCESS_TOKEN` | (étape 3) |
   | `FACEBOOK_PAGE_ID` | (étape 3) |
   | `FACEBOOK_LEADS_VERIFY_TOKEN` | (étape 3, la chaîne que vous avez inventée) |
   | `FACEBOOK_AD_ACCOUNT_ID` | *(optionnel)* Pour voir les statistiques de vos publicités dans l'onglet Intégrations — l'identifiant de votre compte publicitaire (Gestionnaire de publicités Meta → en haut à droite, format `123456789`, avec ou sans le préfixe `act_`) |
   | `ADMIN_RESET_TOKEN` | Une chaîne secrète inventée par vous — permet de réinitialiser votre mot de passe si vous êtes bloqué·e dehors (garder précieusement) |

6. Cliquez **Create Web Service**. Render construit et démarre le serveur
   (1-2 minutes). Une fois en ligne, copiez l'adresse fournie
   (`https://xxxx.onrender.com`).
7. Mettez à jour la variable `APP_BASE_URL` avec cette adresse exacte, et
   retournez dans Google Cloud (étape 1.5) pour vérifier que l'URI de
   redirection correspond bien à
   `https://xxxx.onrender.com/auth/google/callback`. Render redéploie
   automatiquement après un changement de variable.

### Stockage persistant — gratuit, via Upstash (recommandé)

Par défaut, Render **efface vos données à chaque nouveau déploiement** (le
disque du conteneur repart à zéro). Pour que vos contacts, messages,
utilisateurs et connexions Gmail/WhatsApp survivent à chaque mise à jour
**sans payer**, MonCRM peut stocker ses données sur **Upstash** — une petite
base de données (Redis) externe à Render, avec un plan gratuit à vie
largement suffisant pour un CRM personnel/petite structure.

1. Allez sur https://upstash.com → **Sign Up** (gratuit — connexion possible
   directement avec un compte Google/GitHub, aucune carte bancaire requise).
2. Une fois connecté : **Create Database**.
   - **Name** : `moncrm` (libre).
   - **Type** : Regional (le plus simple).
   - **Region** : choisissez la plus proche de vous (ex. un datacenter aux
     États-Unis si vous êtes au Canada).
   - **Create**.
3. Sur la page de la base créée, section **REST API**, copiez :
   - **`UPSTASH_REDIS_REST_URL`**
   - **`UPSTASH_REDIS_REST_TOKEN`**
4. Sur Render → votre service → **Environment** → ajoutez ces deux variables
   avec les valeurs copiées :

   | Clé | Valeur |
   |---|---|
   | `UPSTASH_REDIS_REST_URL` | (étape 3) |
   | `UPSTASH_REDIS_REST_TOKEN` | (étape 3) |

5. **Save Changes** — Render redéploie. Dans les journaux de démarrage
   ("Logs" sur Render), vous devriez voir la ligne *"Stockage : Upstash
   (persistant, survit aux redéploiements)"*.

À partir de là, vos données ne sont plus jamais perdues lors d'une mise à
jour — je pourrai déployer de nouvelles fonctionnalités sans que vous ayez à
recréer votre compte ou vos contacts.

> **Alternative payante** : Render propose aussi un vrai disque persistant
> attaché au serveur (~1$/mois, onglet **Disks** → variable `DATA_DIR`).
> Fonctionnellement équivalent à Upstash pour cet usage — inutile de faire
> les deux, Upstash suffit et reste gratuit.

⚠️ Le plan gratuit de Render peut aussi mettre le service en veille après 15
minutes d'inactivité (redémarrage en quelques secondes à la requête
suivante) — sans rapport avec le stockage, juste un léger délai occasionnel.
Le plan gratuit d'Upstash, lui, ne se met pas en veille.

---

## Étape 5 — Connecter les intégrations dans le CRM

1. Ouvrez `https://xxxx.onrender.com` (votre CRM en ligne).
2. Onglet **Intégrations** :
   - **E-mail (Gmail)** → cliquez **Connecter mon compte Gmail**, autorisez
     l'accès avec le compte Google ajouté comme testeur à l'étape 1.
   - **WhatsApp** → copiez l'**URL de webhook** affichée.
   - **Prospects Facebook/Instagram** → copiez l'**URL de webhook** affichée.
3. Pour WhatsApp : retournez sur developers.facebook.com → votre app →
   **WhatsApp** → **Configuration** → section **Webhook** → **Modifier** :
   - **Callback URL** : collez l'URL copiée à l'étape précédente.
   - **Verify token** : la même chaîne que `WHATSAPP_VERIFY_TOKEN`.
   - **Vérifier et enregistrer**, puis abonnez-vous au champ **messages**.
4. Pour les prospects : dans la même app → produit **Webhooks** → sélectionnez
   l'objet **Page** dans le menu déroulant → **Modifier l'abonnement** :
   - **URL de rappel** : l'URL de webhook prospects copiée.
   - **Verify token** : la même chaîne que `FACEBOOK_LEADS_VERIFY_TOKEN`.
   - **Vérifier et enregistrer**, puis cochez le champ **leadgen**.
   - Toujours sur cette page, section **Abonnements de la Page** : sélectionnez
     votre Page et cliquez **S'abonner** pour la lier à ce webhook.

C'est terminé : les e-mails reçus sont synchronisés toutes les 2 minutes, les
messages WhatsApp arrivent en temps réel, et chaque nouveau prospect
Facebook/Instagram devient automatiquement un contact avec une tâche de
suivi. Les e-mails/WhatsApp apparaissent dans l'onglet **Messages** du CRM,
rattachés automatiquement au bon contact (par e-mail ou numéro de
téléphone). Un message d'un expéditeur non enregistré apparaît comme
« Expéditeur inconnu » avec un bouton **Assigner**.

---

## Exporter vos données

Bouton **Exporter** dans la barre latérale → choisissez un format :
- **Excel / PDF / Word** : un rapport structuré (contacts, entreprises,
  pipeline, tâches, messages), prêt à consulter ou partager avec quelqu'un
  qui n'a pas accès au CRM.
- **JSON** : sauvegarde complète, réimportable via le bouton **Importer**.

---

## Ajouter d'autres utilisateurs

Réservé aux **administrateurs**. Onglet **Utilisateurs** (visible seulement
pour un compte admin) → **+ Nouvel utilisateur** → e-mail, mot de passe, et
cochez "Administrateur" si cette personne doit aussi pouvoir gérer les
utilisateurs. Chacun se connecte ensuite avec son propre e-mail et mot de
passe, sur la même adresse `https://xxxx.onrender.com`. Il n'y a pas
d'inscription libre : seul un administrateur peut créer un nouvel accès.

---

## Statistiques publicitaires Facebook/Instagram

Onglet **Intégrations** → si `FACEBOOK_AD_ACCOUNT_ID` est configuré, un
bouton **Charger les statistiques** affiche la dépense, les impressions, les
clics et les résultats de vos campagnes des 30 derniers jours.

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
- Un prospect Facebook/Instagram devient un **contact** (pas un message), avec
  une **tâche** "Contacter [nom]" créée pour le jour même — ainsi rien ne se
  perd dans la liste des tâches à faire.
