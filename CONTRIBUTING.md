# Contribuer à Platforma

Merci pour votre intérêt pour ce projet. Ce document décrit la marche à suivre
pour proposer une contribution, qu'il s'agisse d'un correctif, d'une nouvelle
fonctionnalité ou d'une amélioration de la documentation.

## Prérequis

- Node.js 20 ou supérieur
- npm 9 ou supérieur
- Docker et Docker Compose (recommandé pour tester l'ensemble de la pile)

## Mise en place de l'environnement

```bash
git clone https://github.com/MedJegham/SOA-MiniProjet.git
cd SOA-MiniProjet/platforma
npm ci
cp .env.example ../platforma/.env   # adapter les valeurs selon votre poste
```

Pour lancer toute la plateforme localement :

```bash
docker-compose up --build
```

## Flux de contribution

1. **Forker** le dépôt et créer une branche depuis `main` :
   ```
   git checkout -b feat/ma-fonctionnalite
   ```
2. **Coder** votre modification. Respectez le style existant (ESLint).
3. **Tester** localement :
   ```
   npm run lint
   npm test
   ```
4. **Commiter** en suivant la convention Conventional Commits :
   - `feat: ...` pour une nouvelle fonctionnalité
   - `fix: ...` pour un correctif de bug
   - `chore: ...` pour de la maintenance
   - `docs: ...` pour la documentation
   - `ci: ...` pour les workflows CI/CD
   - `refactor: ...` pour un refactoring sans changement de comportement
5. **Ouvrir une Pull Request** vers `main` avec une description claire :
   - Quel problème la PR résout-elle ?
   - Comment l'avez-vous testée ?
   - Y a-t-il des points d'attention pour la revue ?

## Style de code

- Le code est en JavaScript (CommonJS), Node 20+.
- ESLint est configuré dans `platforma/.eslintrc.js`. Aucune erreur ne doit
  rester avant de proposer une PR.
- Les commentaires de code doivent expliquer le **pourquoi**, pas le **quoi**.
- La langue des commentaires et des messages de commit est le français.

## Tests

- Tests unitaires : `npm run test:unit`
- Tests d'intégration : `npm run test:integration` (nécessite Kafka et
  les services gRPC en cours d'exécution)
- Couverture : `npm run test:coverage`

## Signaler un bug

Ouvrez une issue sur GitHub avec :
- Une description du comportement attendu et du comportement observé
- Les étapes de reproduction minimales
- La version de Node et l'OS utilisés
- Les logs pertinents (sans informations sensibles)

## Licence

En contribuant, vous acceptez que votre code soit publié sous la licence MIT
du projet (voir `LICENSE`).
