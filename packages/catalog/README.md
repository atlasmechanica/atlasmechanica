# @atlasmechanica/catalog

Typed catalog manifests for Atlas Mechanica.

The catalog deliberately separates a **canonical subject** from a **collection occurrence**. For example, `open-belt-drive` is a reusable Atlas subject while `brown:001` is one historical appearance of that subject in Brown's *507 Mechanical Movements*.

## Layers

- `CanonicalSubjectManifest` — Atlas identity, classification, reusable simulation binding, and subject-level facts.
- `CollectionManifest` — source collection identity and rights/provenance defaults.
- `CollectionOccurrenceManifest` — one numbered/source occurrence mapped to a canonical subject.

Occurrence implementation status is progressive:

```text
cataloged → classified → mapped → interactive
```

This allows the complete Brown catalog to be ingested before every movement has been mapped to a canonical Atlas subject or given an interactive simulation. `cataloged` and `classified` occurrences do not require a canonical subject; `mapped` and `interactive` occurrences do.

## Corpus rule

Catalog manifests contain authored/source metadata and references. Solved geometry, tangent points, renderer paths, Three.js meshes, animation keyframes, and other derived runtime state do **not** belong in the catalog.
