# KinOS — MVP Implementation Loop

Process doc (not a spec). This is the instruction to drive autonomous MVP
implementation. Run it with `/loop` (no interval = self-paced) or `/loop 30m …`
for a fixed cadence. It enforces the repo's doc-before-code rule, TDD, the
invariants, and stops to ask the human rather than guessing past a design
ambiguity or an invariant.

Progress is tracked in `PROGRESS.md` at the repo root (the loop creates it).

## Loop instruction

```
GOAL: amener KinOS d'un repo spec-only à un MVP fonctionnel qui satisfait les
critères de validation MVP de docs/contracts/results-contract.md §19, sans
jamais violer docs/contracts/invariants-contract.md ni
docs/architecture/coding-principles.md.

Tu tournes en boucle d'implémentation auto-cadencée. À CHAQUE itération, fais UN
seul incrément petit et vérifiable vers le GOAL, puis termine le tour.

À chaque itération :
1. Oriente-toi. Lis PROGRESS.md (crée-le s'il manque) : état courant + prochaine
   étape. Survole `git log --oneline -10`.
2. Choisis la plus petite tranche utile suivante. Respecte l'ordre de dépendance :
   Identity/Sphere/Member -> Policy Engine -> Memory -> Capabilities/Bindings ->
   Runtime adapter -> intégrations/Packages -> UI.
3. Porte doc-before-code : si le comportement de la tranche n'est pas déjà défini
   par un doc ACCEPTÉ dans docs/, arrête le code et écris/étends d'abord la RFC ou
   l'ADR (modèle docs/rfcs/000-template.md), puis avance seulement si c'est
   cohérent avec les contrats. Le choix de stack lui-même exige un ADR
   d'implémentation accepté (il n'en existe aucun) -> c'est l'itération 1.
4. TDD : écris un test qui échoue encodant les critères d'acceptation de la
   tranche, puis le code minimal qui le fait passer. Respecte coding-principles.md
   (cœur domaine sans dépendance provider ; pas d'autorisation dans les prompts ;
   deny by default ; les capabilities sont l'API interne ; sécurité avant le
   runtime).
5. Vérifie : lance tests/build ; ne déclare aucun succès sans sortie verte.
6. Consigne : mets à jour PROGRESS.md (fait, décisions, prochaine étape). Commit
   petit et scoped sur une branche de feature (jamais directement sur main),
   message co-authored.
7. Conditions d'arrêt — termine la boucle et demande à l'humain quand : une
   décision de design est réellement ambiguë ou non couverte par les docs ; une
   action entrerait en conflit avec un invariant ; ou les tests ne passent pas
   après une passe de debug systématique. Ne devine jamais au-delà d'un invariant.

Définition de "terminé" : tous les critères de results-contract §19 passent de
façon démontrable (Sphere créée ; 2 adultes + 1 enfant ; un agent par membre ;
l'enfant ne peut pas lire la mémoire privée d'un adulte ; mémoire partageable
puis révocable ; une capability autorisée à un adulte et refusée à un enfant ;
une action sensible déclenche une approbation ; tourne sur un runtime de modèle
local ; données exportables). Une fois atteint, arrête la boucle et résume.
```
