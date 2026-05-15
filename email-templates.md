# Email templates — RGPD & contact Deckrypt

Réponses pré-rédigées pour les demandes les plus fréquentes reçues sur
`deckrypt.mtg@gmail.com`. Tout est en français, prêt à copier-coller —
remplace `{PRÉNOM}` si tu veux personnaliser, sinon « Bonjour » seul
fonctionne.

## Principes de base

- **Délai légal : 1 mois** à compter de la réception (RGPD art. 12-3). Au-delà l'utilisateur peut saisir la CNIL. En pratique réponds sous 7 jours.
- **Vérification d'identité** : pour toute demande qui implique de **transmettre des données** (accès, portabilité) ou de **modifier le compte** (rectification, effacement), exige que l'email arrive **depuis l'adresse du compte**. Si l'adresse expéditrice ne matche pas, demande une preuve (capture de la page Paramètres avec l'UID partiel, ou réponse depuis l'email du compte).
- **Ne JAMAIS partager** : mot de passe (même haché), UID Firestore complet, captures de la console Firebase. Ce sont des éléments internes, pas des données personnelles à transmettre.
- **Suppression** : la suppression d'un compte par la console Firebase doit toujours suivre l'ordre Firestore → Auth (cf. `js/sync.js:deleteAccount` pour la même logique). Sinon un compte Auth orphelin peut rester sans moyen de wipe les données.

---

## 1. « Quelles données avez-vous sur moi ? » (art. 15 — droit d'accès)

**Sujet :** Re: Demande d'accès à mes données personnelles

