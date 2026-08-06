# MeetUp Maestro

Bonjour. Création d'un Agent IA qui gère en automatique les demandes de rendez-vous client de l'utilisateur. Lorsque l'utilisateur reçois un mail dans sa boîte Gmail, l'Agent IA détecté en automatique si le mail contient une demande de rendez-vous. L' Agent IA après avoir détecté la demande de rendez-vous vérifie l'agenda de l'utilisateur dans son Google Calendar, pour voir si le créneau demandé par l'utilisateur est libre. Ensuite, l' Agent envoie un mail au client pour lui dire si oui ou non le créneau est disponible: -si oui l'agent demande la confirmation au client. ; -sinon il demande à l'utilisateur de choisir un autres créneau en proposant au client des créneaux de libres de manières intelligentes. L'agent engage la conversation réellement et peut demandé au client plus d'informations pour pouvoir lui proposer le meilleur créneau possible selon ses disponibilités. L'agent agit de manière autonome pour analysé chaque demande de l'utilisateur, les analyser et les comprendre pour renvoyé une réponse logique et cohérente. L' objectif est d'être à l'écoute du client pour lui trouver le meilleurs créneau de rendez-vous possible selon ses besoins. L'utilisateur crée son compte et accède à l'app après confirmation de son compte par son adresse mail. L' interface de l' Agent IA est ultra haute performance et high-tech codé avec des techniques de codage nouvelles générations. Il y a des onglets pertinents qui permet à l'utilisateur de gérer l' Agent IA, de voir les activités de l'Agent IA, et de le paramétrer en profondeur pour avoir un Agent IA personnalisé sur-mesure. J'ai connecté mon compte Google OAuth 2.0 dans l'espace secret de ce projet pour pouvoir connecté Gmail et Google Calendar (regarde ci-joint). Lovable Cloud est connecté avec la persistance des données de l'utilisateur en temps réel. Lovable AI est connecté, avec tout les Edge Functions activés, pour gérer toutes les fonctionnalités de l' Agent IA.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://agentmaily.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/b9920c2c-3fd4-4f38-896d-993da149405a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
