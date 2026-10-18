"""Species: genome clustering with persistent ids, names and a phylogeny (M6).

Once a day the species subsystem looks at the living creatures. Every creature keeps the
species it was given. A newcomer takes the species of its genetically nearest relative:
a labelled creature of its lineage (`Fauna.origin`, the arrival it descends from through
its mother). Creatures of a lineage the island has not seen found a new root species.

A species is the creatures that can interbreed, directly or through others: genomes
within the mating distance (`FaunaConfig.compat_distance`, all genes). When a species'
members fall into separate groups of at least ``min_members`` that stay apart for
``split_days``, the largest group keeps the species and every other group becomes a
daughter species. A species dies with its last member. Ids are never reused: species
``k`` is row ``k - 1`` of every record array, so the parent of a species always has a
smaller id and the phylogeny is a forest with one root per arrival.

Names are syllables read off the genome. A root species takes three syllables from three
pairs of genes; a daughter keeps the first two syllables of its parent's name and adds
one for the gene it diverged on most, so a lineage shares its stem. Names are unique
within a world.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from lineage_sim.clock import MS_PER_DAY, MS_PER_SECOND
from lineage_sim.config import SpeciesConfig
from lineage_sim.events import InputEvent, OutputEvent, SpeciesBorn, SpeciesExtinct
from lineage_sim.fauna import genome as gn
from lineage_sim.fauna.genome import GENE_COUNT, Gene
from lineage_sim.rng import SPECIES
from lineage_sim.state.schema import StateError, Tree
from lineage_sim.subsystem import Context

Ids = NDArray[np.int64]

_SECONDS_PER_DAY = MS_PER_DAY / MS_PER_SECOND

# Syllables: an onset for one gene, a vowel for another, each gene value cut into as many
# equal steps as there are letters.
_ONSETS = ("b", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z", "sh")
_VOWELS = ("a", "e", "i", "o", "u")
# Gene pairs (onset, vowel) of a root species' name, then of the syllables added, one at
# a time, while the name is already taken.
_ROOT_SYLLABLES = ((Gene.SIZE, Gene.DIET), (Gene.LIMBS, Gene.SPEED), (Gene.HUE, Gene.PATTERN))
_EXTRA_SYLLABLES = (
    (Gene.ARMOUR, Gene.SENSE),
    (Gene.JAW, Gene.BROOD),
    (Gene.AQUATIC, Gene.LEARNING),
    (Gene.EXPLORATION, Gene.SOCIAL),
)
# Syllables of its parent's name a daughter species keeps.
_STEM = 2
_SEPARATOR = "-"  # between syllables in saved names


class Population(Protocol):
    """What the species subsystem reads of the creatures (`Fauna`, or a test double)."""

    @property
    def ids(self) -> Ids: ...

    @property
    def genes(self) -> NDArray[np.float32]: ...

    @property
    def origin(self) -> NDArray[np.int32]: ...


@dataclass(frozen=True)
class SpeciesRecord:
    """One species that lived in this world: a node of the phylogeny."""

    id: int
    parent: int  # 0: arrived from elsewhere (a root of the phylogeny)
    name: str
    lineage: int  # the arrival its creatures descend from (`Fauna.origin`)
    born_t_ms: int
    extinct_t_ms: int  # -1 while alive
    members: int  # at the last census
    peak: int  # most members at any census
    founding: NDArray[np.float32]  # mean genome when it appeared
    centroid: NDArray[np.float32]  # mean genome at its last census with members

    @property
    def alive(self) -> bool:
        return self.extinct_t_ms < 0

    def lived_days(self, now_t_ms: int) -> float:
        """Days from its appearance to its extinction (or to ``now_t_ms`` if alive)."""
        end = self.extinct_t_ms if self.extinct_t_ms >= 0 else now_t_ms
        return (end - self.born_t_ms) / MS_PER_DAY


def components(linked: NDArray[np.bool_]) -> NDArray[np.intp]:
    """Connected component of each node of a symmetric adjacency matrix, named by its
    smallest node index."""
    n = linked.shape[0]
    label = np.arange(n, dtype=np.intp)
    while n:
        smallest = np.where(linked, label[None, :], n).min(axis=1)
        merged = np.minimum(label, smallest)
        merged = merged[merged]  # follow the pointer: components merge in fewer passes
        if np.array_equal(merged, label):
            break
        label = merged
    return label


def _step(value: float, letters: Sequence[str]) -> str:
    return letters[min(int(value * len(letters)), len(letters) - 1)]


def syllable(onset: float, vowel: float) -> str:
    """The syllable for two gene values in [0, 1]."""
    return _step(onset, _ONSETS) + _step(vowel, _VOWELS)


def display(syllables: Sequence[str]) -> str:
    return "".join(syllables).capitalize()


def _unique(base: list[str], extras: Sequence[str], taken: set[str]) -> list[str]:
    """``base``, or ``base`` plus the first of ``extras`` (then of every syllable, in a
    fixed order) that makes a name nobody has."""
    if display(base) not in taken:
        return base
    spare = [o + v for o in _ONSETS for v in _VOWELS]
    for extra in [*extras, *spare]:
        if display([*base, extra]) not in taken:
            return [*base, extra]
    return _unique([*base, spare[0]], extras, taken)  # all taken: lengthen again


def root_name(genes: NDArray[np.float32], taken: set[str]) -> list[str]:
    """Syllables of a root species with mean genome ``genes``."""
    base = [syllable(float(genes[a]), float(genes[b])) for a, b in _ROOT_SYLLABLES]
    extras = [syllable(float(genes[a]), float(genes[b])) for a, b in _EXTRA_SYLLABLES]
    return _unique(base, extras, taken)


def daughter_name(
    parent: Sequence[str],
    genes: NDArray[np.float32],
    parent_genes: NDArray[np.float32],
    taken: set[str],
) -> list[str]:
    """Syllables of a daughter species: its parent's stem, then a syllable for the gene
    it diverged on most (the gene picks the onset, the daughter's value of it the vowel);
    if that name is taken, the next most diverged gene, and so on."""
    stem = list(parent[:_STEM])
    order: list[int] = np.argsort(-np.abs(genes - parent_genes), kind="stable").tolist()
    candidates = [_ONSETS[g] + _step(float(genes[g]), _VOWELS) for g in order]
    for candidate in candidates:
        if display([*stem, candidate]) not in taken:
            return [*stem, candidate]
    return _unique([*stem, candidates[0]], candidates[1:], taken)


class Species:
    """The species subsystem. Read the phylogeny through `records`."""

    def __init__(self, cfg: SpeciesConfig, link_distance: float, population: Population) -> None:
        self._cfg = cfg
        self._link = link_distance
        self._population = population
        # Living creatures known at the last census, by id (sorted), and their species.
        self._creatures: Ids = np.zeros(0, dtype=np.int64)
        self._labels: Ids = np.zeros(0, dtype=np.int64)
        # One row per species that ever lived; species k is row k - 1.
        self._parent: Ids = np.zeros(0, dtype=np.int64)
        self._lineage: Ids = np.zeros(0, dtype=np.int64)
        self._born_ms: Ids = np.zeros(0, dtype=np.int64)
        self._extinct_ms: Ids = np.zeros(0, dtype=np.int64)
        self._members = np.zeros(0, dtype=np.int32)
        self._peak = np.zeros(0, dtype=np.int32)
        # How long each species has been divided into separate groups, sim seconds.
        self._divided_s = np.zeros(0, dtype=np.float64)
        self._founding = np.zeros((0, GENE_COUNT), dtype=np.float32)
        self._centroid = np.zeros((0, GENE_COUNT), dtype=np.float32)
        self._names: list[list[str]] = []
        self._taken: set[str] = set()

    @property
    def name(self) -> str:
        return SPECIES

    # -- views --

    @property
    def count(self) -> int:
        """Species that ever lived in this world."""
        return len(self._names)

    @property
    def alive_count(self) -> int:
        return int(np.count_nonzero(self._extinct_ms < 0))

    def record(self, species_id: int) -> SpeciesRecord:
        row = species_id - 1
        if not 0 <= row < self.count:
            raise KeyError(species_id)
        return SpeciesRecord(
            id=species_id,
            parent=int(self._parent[row]),
            name=display(self._names[row]),
            lineage=int(self._lineage[row]),
            born_t_ms=int(self._born_ms[row]),
            extinct_t_ms=int(self._extinct_ms[row]),
            members=int(self._members[row]),
            peak=int(self._peak[row]),
            founding=self._founding[row].copy(),
            centroid=self._centroid[row].copy(),
        )

    def records(self) -> list[SpeciesRecord]:
        """Every species that ever lived, in order of appearance: the phylogeny."""
        return [self.record(k) for k in range(1, self.count + 1)]

    def species_of(self, creature_ids: Ids) -> Ids:
        """Species of each creature at the last census; 0 for one born since."""
        if self._creatures.size == 0:
            return np.zeros(creature_ids.shape, dtype=np.int64)
        at = np.minimum(np.searchsorted(self._creatures, creature_ids), self._creatures.size - 1)
        return np.where(self._creatures[at] == creature_ids, self._labels[at], 0).astype(np.int64)

    # -- subsystem interface --

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        population = self._population
        ids = population.ids
        genes = population.genes
        lineage = population.origin.astype(np.int64)
        first_new = self.count
        labels = self.species_of(ids)
        labels = self._label_newcomers(genes, lineage, labels, ctx.t_ms)
        labels = self._split(genes, labels, ctx)
        outputs = self._census(genes, labels, ctx.t_ms, first_new)
        order = np.argsort(ids, kind="stable")
        self._creatures = ids[order].astype(np.int64)
        self._labels = labels[order]
        return outputs

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def get_state(self) -> Tree:
        return {
            "creatures": self._creatures.copy(),
            "labels": self._labels.copy(),
            "parent": self._parent.copy(),
            "lineage": self._lineage.copy(),
            "born_ms": self._born_ms.copy(),
            "extinct_ms": self._extinct_ms.copy(),
            "members": self._members.copy(),
            "peak": self._peak.copy(),
            "divided_s": self._divided_s.copy(),
            "founding": self._founding.copy(),
            "centroid": self._centroid.copy(),
            "names": [_SEPARATOR.join(name) for name in self._names],
        }

    def set_state(self, tree: Tree) -> None:
        self._creatures = np.array(tree["creatures"], dtype=np.int64)
        self._labels = np.array(tree["labels"], dtype=np.int64)
        self._parent = np.array(tree["parent"], dtype=np.int64)
        self._lineage = np.array(tree["lineage"], dtype=np.int64)
        self._born_ms = np.array(tree["born_ms"], dtype=np.int64)
        self._extinct_ms = np.array(tree["extinct_ms"], dtype=np.int64)
        self._members = np.array(tree["members"], dtype=np.int32)
        self._peak = np.array(tree["peak"], dtype=np.int32)
        self._divided_s = np.array(tree["divided_s"], dtype=np.float64)
        self._founding = np.array(tree["founding"], dtype=np.float32).reshape(-1, GENE_COUNT)
        self._centroid = np.array(tree["centroid"], dtype=np.float32).reshape(-1, GENE_COUNT)
        names: list[str] = list(tree["names"])
        self._names = [name.split(_SEPARATOR) for name in names]
        self._taken = {display(name) for name in self._names}
        n = len(self._names)
        rows = (self._parent, self._lineage, self._born_ms, self._extinct_ms, self._members,
                self._peak, self._divided_s, self._founding, self._centroid)  # fmt: skip
        if any(array.shape[0] != n for array in rows):
            raise StateError("species record arrays differ in length")
        if self._creatures.shape != self._labels.shape:
            raise StateError("species labels and creatures differ in length")

    # -- the daily census --

    def _new_species(self, parent: int, lineage: int, t_ms: int) -> int:
        """Open a record (named at the census, once its members are known)."""
        self._parent = np.append(self._parent, np.int64(parent))
        self._lineage = np.append(self._lineage, np.int64(lineage))
        self._born_ms = np.append(self._born_ms, np.int64(t_ms))
        self._extinct_ms = np.append(self._extinct_ms, np.int64(-1))
        self._members = np.append(self._members, np.int32(0))
        self._peak = np.append(self._peak, np.int32(0))
        self._divided_s = np.append(self._divided_s, 0.0)
        empty = np.zeros((1, GENE_COUNT), dtype=np.float32)
        self._founding = np.concatenate([self._founding, empty])
        self._centroid = np.concatenate([self._centroid, empty])
        self._names.append([])
        return len(self._names)

    def _label_newcomers(
        self, genes: NDArray[np.float32], lineage: Ids, labels: Ids, t_ms: int
    ) -> Ids:
        """Give every creature without a species the species of its nearest relative."""
        labels = labels.copy()
        unknown = np.flatnonzero(labels == 0)
        for line in np.unique(lineage[unknown]).tolist():
            rows = unknown[lineage[unknown] == line]
            kin = np.flatnonzero((labels > 0) & (lineage == line))
            if kin.size:
                near = _distances(genes[rows], genes[kin]).argmin(axis=1)
                labels[rows] = labels[kin[near]]
                continue
            # Its kin all died since the last census: the nearest species of its lineage
            # still on record as alive (its parents' species, most likely).
            alive = np.flatnonzero((self._lineage == line) & (self._extinct_ms < 0))
            if alive.size:
                near = _distances(genes[rows], self._centroid[alive]).argmin(axis=1)
                labels[rows] = alive[near] + 1
                continue
            labels[rows] = self._new_species(0, int(line), t_ms)
        return labels

    def _split(self, genes: NDArray[np.float32], labels: Ids, ctx: Context) -> Ids:
        """Split every species that has stayed divided for ``split_days``."""
        cfg = self._cfg
        labels = labels.copy()
        for row in np.flatnonzero(self._extinct_ms < 0).tolist():
            species_id = row + 1
            members = np.flatnonzero(labels == species_id)
            groups = np.zeros(0, dtype=np.intp)
            group_of = np.zeros(0, dtype=np.intp)
            if members.size >= 2 * cfg.min_members:
                group_of = components(gn.distance_matrix(genes[members]) <= self._link)
                roots, sizes = np.unique(group_of, return_counts=True)
                big = sizes >= cfg.min_members
                # Largest first; equal sizes by their first member.
                groups = roots[big][np.lexsort((roots[big], -sizes[big]))]
            if groups.size < 2:
                self._divided_s[row] = 0.0
                continue
            self._divided_s[row] += ctx.dt_s
            if self._divided_s[row] < cfg.split_days * _SECONDS_PER_DAY:
                continue
            self._divided_s[row] = 0.0
            for root in groups[1:].tolist():
                daughter = self._new_species(species_id, int(self._lineage[row]), ctx.t_ms)
                labels[members[group_of == root]] = daughter
        return labels

    def _census(
        self, genes: NDArray[np.float32], labels: Ids, t_ms: int, first_new: int
    ) -> list[OutputEvent]:
        """Count members, update centroids, name the new species, record extinctions."""
        n = self.count
        members = np.bincount(labels, minlength=n + 1)[1:].astype(np.int32)
        sums = np.zeros((n + 1, GENE_COUNT), dtype=np.float64)
        np.add.at(sums, labels, genes.astype(np.float64))
        present = members > 0
        self._centroid[present] = (sums[1:][present] / members[present, None]).astype(np.float32)
        self._members = members
        self._peak = np.maximum(self._peak, members)
        outputs: list[OutputEvent] = []
        for row in range(first_new, n):
            self._founding[row] = self._centroid[row]
            parent = int(self._parent[row])
            if parent == 0:
                name = root_name(self._centroid[row], self._taken)
            else:
                name = daughter_name(
                    self._names[parent - 1],
                    self._centroid[row],
                    self._centroid[parent - 1],
                    self._taken,
                )
            self._names[row] = name
            self._taken.add(display(name))
            outputs.append(SpeciesBorn(t_ms, row + 1, display(name), parent, int(members[row])))
        for row in np.flatnonzero((self._extinct_ms < 0) & ~present).tolist():
            self._extinct_ms[row] = t_ms
            outputs.append(
                SpeciesExtinct(t_ms, row + 1, display(self._names[row]), int(self._born_ms[row]))
            )
        return outputs


def _distances(a: NDArray[np.float32], b: NDArray[np.float32]) -> NDArray[np.float32]:
    """Genetic distance from every row of ``a`` to every row of ``b``, shape (|a|, |b|)."""
    return np.abs(a[:, None, :] - b[None, :, :]).mean(axis=-1).astype(np.float32)