> Bonjour {PRÉNOM},
>
> Merci pour votre message. Conformément à l'article 15 du RGPD, voici les données associées à votre compte Deckrypt :
>
> - **Adresse email** : celle utilisée pour vous connecter (la même que celle d'envoi de ce message).
> - **Pseudo** : si vous en avez défini un dans Paramètres → Compte.
> - **Mot de passe** : stocké sous forme de hash par Firebase Authentication. Je n'ai jamais accès au mot de passe en clair.
> - **Si connexion Google** : votre nom d'affichage et votre avatar Google, récupérés au moment de la connexion.
> - **Contenu** : la liste de vos decks (nom, description, format, cartes) et vos préférences (thème, langue d'affichage, vue par défaut).
> - **Métadonnées techniques** : dates de création et de dernière modification de chaque deck.
>
> Vous pouvez consulter ces données à tout moment depuis l'application elle-même, et exporter vos decks au format MTGA, Moxfield ou JSON via le menu « Exporter » de chaque deck.
>
> Aucune donnée n'est partagée à des tiers ni utilisée à des fins de marketing ou de profilage.
>
> Si vous souhaitez exercer un autre droit (rectification, effacement, portabilité), n'hésitez pas à me recontacter.
>
> Cordialement,
> Matthieu Boudinot — Deckrypt

---

## 2. « Supprimez mon compte » (art. 17 — droit à l'effacement)

**Cas A — l'utilisateur a encore accès à son compte.**

**Sujet :** Re: Suppression de compte Deckrypt

> Bonjour {PRÉNOM},
>
> La suppression de compte est disponible directement dans l'application : ouvrez **Paramètres → Compte → Zone à risque → Supprimer mon compte**. La suppression est immédiate et irréversible : vos decks, vos préférences et votre compte d'authentification sont effacés des serveurs.
>
> Pour des raisons de sécurité, Firebase exige une ré-authentification juste avant la suppression (votre mot de passe, ou un nouveau passage par Google).
>
> Si vous rencontrez un blocage, recontactez-moi avec la description du problème — je peux procéder manuellement.
>
> Cordialement,
> Matthieu Boudinot — Deckrypt

**Cas B — l'utilisateur n'arrive plus à se connecter (mdp perdu, compte Google supprimé, etc.).**

> Bonjour {PRÉNOM},
>
> Pour valider votre demande j'ai besoin de vérifier qu'il s'agit bien de votre compte. Pouvez-vous me confirmer par retour :
>
> - L'adresse email du compte (la même que celle d'envoi de ce message si possible),
> - La date approximative de création du compte ou le nom d'un de vos decks,
> - Le mode de connexion utilisé (email/mot de passe ou Google).
>
> Une fois ces éléments reçus, je procéderai à la suppression manuelle depuis la console d'administration sous 7 jours. Vous recevrez une confirmation par email une fois l'opération terminée.
>
> Cordialement,
> Matthieu Boudinot — Deckrypt

**Action côté admin (cas B uniquement)** — ordre obligatoire :
1. Firebase Console → Firestore Database → `/users/{uid}` → delete subtree (decks + meta).
2. Firebase Console → Authentication → Users → trouver l'email → « Delete account ».
3. Répondre à l'utilisateur pour confirmer.

---

## 3. « Changez / corrigez mes informations » (art. 16 — droit de rectification)

**Sujet :** Re: Modification de mes informations

> Bonjour {PRÉNOM},
>
> La plupart des informations sont modifiables directement depuis l'application :
>
> - **Pseudo et mot de passe** : Paramètres → Compte → bouton « Modifier » à côté de chaque champ.
> - **Email** : si vous êtes connecté(e) via Google, l'email se change depuis votre compte Google. Si vous êtes connecté(e) par email/mot de passe, le changement d'email n'est pas géré par l'app — la solution est de supprimer le compte actuel et d'en créer un nouveau avec la nouvelle adresse (les decks peuvent être exportés puis ré-importés).
> - **Contenu d'un deck (nom, description, cartes)** : ouvrez le deck dans la vue « Gérer », tout est éditable.
>
> Si l'information à corriger n'est dans aucune de ces catégories, dites-moi précisément ce que vous souhaitez changer et je vous indique la marche à suivre.
>
> Cordialement,
> Matthieu Boudinot — Deckrypt

---

## 4. « Donnez-moi mes données dans un format réutilisable » (art. 20 — portabilité)

**Sujet :** Re: Portabilité de mes données

> Bonjour {PRÉNOM},
>
> Vous pouvez exporter vos decks à tout moment depuis l'application : ouvrez le deck souhaité dans la vue « Gérer » → menu kebab (⋮) en haut à droite → **Exporter**. Quatre formats sont disponibles :
>
> - **MTGA** — copiable dans Magic: The Gathering Arena.
> - **Moxfield** — copiable dans la plupart des deckbuilders communautaires.
> - **Texte simple** — une ligne par carte.
> - **JSON** — format structuré (idéal pour ré-importer ailleurs ou archiver).
>
> Vos préférences (thème, langue) ne sont pas exportables en l'état — elles sont peu volumineuses et reconfigurables en 30 secondes sur un autre service. Si vous en avez besoin malgré tout, dites-le moi et je vous les transmettrai par email.
>
> Cordialement,
> Matthieu Boudinot — Deckrypt

---

## 5. « Opposition / limitation / retrait du consentement » (art. 18, 21)

**Sujet :** Re: Demande d'opposition / limitation

> Bonjour {PRÉNOM},
>
> Les traitements réalisés par Deckrypt sont strictement nécessaires à l'exécution du service que vous avez demandé : stocker vos decks, vous afficher leurs analyses, vous permettre de vous reconnecter d'un appareil à l'autre. Ils reposent sur la base légale « exécution du contrat » (RGPD art. 6.1.b), pas sur votre consentement, et aucun traitement à des fins de marketing, de prospection ou de profilage n'est effectué.
>
> En conséquence :
>
> - Le **droit d'opposition** (art. 21) ne s'applique pas aux traitements nécessaires à l'exécution du contrat. Si vous ne souhaitez plus que vos données soient traitées, la solution est de supprimer votre compte depuis **Paramètres → Compte → Zone à risque**, ou de me le demander si vous n'arrivez plus à vous connecter.
> - Le **droit à la limitation** (art. 18) n'est pas mis en œuvre techniquement : Deckrypt ne propose pas de fonctionnalité de « gel » de compte. Vos données restent inchangées tant que vous ne les modifiez pas.
> - Le **retrait du consentement** (art. 7-3) ne s'applique pas non plus, puisqu'aucun traitement n'est basé sur votre consentement.
>
> Vous conservez en revanche pleinement les droits d'accès, de rectification, d'effacement et de portabilité décrits dans la politique de confidentialité.
>
> Cordialement,
> Matthieu Boudinot — Deckrypt

---

## 6. Vérification d'identité (à envoyer si la demande arrive d'une adresse différente de celle du compte)

**Sujet :** Re: Vérification de votre identité

> Bonjour {PRÉNOM},
>
> Avant de pouvoir traiter votre demande, je dois vérifier que vous êtes bien le ou la titulaire du compte concerné. L'adresse depuis laquelle vous m'écrivez ne correspond pas à une adresse de compte Deckrypt actif.
>
> Pouvez-vous, au choix :
>
> - **Soit** me ré-écrire depuis l'adresse email du compte Deckrypt (option la plus rapide),
> - **Soit** me transmettre une copie d'écran de la page Paramètres → Compte de l'application, où le pseudo et l'email du compte sont visibles.
>
> Ce contrôle est imposé par l'article 12-6 du RGPD et nous protège l'un comme l'autre d'une demande frauduleuse.
>
> Une fois l'identité confirmée, je traite votre demande sous 7 jours.
>
> Cordialement,
> Matthieu Boudinot — Deckrypt

---

## Hors RGPD

### Signalement de bug / suggestion

Pas de modèle figé — réponds à ton rythme et selon ta dispo. Pas d'obligation légale de répondre, juste de la politesse de remercier.

### Demande de fonctionnalité

Idem. Pour mémoire, la roadmap est gardée dans `CLAUDE.md` du repo, pas exposée publiquement.

### Tentatives de phishing / scam

Reconnaissables à : urgence artificielle (« supprimez immédiatement »), demande de mot de passe, mention d'un compte que tu n'as pas créé, lien suspect dans un mail signé « équipe Deckrypt » (il n'y a pas d'équipe). **Supprime sans répondre.**

### Demande venant de la CNIL

Très peu probable mais possible. Reconnaissable au logo officiel et à un courrier postal en plus de l'email. **Réponds rapidement et précisément** — la CNIL est neutre tant que tu coopères, hostile si tu temporises. En cas de doute, contacte un avocat spécialisé avant de répondre.

---

## Tracker des demandes (optionnel)

Si tu veux garder une trace pour ton info : crée un libellé Gmail « RGPD » et applique-le à chaque échange. Pas d'obligation légale de tenir un registre formel pour un site personnel non-commercial (RGPD art. 30-5 exempte les organisations de moins de 250 personnes pour les traitements occasionnels), mais c'est utile si la CNIL demande un jour.
