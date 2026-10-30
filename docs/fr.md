# Feux de forêt au Canada (SCIFV, RNCan) pour Gladys

Connecteur **non officiel**, sans lien avec Ressources naturelles Canada. Il lit
les couches publiques du **Système canadien d'information sur les feux de
végétation** (SCIFV, `cwfis.cfs.nrcan.gc.ca`), sans compte ni clé, et donne pour
chaque maison localisée de Gladys :

| Fonction                        | Ce que c'est                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Points chauds satellite (24 h)  | nombre de détections de chaleur des dernières 24 heures dans le rayon                                         |
| Point chaud le plus proche (km) | sa distance ; s'il n'y en a aucun dans le rayon, **le rayon lui-même** (« aucun plus proche »), jamais 0      |
| Périmètres de feu actifs        | périmètres estimés (couche M3) touchés par un point chaud depuis 72 h, dans le rayon (Canada seulement)       |
| Périmètre actif le plus proche  | distance à son contour, 0 si la maison est dedans ; sans périmètre, le rayon                                  |
| Indice forêt-météo (IFM)        | l'IFM (FWI) de la station météo-feu la plus proche avec un relevé de moins de 36 h, à 200 km au plus, arrondi |
| Station météo-feu               | nom, province, distance et heure du relevé de cette station                                                   |
| Danger d'incendie               | classe de la carte nationale à la maison : 1 bas, 2 modéré, 3 élevé, 4 très élevé, 5 extrême (Canada)         |

Et deux déclencheurs de scène : **point chaud à moins d'une distance** et
**danger d'incendie en hausse**.

**Les points chauds sont des détections de chaleur par satellite, pas des feux
confirmés** : une torchère, une usine, un brûlage agricole en donnent aussi, et
leur heure a quelques heures de retard sur le passage du satellite. La couche
couvre l'Amérique du Nord ; les périmètres et la carte du danger couvrent le
Canada. C'est une information, pas un système d'alerte ni d'évacuation : suivez
les consignes de votre province et de votre municipalité.

Jamais testé avec un vrai appareil (il n'y en a pas : c'est un service public).
Le module a été essayé contre le vrai service le 2026-10-29 (Fredericton,
Kamloops, Portland) et ses tests rejouent des réponses réelles de ce jour-là.

Contient des informations visées par la Licence du gouvernement ouvert – Canada
(Ressources naturelles Canada, SCIFV).

## Installation

1. Installez l'intégration depuis le magasin de Gladys. Elle demande l'accès à
   la **position des maisons** (Paramètres > Maisons) : c'est ce qui place les
   maisons sur la carte.
2. Renseignez la position d'au moins une maison dans Gladys.
3. Facultatif : changez le **rayon** (50 km par défaut, de 5 à 300 km),
   l'**intervalle de lecture** (30 minutes par défaut, de 15 à 180) et la
   **langue** des noms d'appareils et des directions.
4. Ouvrez la **Découverte** : une maison localisée y est proposée (5 au plus).
   Créez l'appareil : les lectures commencent alors, à la prochaine échéance.

## Ce qui est lu, et quand

À chaque lecture, une requête à la fois, une seconde au moins entre deux :

- la date du point chaud le plus récent de toute la couche, et de la dernière
  mise à jour des périmètres : la fraîcheur des deux couches ;
- la date de la carte du danger (légende du serveur cartographique) ;
- sans appareil créé, ou si la maison d'un appareil a disparu, rien n'est
  envoyé : les maisons de Gladys sont regardées de nouveau chaque minute ;
- pour chaque maison qui a son appareil : les points chauds et les périmètres
  dans une boîte qui contient le rayon, les stations à 200 km, et la carte du
  danger à 25 km autour de la case de la maison (relue avec une nouvelle date de
  carte, ou après 6 heures). Pour une maison hors du Canada, ni les périmètres
  ni la carte du danger ne sont demandés.

Votre position exacte n'est pas envoyée : toutes les boîtes sont construites à
partir de la seule case de 0,1° × 0,1° qui contient la maison (environ 11 km ×
7 km), si bien que les recouper ne dit rien de plus fin que cette case ; les
distances sont calculées dans Gladys. Près de la ligne de changement de date
(Aléoutiennes), la boîte fait le tour de la Terre.
Le serveur ne propose ni `ETag` ni `Last-Modified` : l'intervalle est le seul
frein, et la lecture suivante ne part pas plus tôt que l'intervalle, ni après
un redémarrage (l'heure de la dernière lecture est gardée dans `/data`), ni
par le bouton **Tester**, la Découverte ou la création d'un appareil.

## Pas de valeur inventée

- Couche des points chauds vide, ou point chaud le plus récent de plus de 18 h :
  la source est muette ou périmée, les points chauds ne sont **pas publiés** (ni 0) et le statut le dit.
- Périmètres sans mise à jour depuis 7 jours (fin de saison) : non publiés.
- Les périmètres et la carte du danger couvrent le Canada seulement. « Au
  Canada » est décidé dans Gladys, sur un contour du Canada et des États-Unis
  embarqué (Natural Earth 1:10m, domaine public, simplifié : 217 Ko) : exact le
  long du 49e parallèle, et une maison à moins de 1 km de la frontière ailleurs
  (rivières Sainte-Croix, Détroit, Saint-Clair, Niagara, Saint-Laurent,
  Sainte-Marie, à la Pluie ; Stanstead) est « impossible à dire ». Hors du
  Canada ou dans le doute : ni périmètres ni danger (rien plutôt qu'un faux 0),
  et le statut dit pourquoi. Une rive canadienne (à moins de 10 km du contour)
  compte comme le Canada.
- Classe de danger : celle de la zone de la carte qui contient la maison, sinon
  celle de la zone la plus proche à moins de 25 km (la carte laisse de côté les
  rives et les grandes villes : Toronto est à 1,5 km de la zone la plus proche,
  Montréal à 0,4 km), la distance étant dite dans le statut. Au-delà de 25 km
  (le Grand Nord peut ne pas être couvert, Iqaluit par exemple) : pas de classe,
  et le statut le dit.
- Un enregistrement illisible (champ renommé, date sans fuseau, géométrie sans
  contour, classe de danger inconnue) ou une réponse coupée à sa taille de page :
  pour les périmètres et la carte du danger, la partie n'est pas publiée et le
  statut dit pourquoi. Pour les points chauds, jusqu'à un dixième
  d'enregistrements illisibles, ou plus de 20 000 points chauds dans la boîte,
  les points lisibles sont publiés comme un **minimum** (« au moins N » dans le
  statut) et le plus proche n'est pas publié ; au-delà d'un dixième, rien.
- Aucune station avec un relevé de moins de 36 h et un IFM à 200 km : IFM et
  station non publiés (hors saison, de novembre à mars, c'est le cas normal).
- Carte du danger datée de plus de 2 jours : danger non publié. Si sa date est
  illisible, la carte est lue quand même (une date inconnue ne la rend pas
  périmée).
- Une partie qui échoue (erreur HTTP, réponse trop grosse, rapport d'erreur du
  serveur) n'empêche pas les autres d'être lues et publiées.
- Les valeurs qui n'ont pas changé sont renvoyées toutes les 3 heures, pour
  rester datées.
- `/data` illisible au démarrage, impossible à écrire ou qui ne répond plus : les
  lectures continuent (une écriture est attendue 2 secondes au plus) et le statut
  le dit, car un redémarrage ne garderait alors ni l'intervalle ni la pause.
- Une configuration enregistrée pendant une lecture l'abandonne (rien n'en est
  publié) : la suivante vient à l'échéance de l'intervalle, avec la nouvelle
  configuration.

## Déclencheurs de scène

- **Point chaud à moins d'une distance** (5 à 300 km) : un point chaud apparaît
  plus près que la distance choisie alors qu'il n'y en avait aucun à la lecture
  précédente. Une seule fois par épisode : il se réarme après deux lectures de
  suite sans aucun point chaud à cette distance. Au-delà du rayon de la
  configuration, c'est le rayon qui compte. Variables : distance (km), direction
  (N, NE...), cap, nombre, heure de la détection, satellite.
- **Danger d'incendie en hausse** : la classe atteint le niveau choisi (modéré,
  élevé, très élevé, extrême) en venant d'en dessous ; un saut de bas à élevé
  déclenche « modéré » et « élevé ». Variables : niveau actuel et son nom,
  niveau précédent, IFM de la station, date de la carte.

Rien ne se déclenche à la première lecture d'une maison (pas de valeur d'avant
connue). La mémoire des déclencheurs est gardée dans `/data` 48 heures, ce qui
permet à un redémarrage de voir une hausse survenue entre-temps.

## Statut

Le statut de la page de configuration dit l'heure de la dernière lecture, ce qui
a été lu pour chaque maison, ce qui ne l'a pas été et pourquoi (couche périmée,
hors saison, hors du Canada, erreur), et rappelle que les points chauds ne sont
pas des feux confirmés. Le serveur qui demande d'attendre (HTTP 429 ou 5xx) met
les lectures en pause de 1 minute à 6 heures (doublée à chaque fois, ou le
`Retry-After` s'il est plus long), pause gardée dans `/data`. Serveur
injoignable : nouvel essai à l'intervalle suivant.

Le bouton **Tester** lit tout de suite si une lecture est due, sinon il montre
la dernière et l'heure de la suivante. Sans appareil créé, il fait une seule
petite requête (la fraîcheur des points chauds), comptée comme la lecture.

## Dépannage

- **« Aucune maison localisée »** : renseignez la position d'une maison dans
  Gladys (Paramètres > Maisons), puis relancez la Découverte.
- **« Les maisons de Gladys n'ont pas pu être lues »** : l'accès à la position
  a été refusé à l'intégration ; nouvel essai chaque minute, sans requête au
  SCIFV.
- **IFM absent en hiver** : normal, les stations météo-feu ne publient que
  pendant la saison des feux.

## Données et licence

Source : Ressources naturelles Canada, Système canadien d'information sur les
feux de végétation (<https://cwfis.cfs.nrcan.gc.ca/>), couches WFS
`hotspots_last24hrs`, `m3_polygons_current`, `firewx_stns_current`,
`fdr_current_shp`. Licence du gouvernement ouvert – Canada
(<https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada>).
L'intégration s'annonce au serveur sous son nom (`User-Agent:
gladys-feux-canada/0.1.0`), jamais comme un navigateur.
