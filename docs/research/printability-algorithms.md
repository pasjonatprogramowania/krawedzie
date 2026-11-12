# Printability theory and edge-rounding algorithms for FDM printing

**Project:** RoundEdge (React 19 + TypeScript + Vite + three.js) — rounds edges/corners of STL meshes so they print better on FDM printers.
**Scope of this document:** (a) the printability numbers that justify rounding at all, (b) the exact geometry of a fillet/chamfer and the error budget of its polygonal approximation, (c) a comparison of concrete algorithms for implementing the rounding in a browser on a triangle mesh, (d) testable requirements.

**Research method.** ~25 distinct web searches across `mcpsurfr` (search / read_url / deep-research backends) and `firecrawl` (search / scrape), plus `context7` for library API docs and `hyperresearch` (no vault present in this project — `search_notes` returned "No hyperresearch vault found", so no vault notes were created). Every URL listed in [Sources](#sources) was actually retrieved; passages were quoted from the retrieved page content. Claims that could **not** be verified are listed explicitly in [Unverified and caveats](#unverified-and-caveats).

**Units.** All lengths in millimetres (mm). Angles in degrees unless stated. The reference printer throughout is a **0.4 mm nozzle** desktop FDM machine (Prusa-class), i.e. extrusion width **0.45 mm** in PrusaSlicer.

---

## 1. Why rounding edges is a printability requirement, not cosmetics

### 1.1 Feature size floor: the nozzle sets the unit

| Quantity | Value | Source |
|---|---|---|
| Standard desktop nozzle | 0.4 mm | [Prusa: Modeling with 3D printing in mind](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135) |
| PrusaSlicer extrusion width for a 0.4 mm nozzle | 0.45 mm | same |
| Wall thickness = 1 / 2 / 3 / 4 perimeters | 0.45 / 0.90 / 1.35 / 1.80 mm | same |
| "Walls thinner than one nozzle perimeter are not printable" | — | same |
| Wall = 1 perimeter / >1 but <2 / >2 perimeters | printable / **not printable** / printable | same (Prusa table) |
| Min wall, FDM | 1 mm (Formlabs table); with a 0.4 mm nozzle prefer 1.2 mm (multiple of 0.4) | [Formlabs: Minimum Wall Thickness](https://formlabs.com/blog/minimum-wall-thickness-3d-printing/) |
| Min wall, FDM, aggregated | 0.8 mm supported and free-standing (Protolabs); ≥ 2 × nozzle (Raise3D); 1.0 mm (Forge Labs) | [3dprintcalcs: Minimum Feature Calculator](https://3dprintcalcs.uk/dimensions-and-scaling/minimum-feature-calculator/) |
| Min wall, FFF | > 0.9 mm (= 2 × extrusion line width) | [Hydra Research: Design Rules](https://www.hydraresearch3d.com/design-rules) |
| Min hole diameter | > 2.0 mm (do not model < 2 mm; undersize and drill instead) | Hydra Research |
| Min hole diameter (formula) | nozzle × 2 = 0.8 mm | 3dprintcalcs |
| Min pin diameter | > 1.8 mm (= 4 × extrusion line width); 3 mm safer for functional pins | Hydra Research; 3dprintcalcs (nozzle × 4 = 1.6 mm) |
| Min slot width | nozzle × 1.2 = 0.48 mm | 3dprintcalcs |
| Min feature size (general modelling) | ≥ 1.8 mm | Hydra Research |
| Fine features (pins etc.), Z ≤ 3 cm | X = Y = 1.5 mm | [UltiMaker: 3D model design guidelines](https://support.ultimaker.com/s/article/1667337954399) |
| Embossed detail (horizontal) | > 0.9 mm wide, < 0.9 mm out | Hydra Research |
| Engraved detail (horizontal) | > 0.5 mm wide, < 0.9 mm deep | Hydra Research |
| Engraved min recession (resin) / embossed min protrusion | 0.15 mm / 0.1 mm (SLA); 0.1–0.35 / 0.1–0.4 mm | Formlabs |
| Vertical wire / pillar diameter (FDM) | 3 mm | Formlabs |
| Modelled threads | ≥ M5 or UNC #10 | Hydra Research |

**Consequence for this app.** A fillet whose radius is below the feature-size floor does not improve the print at all; it only adds polygons and slicing cost. BigRep states the rule explicitly: *"If the radius is close to the nozzle diameter or the layer height, the stress concentration at the corner remains largely unchanged. These undersized fillets increase slicing complexity without improving strength."* ([BigRep: Fillets vs. Chamfers](https://bigrep.com/posts/fillets-vs-chamfers-in-3d-printed-parts/)). Hydra Research recommends **fillets > ø1 mm**; 3dprintcalcs and Raise3D give **2 × nozzle = 0.8 mm** as the hard floor for any 2-perimeter feature.

**Working rule used in the rest of this document:** `r_min = 2 × nozzle = 0.8 mm` (hard floor, reject/flag below), `r_rec = 1.0 mm` (recommended default, per Hydra Research).

### 1.2 Overhangs: why fillet and chamfer are NOT interchangeable

| Rule | Value | Source |
|---|---|---|
| Clean overhang angle (from vertical) | 45°–60°, depending on nozzle and settings | Prusa KB |
| Clean overhang with Nextruder + 360° cooling (MK4S, CORE One) | up to 75° | Prusa KB |
| Conservative overhang limit | < 50° ("many modern printers can achieve reasonable overhang performance up to 70°") | Hydra Research |
| Chamfer angle for FDM | 45° | BigRep; Hydra Research ("Base Chamfers ~0.3 mm") |
| Chamfer at bottom edges (against elephant foot) | 0.3 mm (Hydra) / ~0.5 mm (printpal) | Hydra Research; [printpal design guide](https://printpal.io/docs/3d-printing-design-guide) |
| Base corner radius (part sitting on the bed) | R > 4 mm (disperses warping stress) | Hydra Research |
| Bridges (unsupported horizontal span) | short only — "best results are achieved only over short distances" | [Prusa: Poor bridging](https://help.prusa3d.com/article/poor-bridging_1802) |
| Bridge span, material-dependent | PLA 50–60 mm, PETG 40 mm, ABS 30–35 mm, Nylon 30 mm | [LayerX3D FDM design rules](https://layerx3d.in/blog/fdm-design-rules-wall-thickness-overhangs-bridging-tolerances) |
| Bridge span, other estimate | PLA 20–30 mm, ABS 10–15 mm, PC 15–20 mm | [3DBuildBot overhang limits](https://www.3dbuildbot.com/guides/overhang-angle-limits-fdm-materials) |
| First-layer squish (elephant foot) | ~0.2 mm compensation for a 0.4 mm nozzle | [Prusa: Elephant foot compensation](https://help.prusa3d.com/article/elephant-foot-compensation_114487) |
| Machine accuracy | at least 0.2 mm; ≥ 0.3 mm for moving parts | Prusa KB |
| Ironing (surface re-melt pass) | second infill phase at the same layer, pass spacing < nozzle diameter, angled 45° to the top infill | [Prusa: Ironing](https://help.prusa3d.com/article/ironing_177488) |

**The decisive source for this app.** Prusa's own modelling guide states:

> "If oriented towards the print bed, fillets create a very steep overhang, which negatively affects the surface of the object. For this reason, **use chamfer instead** if a perfect part finish is a priority."

Hydra Research concurs: *"it is not recommended to model downward facing fillets on 3D printed parts. Chamfers are a good alternative for downward facing edges… Downward facing fillets will not cause your print to fail, but that may come out with poor aesthetic/surface quality."*

BigRep quantifies the mechanism: a fillet on a downward-facing edge introduces *"continuously increasing overhang angles that exceed printable limits"*, whereas a 45° chamfer *"maintains a consistent, predictable angle"*.

**Consequence for this app.** A rounding tool must not treat fillet and chamfer as interchangeable. The correct behaviour is **direction-aware**: a fillet whose lowest point faces the build plate must be reported as overhang-risky (and a chamfer suggested), because the fillet's underside is nearly horizontal at the tangent point — i.e. close to a 90° overhang.

### 1.3 Why sharp corners hurt the print itself (not just the mechanics)

* UltiMaker: *"Using rounded corners instead of sharp (90°) transitions help distribute the stress in the material more evenly throughout the model… Sharp corners can cause sudden changes in speed, acceleration, and the extrusion rate, which leads to visual quality issues such as ringing / ghosting."*
* Pollen AM (DfAM): rounding corners *"will reduce inertia and the surface of the 3D printed model will look cleaner. A small 2 mm fillet can make a big difference."*
* Hydra Research: sharp base corners concentrate the shrink-on-cooling force at a single point; rounded corners disperse it → less warping.

### 1.4 Why sharp internal corners hurt the mechanics

The standard engineering reference is Peterson's stress-concentration-factor charts, reproduced as Table A–15/A–16 in Shigley's *Mechanical Engineering Design* ([IITD copy of the Kt/Kts charts](https://web.iitd.ac.in/~jpkhatait/MCL211/Charts_Kt_Kts.pdf); [Shigley Table A-15/16 copy](https://research.iaun.ac.ir/pd/jjfesharaki/pdfs/UploadFile_9038.pdf)).

For a **round shaft with a shoulder fillet in tension** (Shigley Fig. A–15–7, D/d = 1.50) the chart's abscissa is `r/d ∈ {0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30}`:

| r/d | Kt (shoulder fillet, tension, D/d = 1.5) | Interpretation |
|---|---|---|
| 0 (sharp) | ≳ 2.0–2.5 (chart lower bound at r/d = 0 is the sharp-corner limit) | stress concentration dominates |
| 0.05 | ≈ 2.2–2.3 | still high |
| 0.10 | ≈ 1.9 | acceptable |
| 0.15 | ≈ 1.8 | good |
| 0.20 | ≈ 1.6–1.7 | good |
| 0.30 | ≈ 1.5–1.6 | good |

(The chart values above are read from the published figure; an independent calculator reproduces the same family of values: r/d = 0.05 → Kt = 2.26, r/d = 0.20 → Kt = 1.55, r/d = 0.50 → Kt = 1.30 — [mechsimulator Kt calculator](https://mechsimulator.com/tools/stress-concentration/).)

For a **square hole with sharp corners**, Kt = **3.5–4.0** — the canonical failure case is the de Havilland Comet, where *"sharp corners are stress raisers"* and the benefit of a rounded window is *"a hundredfold increase in fatigue life"* ([mechsimulator](https://mechsimulator.com/tools/stress-concentration/)).

BigRep's print-specific version of the same argument: *"Sharp internal corners concentrate stress at layer boundaries, which are already the weakest points in most printed parts. Fillets replace that abrupt transition with a gradual curve, allowing loads to spread across a larger area of material. This reduces the likelihood of cracking or delamination, particularly along the Z-axis, where layer adhesion limits strength."* And: *"Internal fillets are often more critical than external ones. Internal corners are common failure points because they combine stress concentration with weaker inter-layer bonding."*

**Derivable requirement for the app.** For a shoulder whose smaller section has diameter/height `d`, achieving Kt ≲ 2 requires `r/d ≳ 0.10`; for Kt ≲ 1.5, `r/d ≳ 0.20`. Since a printed part is an assembly of many features, `r/d` is not directly computable by this app, but the *absolute* floor `r ≥ 2 × nozzle` already implies `r/d ≥ 0.10` for any feature `d ≥ 20 mm`… and for small features the floor is dominated by the print-resolution constraint anyway. This is why `r ≥ 0.8 mm` is the right universal floor and `r ≥ 0.1 d` is not needed as a separate rule.

---

## 2. Geometry: the fillet as a morphological opening / closing

### 2.1 The operator

A rolling ball of radius `r` swept over a solid `S`:

* **Convex edge** (material = intersection of half-spaces): the ball cannot fit → the result is the morphological **opening** `S ∘ B_r`, which *removes* the sharp corner. This is a rounding of an **external** corner.
* **Concave edge** (material = union of half-spaces): the ball cannot enter → the result is the morphological **closing** `S • B_r`, which *adds* material and fills the sharp internal corner.

The classical definition (Serra; Soille) is: opening `A ∘ B = ⋃ { (B)_z : (B)_z ⊆ A }`, closing `A • B = (A ⊕ B) ⊖ B`; closing is the exact dual of opening ([Wikipedia: Mathematical morphology](https://en.wikipedia.org/wiki/Mathematical_morphology); [cosmiclearn: Opening & Closing](https://www.cosmiclearn.com/imageprocessing/opening-closing.php)).

On a **polyhedron** the operator decomposes locally: near an edge, the ball's centre must satisfy the half-space constraints of the two adjacent faces. Therefore the set of valid ball centres is

```
C = { c : d_i(c) ≤ −r  for all i }   (convex / opening)
C = { c : d_i(c) ≥ +r  for all i }   (concave / closing)
```

and the fillet surface is exactly the set of points at distance `r` from `C`. This is the operator implemented in `src/utils/edgeRounding.ts` (projection onto `C` via an active-set QP, then a step onto the sphere of radius `r`).

### 2.2 The academic anchor for the same operator

**Sellán, Kesten, Sheng, Jacobson, "Opening and Closing Surfaces", ACM Transactions on Graphics 2020 (SIGGRAPH Asia 2020)** — [project page](https://www.dgp.toronto.edu/projects/opening-and-closing-surfaces/) · [paper PDF](https://www.dgp.toronto.edu/projects/opening-and-closing-surfaces/opening-and-closing-surfaces-low-res.pdf) · [MIT-licensed reference implementation](https://github.com/sgsellan/opening-and-closing-surfaces).

Their contribution is precisely to make opening/closing work **on a triangle mesh without re-discretizing the whole model**:

> "We propose a new type of curvature flow for curves in 2D and surfaces in 3D. The flow is inspired by the mathematical morphology *opening* and *closing* operations… Instead, our *surface-only* curvature-based flow moves the surface selectively in areas that should be repositioned. In our triangle mesh discretization, vertices in regions unaffected by the opening or closing will remain exactly in place and do not affect our method's complexity, which is output-sensitive."

Their mechanism, which this app's analytic version approximates exactly and in closed form:

* the affected-region criterion is based on the **minimum principal curvature** `k₂` of the surface, with an obstacle at `k₂ = −1/(r + ε)`;
* the flow is `∂S/∂t = −k₂ · n̂` where `k₂ < −1/r`, and `0` elsewhere — i.e. **only the regions where the ball would not fit move**;
* integration uses the linearly-implicit scheme of Desbrun et al.;
* parameters: structuring-element radius `r`, time step `τ = 0.1`, target edge length `h = πr/20`;
* the flow is finite and converges (unlike an unbounded curvature flow);
* **known limitations**: it *"can mirror the same self-intersection and singularity behavior of previous methods (e.g., mean curvature flow and Wilmore flow)"*; it does **not** maintain a bijective correspondence between input and output in the regions that move and are remeshed; and it uses **geodesic** curvature information whereas classical volumetric opening/closing uses **Euclidean** distance — the two agree only when `r` is small enough or large enough.

This citation is directly usable for two things: (a) justifying the operator choice in the app's own docs, (b) supplying a **radius-aware edge-detection criterion** (`k₂ < −1/r`, i.e. "the ball of radius r does not fit here") that is better than the current fixed `flatAngleDeg` threshold.

### 2.3 The exact arc, for any dihedral angle

For an edge with face normals `n₀`, `n₁`, let `φ = angle(n₀, n₁)` (the code's `normalAngle`) and `θ = π − φ` the **material dihedral angle**.

* **Convex edge** (opening): the fillet arc sweeps `Δ = θ = π − φ`. Tangent length (setback) along each face = `r / tan(θ/2)`. The corner vertex moves along the bisector by `r / sin(θ/2) − r`. For θ = 90°: `(√2 − 1)·r ≈ 0.41421·r` — the value already asserted in the app's tests.
* **Concave edge** (closing): the fillet arc sweeps `Δ = φ`. Setback = `r / tan(φ/2)`.
* **Chamfer**: the cut plane satisfies `Σ dᵢ = ∓c`; for a 90° corner the corner vertex moves by `c·√2` along the bisector and the cut plane is at 45° to both faces.

Volume for a convex 90° fillet, per unit edge length: `r²(1 − π/4) ≈ 0.21460·r²` removed. This is the invariant the existing test *"FILLET: objętość zbiega do wartości analitycznej"* already checks.

---

## 3. The accuracy trap: polygonal approximation of a fillet arc

### 3.1 The sagitta / chordal-deviation formula

For a circular arc of radius `r` and total central angle `Δ` subdivided into `N` chords, each chord subtends `Δ/N`, and the maximum distance between the arc and the chord polygon (the **sagitta**) is

```
s = r · (1 − cos(Δ / (2N)))
```

This is the standard sagitta identity: for an arc spanning `2θ`, `s = r·versin(θ) = r(1 − cos θ)` ([Wikipedia: Sagitta (geometry)](https://en.wikipedia.org/wiki/Sagitta_(geometry)), citing Woodward, *Geometry — Plane, Solid & Analytic Problem Solver*, REA, 1978, p. 359). For small `s`, `s ≈ l²/(8r)` with `l` the chord length.

Solving for the required segment count for a target deviation `δ`:

```
N  ≥  Δ / ( 2 · arccos(1 − δ/r) )
```

### 3.2 Worked table: `δ = 0.05 mm` (a 0.4 mm nozzle's own scale of tolerance)

| r (mm) | 90° convex edge: required N | achieved s (mm) | 45° edge: required N | 150° edge: required N |
|---|---|---|---|---|
| 0.8 | **3** (N=2 gives 0.0609) | 0.0273 | 2 | 5 |
| 1.0 | **3** (N=2 gives 0.0761) | 0.0341 | 2 | 6 |
| 1.5 | **4** (N=3 gives 0.0511) | 0.0288 | 3 | 8 |
| 2.0 | **4** (N=3 gives 0.0681) | 0.0384 | 3 | 11 |
| 3.0 | **5** (N=4 gives 0.0576) | 0.0369 | 3 | 16 |

`δ = 0.05 mm` is the working tolerance used throughout this document because it is the smallest of the published dimensional numbers for this process class (Prusa's machine accuracy is 0.2 mm; a 0.4 mm nozzle's own line width is 0.45 mm; the base chamfer recommended to absorb the 0.2 mm elephant foot is 0.3–0.5 mm). A 0.05 mm geometric error is **below** every published dimensional tolerance for FDM and is therefore a safe upper bound on the faceting error.

### 3.3 There are TWO errors, and the app currently reports only one

1. **Arc faceting error** — the sagitta above. Bounded by `s` if the band is sampled densely enough.
2. **Band discretisation error** — the flat faces meeting the arc are only approximated if the band contains enough vertices. If the band has `M` vertices along the arc, the arc is approximated by `M` chords and the deviation is `r(1 − cos(Δ/(2M)))` — i.e. **the same formula** with `N = M`, but `M` is determined by the *input mesh density and the refinement*, not by the `segments` option.

**Therefore the real deviation bound is `min(sagitta(segments), sagitta(band))`, and the band term dominates whenever the input mesh is coarse.** The app already tracks this: `RoundingReport.bandFacetSize` is *"the real resolution with which the arc is reproduced"* and `chordDeviation` is documented as the deviation that would apply *"if the band mesh were arbitrarily dense"*. The existing tests *"RAPORT: rozdzielczość pasa jest mierzona, a nie zakładana"* and *"RAPORT: rzadka siatka jest wykrywana i jawnie ostrzega o odchyłce"* encode exactly this insight. Good.

### 3.4 A concrete defect found in the current implementation

`src/utils/edgeRounding.ts` computes the deviation with a **single global sweep angle**:

```ts
const arcAngle = Math.max(15 * DEG, Math.min(minPhi, Math.PI));   // minPhi = MIN normal angle over selected edges
const chordDeviation = size * (1 - Math.cos(Math.min(Math.PI / 2, arcAngle) / (2 * segments)));
```

Two problems:

1. **Wrong sweep angle for convex edges.** The sweep of a convex fillet is `Δ = π − φ`, not `φ`. For a *shallow convex crease* (small `φ`, e.g. 20° — a nearly flat fold, still well above the 12° `flatAngleDeg` cut) the true sweep is `160°`, so the true deviation is `r(1 − cos 80°) = 0.826·r`, while the reported value is `r(1 − cos 10°) = 0.0152·r` — an **≈54× under-report**. For a *concave* edge the sweep really is `φ`, so the same expression is right there and wrong for convex.
2. **Worst case is taken from the wrong end.** The sagitta is monotonically increasing in `Δ`, so the worst case is the **largest** sweep among the selected edges — but the code takes `minPhi`, the **smallest** normal angle. For a set of 90° edges the two coincide, which is why the existing 90°-cube tests pass.

`arcAngle` is also used for the refinement target facet length (`targetLength = size * arcAngle / segments`), so the band is refined against the wrong arc length too.

**Fix implied by this document:** compute the sweep per edge — `Δ_convex = π − normalAngle`, `Δ_concave = normalAngle` — use `Δ` for that edge's refinement target, and report `chordDeviation` as the **maximum** over selected edges. This becomes REQ-006/REQ-007 in §6.

---

## 4. Algorithms for exact fillet/chamfer on a triangle mesh

### 4.1 Option A — Analytic rolling ball on incident half-spaces *(implemented in this app)*

Project the vertex onto the set of admissible sphere centres `C` (an active-set QP over the incident face planes), then step onto the sphere of radius `r`.

* **Complexity** `O(V + E + K log K)` for `K` selected edges; band densification adds `O(B)` splits with a spatial grid.
* **Exactness** Exact arc of radius `r` for **any** dihedral angle (already asserted by the test *"FILLET: dowolny kąt dwuścienny — powierzchnia to łuk o promieniu r (nie elipsa)"*).
* **Robustness** Needs manifold, non-degenerate input: boundary and non-manifold edges are skipped and counted; zero-area facets and normal flips are detected and repaired by a relax/revert loop.
* **Preserves sharp features & dimensions** Yes: vertices outside the band are bit-identical; only the selected edges change. This is the property Sellán et al. call *output-sensitivity*.
* **Effort** Already written (~1200 lines incl. refinement and reporting).
* **License** Own code, no third-party dependency.

### 4.2 Option B — Curvature-flow opening/closing (Sellán et al. 2020)

Minimum-principal-curvature flow with the obstacle `k₂ = −1/(r+ε)`, linearly-implicit integration, `τ = 0.1`, `h = πr/20`.

* **Complexity** Iterative: `O(iters · V)` per step; needs remeshing of the moving regions (their implementation uses a remeshing step, thanks to Ryan Schmidt).
* **Exactness** Approximate — the *boundary* between "moves" and "does not move" is curvature-based, and the paper documents the geodesic-vs-Euclidean discrepancy versus true morphological opening/closing.
* **Robustness** Documented failure mode: self-intersection and singularities like mean-curvature flow.
* **Preserves sharp features** Regions outside the opening/closing remain exactly in place (their key selling point).
* **Effort** High — a remeshing pipeline plus a linear-solver dependency.
* **License** MIT (reference implementation, MATLAB + C++/MEX).

### 4.3 Option C — Exact Minkowski sum / offset + boolean

Compute `S ⊕ B_r` (dilate) and/or `S ⊖ B_r` (erode) exactly and combine. CGAL's `Minkowski_sum_3()` operates on `Nef_polyhedron_3` with an `Exact_predicates_exact_constructions_kernel` ([CGAL Minkowski Sum 3 — Introduction](https://doc.cgal.org/latest/Minkowski_sum_3/index.html), [Reference Manual](https://doc.cgal.org/latest/Minkowski_sum_3/group__PkgMinkowskiSum3Ref.html)); CGAL's Polygon Mesh Processing additionally exposes the *Minkowski sum envelope* and the *polyhedral envelope*, the latter being guaranteed contained in the former ([CGAL Polygon Mesh Processing](https://doc.cgal.org/latest/Polygon_mesh_processing/index.html)). OpenSCAD's `minkowski()` does the same thing for CSG models ([OpenSCAD User Manual: Transformations](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Transformations); practical notes and the "minkowski is slow" caveat in [Stack Overflow: rounding edges in OpenSCAD](https://stackoverflow.com/questions/33146741/way-to-round-edges-of-objects-openscad)).

* **Complexity** `O((F_E·F_B) log(...))` — combinatorial; Nef polyhedra blow up quickly.
* **Exactness** Exact (rational arithmetic with EPECK), and geometrically exact for the *rolling-ball* semantics.
* **Robustness** Needs a closed, manifold, self-intersecting-free solid; Nef construction requires validity checks; CGAL's `minkowski_sum_3` **modifies its non-convex input polyhedra in place**.
* **Preserves sharp features & dimensions** No: the whole solid is re-discretized; flat faces get re-tessellated.
* **Effort** Very high; requires a C++/WASM toolchain.
* **License** CGAL is dual **GPL/LGPL + commercial** ([CGAL license page](https://www.cgal.org/license.html)) — GPL would infect the app. OpenSCAD is GPLv2.

### 4.4 Option D — SDF (signed distance field) + voxel remeshing / marching cubes

Convert the mesh to an SDF, apply the morphological opening/closing on the SDF, polygonize with marching cubes. Building blocks: OpenVDB's `MeshToVolume` ([OpenVDB MeshToVolume reference](https://www.openvdb.org/documentation/doxygen/MeshToVolume_8h.html)), MeshLib's mesh→SDF ([meshlib.io](https://meshlib.io/feature/mesh-to-sdf/)), and the parallel voxelizer + marching-cubes pipeline of [davidstutz/mesh-voxelization](https://github.com/davidstutz/mesh-voxelization), which explicitly documents that *"marching cubes might fail… if the original mesh was not watertight (with significant holes)"*.

* **Complexity** `O(N³)` in voxels for the SDF volume, `O(N³)` for polygonization; memory `O(N³)`.
* **Exactness** Bounded by the voxel size `h`: the polygonal surface deviates from the true offset by `≈ h·√3/2` (worst case) — i.e. `h = r/4` gives ≤ 0.22 r error.
* **Robustness** The **most robust** option: it tolerates non-manifold, self-intersecting and degenerate input, because the SDF is defined for any closed point set. This is its decisive advantage.
* **Preserves sharp features & dimensions** No — everything is re-discretized; sharp edges are rounded by construction at the voxel scale; flat faces become stair-stepped unless the grid is very fine.
* **Effort** Medium (needs an SDF builder + marching cubes; both can be self-contained in ~300–600 lines).
* **License** OpenVDB: open source (verify the exact clause before shipping); Marching Cubes itself (Lorensen & Cline 1987) is a published algorithm, not a dependency.

### 4.5 Option E — Blender-style bevel modifier (offset vertices + mitre)

Blender's Bevel modifier offsets the edges of each face inward by the bevel width, generating `Segments` loops between them, and resolves edge/vertex mitres with `Miter Inner/Outer = Sharp | Patch | Arc` plus `Spread`, `Clamp Overlap`, `Harden Normals`, and a `Limit Method` (Angle) that restricts the bevel to sharp edges only ([Blender 5.3 Manual: Bevel Modifier](https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/bevel.html)). Width may be `Offset` (distance from the new edge to the original), `Width` (distance between the two new edges), `Depth` (perpendicular distance), `Percent` or `Absolute`.

* **Complexity** `O(V + E)` local, plus a mitre-resolution pass.
* **Exactness** The bevel *width* is exact, but the cross-section is **not** a circular arc: Blender's default profile is a straight chamfer between the two offset edges unless a custom profile curve is supplied. The arc must be added explicitly.
* **Robustness** `Clamp Overlap` handles short edges; mitre failures (the "pinch" problem) are common and produce visible artefacts.
* **Preserves sharp features & dimensions** The wall faces keep their planes (so their dimensions are preserved), but the corner is cut back by the width — the same dimensional consequence as a fillet.
* **Effort** Medium-high; the mitre solver is the hard part.
* **License** GPL (Blender) — cannot copy code; the *behaviour* is reimplementable from the manual.

### 4.6 Option F — Harmonic / biharmonic coordinate placement (libigl)

Place the fillet vertices by solving a harmonic or biharmonic boundary-value problem with the fillet patch boundary as Dirichlet data. libigl exposes `igl::harmonic(V,F,b,bc,k,Z)` with `k = 1` → C⁰, `k = 2` → C¹ (biharmonic), `k = 3` → C² ([libigl tutorial, Biharmonic deformation](https://libigl.github.io/tutorial/), retrieved via Context7 for `/libigl/libigl`); the coordinate-system variant is documented in [Jacobson et al., "libigl: Prototyping Geometry Processing Research in C++" (SIGGRAPH Asia 2017)](https://dl.acm.org/doi/pdf/10.1145/3134472.3134497).

* **Complexity** Sparse linear solve, `O(V + E)` setup + `O(√V)`-ish solve; heavier than the analytic method.
* **Exactness** Only as good as the boundary conditions; the *arc* must still be generated analytically and used as boundary data.
* **Robustness** Handles the "where do the new vertices go" question gracefully in irregular patches — this is its real strength.
* **Preserves sharp features** Only if the sharp features are in the boundary set.
* **Effort** High (needs a sparse solver).
* **License** libigl is **MPL-2.0** ([libigl repository](https://github.com/libigl/libigl)).

### 4.7 Option G — Laplacian / Taubin / HC / volume-preserving smoothing *(rejected as a rounding algorithm)*

* Laplacian smoothing is mean-curvature flow: it has **no length unit**. The effective radius depends entirely on mesh density, so "0.5 mm" cannot be guaranteed.
* **Taubin λ|μ** (Taubin, ICCV 1995 / SIGGRAPH '95) fixes the shrinkage of plain Laplacian by alternating a smoothing step `λ` with an un-shrinking step `μ`; the paired gain is `(1 − λk)(1 − μk)`, which is ≈1 at low frequencies. Standard parameters are **λ = 0.5, μ = −0.53** ([MTEX `taubinFilter`](https://mtex-toolbox.github.io/taubinFilter.html); Taubin 1995, [IBM Research record](https://research.ibm.com/publications/curve-and-surface-smoothing-without-shrinkage)). It still has **no length unit**.
* **HC** (Vollmer, Papadimitriou, Canny, *Guaranteed and Robust Smoothing of Polyhedra*, 2000) is a curvature-based variant — again unitless.
* **Volume-constrained smoothing** (Liu, *A Novel Volume Constrained Smoothing Method for Meshes*, 2002) preserves volume but not dimensions, and is unitless.
* CGAL's `PMP::angle_and_area_smoothing` and the PMP library's `implicit_smoothing` are the production versions of the same family ([CGAL mesh_smoothing example](https://doc.cgal.org/latest/PMP_Remeshing/PMP_Remeshing_2mesh_smoothing_example_8cpp-example.html), [PMP smoothing](https://www.pmp-library.org/smoothing.html)).

**Verdict: these belong to the "why not" section.** They cannot express "round this corner by 0.8 mm". They are the right tool for *cosmetic* smoothing, which is not what this app does.

### 4.8 Option H — Retopology as a band densifier (a supporting tool, not a rounding algorithm)

If the input mesh is too coarse to represent an `r = 0.8 mm` arc, the band must be densified. Options: the app's own geometry-preserving edge subdivision (already implemented, and asserted by *"FILLET: wierzchołki poza pasmem są BIT-IDENTYCZNE z wejściem"*); uniform/isotropic remeshing (PMP uniform remeshing with `edge_length` target, [PMP remeshing](https://www.pmp-library.org/remeshing.html); CGAL's surface remeshing package, [CGAL 2025 announcement](https://www.cgal.org/2025/05/22/Surface_remeshing/)); the Blender Voxel remesher ([Blender Retopology manual](https://docs.blender.org/manual/en/latest/modeling/meshes/retopology.html)); or field-aligned quad remeshing — [QuadriFlow](https://github.com/hjwdzh/QuadriFlow) (MIT) built on [Instant Field-Aligned Meshes](https://yichaozhou.com/publication/1805quadriflow/) (Jakob et al., ACM TOG 34(6):189, 2015).

Retopology **re-discretizes the entire model** and therefore destroys the "everything outside the band is bit-identical" guarantee. It is only justified as a whole-model operation the user explicitly requests, never as an internal step of the rounding.

### 4.9 Comparison table

| # | Algorithm | Complexity | Exactness | Robustness on non-manifold / flat / degenerate | Effort | License / attribution | Preserves sharp features & dimensions |
|---|---|---|---|---|---|---|---|
| **A** | **Analytic rolling ball on incident half-spaces (current `edgeRounding.ts`)** | `O(V+E+K log K)`, band densification `O(B)` | **Exact** circular arc of radius `r` for any dihedral angle | Moderate: needs manifold, non-degenerate input; boundary/non-manifold edges skipped+counted; flips detected & repaired by relax/revert | **Already done** (~1200 lines) | Own code; academic basis: Sellán et al. 2020 (opening/closing) | **Yes** — band-external vertices bit-identical; flat walls keep their planes; Hausdorff ≤ `maxDisplacement` |
| B | Curvature-flow opening/closing (min principal curvature `k₂`, obstacle `−1/r`) | `O(iters·V)` + remeshing | Approximate; geodesic vs Euclidean discrepancy vs true morphology | Documented failure mode: self-intersection / singularities like mean-curvature flow | High (remeshing + sparse solver) | MIT (ref. impl., MATLAB/C++) | Yes — unaffected regions exactly in place; but no bijective map in moved regions |
| C | Exact Minkowski sum / offset + boolean (CGAL `minkowski_sum_3`, OpenSCAD `minkowski`) | Combinatorial, `O(F_E·F_B·log)` | **Exact** (rational, EPECK) | Low: needs a valid closed manifold solid; Nef blow-up; CGAL mutates its input | Very high (C++/WASM toolchain) | CGAL **GPL/LGPL + commercial** (GPL infects); OpenSCAD GPLv2 | No — whole solid re-discretized |
| D | SDF + morphological open/close + marching cubes | `O(N³)` time & memory | Bounded by voxel size `h` (error ≈ `h√3/2`) | **Highest** — tolerates non-manifold, self-intersecting, degenerate input | Medium (SDF builder + MC, ~300–600 lines, no dependency needed) | OpenVDB (verify clause); MC = Lorensen & Cline 1987 (algorithm, not code) | No — everything re-discretized; sharp edges rounded at voxel scale |
| E | Blender-style bevel modifier (offset + mitre Sharp/Patch/Arc, Clamp Overlap, Harden Normals) | `O(V+E)` + mitre pass | Width exact, but **cross-section is a straight chamfer by default**, not an arc | Moderate: mitre pinch is a classic failure; Clamp Overlap only partially fixes it | Medium-high (mitre solver is the hard part) | Blender GPL — reimplement from the manual only | Partially — wall planes preserved, corner cut back |
| F | Harmonic / biharmonic coordinate placement (libigl) | Sparse solve, `O(V+E)` setup | Only as good as BCs; the arc still needs analytic generation | Good for irregular patch vertex placement | High (needs sparse solver) | libigl **MPL-2.0** | Only if sharp features are in the boundary set |
| G | Laplacian / Taubin λ\|μ / HC / volume-preserving smoothing | `O(iters·V)` | **No length unit** — cannot express "r = 0.8 mm" | Poor at preserving detail; unitless by construction | Low (easy) | Taubin 1995; Vollmer et al. 2000; Liu 2002 | **No** — shrinks/changes dimensions; rounded but size unknown |
| H | Retopology as band densifier (PMP / CGAL / Voxel / QuadriFlow) | `O(V log V)` … `O(N³)` | Isotropic only; field-aligned quad for QuadriFlow | Requires watertight manifold input (QuadriFlow docs say so) | Medium | PMP (MIT-ish), CGAL (GPL/LGPL), QuadriFlow MIT, Instant Meshes | **No** — re-discretizes the whole model; destroys the band-external guarantee |

### 4.10 Recommendation

**Primary: Option A — the analytic rolling ball on incident half-spaces, kept as the core operator.**

Reasons, in order of weight:

1. **It is the only option that can honour the app's central promise** — a *specified* radius in mm. Every unitless option (G) and every re-discretizing option (C, D, H) either cannot express the radius or destroys the guarantee that everything outside the band is bit-identical, which is exactly what makes the feature trustworthy for engineering use.
2. **It is exact** for the arc, for any dihedral angle — already asserted by an existing test.
3. **It is already implemented and tested**; changing it is churn, and the brief is to add confidence, not to rewrite.
4. **It has a strong academic anchor** — Sellán et al. (ACM TOG 2020) implement the same morphological opening/closing operator on triangle meshes and explicitly validate the "unaffected regions stay exactly in place" property. The operator is standard, not ad hoc.
5. **Cost**: zero new dependencies, zero new licence obligations, runs in the browser on `Float64Array`.

**Two targeted upgrades to A, borrowed from other options:**

* From **B (Sellán et al.)**: replace the fixed `flatAngleDeg` edge-selection threshold with a **radius-aware curvature criterion** ("the ball of radius `r` does not fit here"), and use the same criterion to decide whether a fillet is even meaningful at that edge.
* From **E (Blender)**: borrow the `Clamp Overlap` idea as an explicit, reported quantity rather than an implicit per-vertex clamp.

**Fallback: Option D, restricted to the fillet band, but only as a last resort.**

Triggered when the analytic operator cannot produce a valid result for the requested radius (flips that survive the relax/revert loop, or the triangle budget exhausted). Implementation: build a **local SDF** over the band's AABB only (not the whole model), apply the morphological opening/closing on the SDF, polygonize with marching cubes at `h ≤ r/4`, and stitch back. Why: it is the only option that tolerates genuinely broken input (non-manifold, self-intersecting, zero-area facets), which is precisely the case where the analytic operator fails. It is *not* the default because it re-discretizes and destroys the dimensional guarantee.

**Cheaper fallback first, then D.** Before reaching for voxels, retry the analytic operator with a **reduced radius** (binary/halving search down to `r_min = 0.8 mm`) and report the reduced `effectiveRadius`. This is a few lines, deterministic, preserves everything else, and covers the overwhelming majority of real failures (radius larger than the local feature size). Only if *that* fails do we escalate to D.

---

## 5. Practical notes the slicer does for you (and does not)

* **Ironing** (PrusaSlicer ≥ 2.3, Cura, Bambu Studio): a second infill pass over the top surface at the same layer height, pass spacing **smaller than the nozzle diameter**, angled 45° to the top infill. Downsides Prusa names: longer print time, heat creep / hotend clogging on large surfaces, and *"the edges will be a tiny bit fuzzy or less sharp"* because the nozzle bleeds over the edge ([Prusa: Ironing](https://help.prusa3d.com/article/ironing_177488)). Ironing is useless on round/organic shapes and on surfaces not parallel to the bed.
  **Relevance:** ironing smooths the *top* surface. It does nothing for a vertical edge or for a rounded corner's curvature. It also *degrades* crisp edges — so a fillet is not a substitute for ironing, and ironing is not a substitute for a fillet.
* **Elephant foot compensation**: the first layer is squished against the bed and comes out wider. Prusa's recommended value is **~0.2 mm for a 0.4 mm nozzle**; the setting is on by default in official Prusa profiles; it also shrinks the brim-to-part connection, and Prusa's own forum advice is *"with a 0.4 mm nozzle you shouldn't need to set it higher than about half of your first layer extrusion width"*.
  **Relevance:** the model-side defence is a small **chamfer (~0.3–0.5 mm)** on bottom edges — which is precisely what the app's `chamfer` mode should be recommended for on the print-bed-facing boundary. Hydra Research makes the same recommendation ("Base Chamfers ~0.3 mm"), and rounds *base corners* to R > 4 mm to fight warping.
* **Support removal**: the underside of a part is printed against support and inherits the support's grid pattern. A **rounded** external corner distributes the support-contact normal force over a curve instead of a point, which is why it survives removal better than a knife-sharp corner; BigRep: *"rounded internal corners reduce localized thermal stress by allowing heat to dissipate more evenly across layers."* However a **downward-facing fillet** introduces an overhang that itself needs support — so a fillet on a supported surface trades one artefact for another.
* **Overhang vs fillet on the bed**: Prusa's explicit recommendation is to use a **chamfer** on edges facing the bed; Hydra forbids downward-facing fillets; BigRep makes the same point. **This app should offer a per-edge "fillet vs chamfer" recommendation, not a global mode.**

---

## 6. Candidate Requirements for TDD

Each requirement below is written so that it can become a unit test in `tests/rounding.test.ts` (or a new `tests/printability.test.ts`). `roundEdges(mesh, options)` returns `{ mesh, report }`; `RoundingOptions` = `{ radius, segments, kind, edgeIndices, maxDisplacement?, flatAngleDeg?, triangleBudget?, maxLevels?, taperEnds? }`; `RoundingReport` fields are listed in `src/utils/meshTypes.ts`.

The `nozzle` is a new **input** (default 0.4 mm) and `printBedNormal` is a new **input** (default `[0,0,1]`, the print-bed-facing direction) — see REQ-001 and REQ-019.

| # | Title | Requirement | Test sketch |
|---|---|---|---|
| REQ-001 | Minimum printable radius floor | `effectiveRadius ≥ 2 × nozzle` (0.8 mm for a 0.4 mm nozzle) whenever a fillet is applied; a request below the floor is clamped up to the floor **and** a warning is emitted. A chamfer of size `c` is allowed below the floor only if `c ≥ 0.3 mm` (base-chamfer rule). | `roundEdges(cube, {radius: 0.3, nozzle: 0.4})` → `report.effectiveRadius === 0.8` and `report.warnings` contains a radius-floor warning. |
| REQ-002 | Recommended radius default | The default radius offered by the UI is `1.0 mm` (Hydra's "> ø1 mm"), i.e. `2.5 × nozzle`, not the bare floor. | assert default option value; assert it is ≥ `2 × nozzle` for nozzle ∈ {0.25, 0.4, 0.6, 0.8}. |
| REQ-003 | Chordal deviation bound | For every processed edge, the sagitta of its fillet arc satisfies `s = r(1 − cos(Δ/(2N))) ≤ 0.05 mm`, where `Δ` is that edge's **own** sweep angle. | build a 90° cube, fillet all 12 edges with `r = 0.8, segments = 3` → `report.chordDeviation ≤ 0.05`. |
| REQ-004 | Minimum segment count | `segments` is raised to `ceil(Δ / (2·arccos(1 − δ/r)))` per edge when needed; for the default `r ≤ 1.0 mm` and a 90° corner this means **≥ 3 segments**. The report must expose the effective per-edge segment count. | `roundEdges(cube, {radius: 0.8, segments: 1})` → effective segments ≥ 3 and `report.chordDeviation ≤ 0.05`. |
| REQ-005 | Correct sweep angle per edge (defect fix) | The sweep angle used for a **convex** edge is `Δ = π − normalAngle`; for a **concave** edge `Δ = normalAngle`. The implementation must not use a single global `minPhi`. | Convex crease with `normalAngle = 20°` and `r = 1.0` → the reported deviation uses `Δ = 160°` (s = 0.826·r ≈ 0.826 mm), not the `Δ = 20°` value (0.0152·r). Assert the report value equals `r(1 − cos(80°))` within 1e-9. |
| REQ-006 | Worst-case deviation reported | `report.chordDeviation` must be the **maximum** sagitta over all processed edges, not the value for the most benign edge. | Fillet one 90° edge and one 20°-normal-angle convex edge in the same call → `report.chordDeviation` equals the 20° edge's value. |
| REQ-007 | Band resolution bound | The longest facet inside the fillet band satisfies `bandFacetSize ≤ r` (target `≤ r/2`), otherwise the report must state that the *mesh* — not the segment count — limits the arc resolution. | `report.bandFacetSize ≤ report.effectiveRadius` on the refined fixture; and on a deliberately coarse mesh `report.warnings` contains the sparse-band warning while `report.bandFacetSize > 2·r`. |
| REQ-008 | Band-external vertices untouched | Every vertex farther than the band reach from any processed edge is **bit-identical** to the input (exact float equality of all three coordinates). | existing test *"FILLET: wierzchołki poza pasmem są BIT-IDENTYCZNE z wejściem"* — keep, and extend to assert equality after the sagitta fix. |
| REQ-009 | Hausdorff / displacement bound | `report.maxDisplacement ≤ min(effectiveRadius, maxDisplacement ?? ∞) + 1e-9`, and no vertex moves further than `0.25 ×` the shortest incident non-feature edge. | assert `report.maxDisplacement ≤ report.effectiveRadius + 1e-9` on every fixture; assert the per-vertex 0.25·L rule with a synthetic sliver-edge fixture. |
| REQ-010 | No degenerate triangles | `report.degenerateFaceCount === 0`, and every output triangle has area `> max(1e-12, (diag·1e-7)²)`. | assert on every fixture in the suite, including a knife-edge fixture. |
| REQ-011 | No flipped normals | `report.flippedFaceCount === 0`: for every face, `dot(n_before, n_after) > 0`. | assert on every fixture; add a fixture with a 15° dihedral edge. |
| REQ-012 | Flip threshold is geometry-aware | The flip test must not use a fixed 89° rotation threshold; the allowed rotation is `Δ/2` of the edge's own arc (plus the facet's own tilt). A legitimate concave fillet with `Δ > 178°` must not be reported as flipped. | concave fillet with `Δ = 170°` → `flippedFaceCount === 0`; the current `FLIP_COS = cos(89°)` constant must not reject it. |
| REQ-013 | Analytic volume for a convex 90° fillet | The volume removed by filleting one 90° convex edge of length `L` equals `r²(1 − π/4)·L` within **2 %** (and within 0.1 % of the exact value as `segments → ∞`). | existing test *"FILLET: objętość zbiega do wartości analitycznej"* — tighten the tolerance to 2 % and add the `L`-scaled case. |
| REQ-014 | Analytic volume for a concave fillet | A concave (closing) fillet **adds** `r²(1 − π/4)·L` (±2 %), i.e. `volumeChangePercent > 0` for a purely concave operation. | existing test *"FILLET na krawędzi WKLĘSŁEJ dodaje materiał (kształt L)"* — add the numeric check. |
| REQ-015 | Analytic arc, not ellipse | For a filleted edge with dihedral angle ≠ 90°, the filleted surface is a circular arc of radius exactly `r`: the distance from the arc's centre to three sampled band points equals `r` within 1e-9 (relative 1e-9). | existing test *"FILLET: dowolny kąt dwuścienny"* — keep and assert the distance-to-centre formulation. |
| REQ-016 | 90° corner displacement identity | For a 90° convex edge, the corner vertex moves by exactly `(√2 − 1)·r` along the bisector and the tangent points are exactly `r` from the edge line (within 1e-9). | existing test *"FILLET: sześcian 20 mm, r = 2…"* — keep. |
| REQ-017 | Chamfer geometry | For a 90° edge, the chamfer cut plane is at 45° to both faces and the corner vertex moves by `c·√2` along the bisector. | existing test *"CHAMFER: sześcian, c = 2 — płaszczyzna ścinająca 45 stopni"* — keep and add the `c·√2` displacement assertion. |
| REQ-018 | Radius clamp is reported | `effectiveRadius ≤ min(0.5 × median incident edge, 0.5 × min bbox dimension)` and `effectiveRadius ≤ requestedRadius`; whenever the clamp bites, a warning naming both the requested and the effective radius is emitted. | existing test *"SAFETY: promień większy niż połowa najkrótszej krawędzi jest przycinany"* — keep and add the `bbox` half-dimension case. |
| REQ-019 | Downward-facing fillet is flagged | For each processed edge, the app determines whether the fillet creates a downward-facing (overhang) surface with respect to the print-bed normal. If the fillet's underside normal has a component below the 45° overhang limit, the report must (a) count it (`downwardFilletCount`) and (b) recommend a chamfer of equivalent size. | Build a cube sitting on the bed, fillet the bottom edges → `downwardFilletCount == 4` and the warning names the chamfer alternative; fillet the top edges → `downwardFilletCount == 0`. |
| REQ-020 | Print-bed chamfer recommendation | The app recommends a **chamfer of 0.3–0.5 mm** (not a fillet) on edges that lie in the print-bed contact plane, to absorb the ~0.2 mm elephant-foot squish. | Assert the recommended chamfer size for a bed-plane edge is in `[0.3, 0.5]` and is smaller than the fillet recommendation for the same edge. |
| REQ-021 | Non-manifold and boundary edges are skipped, not rounded | Boundary edges and non-manifold edges are never filleted; they are counted in `skippedBoundaryEdgeCount` and reported. | `skippedBoundaryEdgeCount` equals the number of selected boundary/non-manifold edges; the output mesh is manifold (E = 3F/2 for a closed mesh). |
| REQ-022 | Flat-edge threshold and its radius-aware alternative | With `flatAngleDeg` unset, the default selection threshold must reject only edges that are geometrically flat **for the requested radius** (the `k₂ < −1/r` criterion of Sellán et al.), and the default `flatAngleDeg = 12°` must remain available as an explicit override. | Convex crease with `normalAngle = 11°` → skipped; `normalAngle = 13°` with `r = 0.8` → processed, with the report explaining why (curvature exceeds `1/r`). |
| REQ-023 | Knife edge / grazing case is handled | When the two incident faces are (near) parallel (a knife edge, `\|n₀ × n₁\| → 0`) or the local thickness `W → 0`, the operation must not produce NaN, infinity, self-intersection or a flipped face. The edge must be either skipped (`skippedShortEdgeCount`) or clamped, and the choice must be reported. | Build a zero-thickness wedge; assert `Number.isFinite` on all coordinates, `flippedFaceCount === 0`, `degenerateFaceCount === 0`, and `skippedShortEdgeCount + clampedVertexCount > 0`. |
| REQ-024 | Interference between opposing fillets is detected | Two opposing fillets of radius `r` on a wall of thickness `t` interfere when `2r ≥ t`; the app must detect this and either merge them or report the interference, and must never produce a self-intersecting band. | Wall `t = 1.6 mm`, two fillets of `r = 1.0 mm` → interference reported; wall `t = 4 mm`, `r = 1 mm` → no interference. |
| REQ-025 | Determinism | Two calls with identical inputs produce bit-identical outputs (positions, faces, and the full report except elapsed-time fields). | existing test *"SAFETY: determinizm"* — keep. |
| REQ-026 | No NaN / Infinity | All output coordinates are finite. | existing test *"SAFETY: brak NaN/Infinity"* — keep. |
| REQ-027 | Bounding-box change is bounded and reported | For a fillet, `\|bboxDelta_i\| ≤ (√2 − 1)·r + 1e-6` on every axis; for a chamfer, `\|bboxDelta_i\| ≤ c + 1e-6`. | assert on the cube fixture; assert `report.bboxDelta` matches the measured value. |
| REQ-028 | Triangle budget is a hard limit | `trianglesAfter ≤ triangleBudget`, and when refinement is truncated by the budget the report sets `refinementLimitedByBudget = true` **and** states the real `bandFacetSize`. | existing test *"BUDŻET: przekroczenie limitu trójkątów jest raportowane…"* — keep. |
| REQ-029 | Refinement does not change the surface | Edge subdivision alone preserves the surface: total area and total volume of the subdivided mesh equal those of the input within 1e-9 relative. | existing test *"FILLET: objętość wyniku zgadza się z niezależnym całkowaniem siatki"* + a dedicated subdivision-invariance test. |
| REQ-030 | Radius back-off fallback | When the analytic operator cannot produce a flip-free result at the requested radius, the app retries with `r' = r/2, r/4, …` down to `max(0.8 mm, 2 × nozzle)` and succeeds with `effectiveRadius = r'`; the report must state the reduced radius. | Force a failure with a pathological fixture → `report.effectiveRadius < requestedRadius`, `report.flippedFaceCount === 0`, and a warning naming the reduced radius. |
| REQ-031 | Explicit warnings for every violated threshold | The report's `warnings` array must contain a specific, actionable message for each of: radius below the printable floor; chordal deviation > 0.05 mm; `bandFacetSize > 2·r`; budget-limited refinement; clamped/reverted vertices; skipped flat / boundary / short edges; downward-facing fillet detected. | Assert `warnings` contains a matching substring for each triggered condition (one test per condition). |
| REQ-032 | Surface-quality guarantee vs. FDM resolution | The app must guarantee that the fillet's geometric error is below the print's own resolution: `max(chordDeviation, bandFacetSize/2) ≤ 0.5 × nozzle` (0.2 mm for a 0.4 mm nozzle) for any radius the app advertises as "print-ready". | For `r = 0.8, segments = 3` on a dense mesh: `max(chordDeviation, bandFacetSize/2) ≤ 0.2`; for `r = 3.0` on the same mesh the app must warn that the arc is not print-ready. |

---

## 7. Unverified and caveats

These could not be confirmed from a primary source during this research pass and are flagged rather than asserted:

* **Exact Kt values for a 3D-printed shoulder fillet.** The numbers in §1.4 come from Peterson/Shigley charts for machined round shafts with shoulder fillets, read from a scanned figure (OCR-garbled axis labels). The mapping to an FDM part's layer-boundary-limited strength is an inference, not a measured result. I found **no** peer-reviewed FDM-specific fatigue study quantifying Kt for a printed internal corner.
* **"Bridge 50–60 mm (PLA)"** vs **"20–30 mm (PLA)"** — two sources disagree by ~2×; both are vendor blogs, not measured studies. Treat 20–30 mm as the conservative figure.
* **"Exact Face-Offsetting for Polygonal Meshes" (ACADIA 2015)** — the paper exists ([ACM/CUMINCAD record](https://papers.cumincad.org/data/works/att/acadia15_203.pdf)) and is cited as *"Exact Face-Offsetting for Polygonal Meshes." In Computational Ecologies…"* in [Advances in Architectural Geometry 2016](https://adk.elsevierpure.com/files/60563062/Advances_in_Architectural_Geometry_2016_OA.pdf), but the PDF fetch timed out on three engines and the authors/method could not be read. **Not used as a source for any claim in this document.**
* **Botsch/Pauly/Kobbelt et al., "Geometric Modeling Based on Polygonal Meshes", Eurographics 2008 full-day tutorial** — the PDF was retrieved but only its first 30 pages (table of contents) were parsed; the "rolling ball patches" passage appears only in a search snippet. Cited here only as a general pointer to polygonal-mesh geometric modelling.
* **Chordal-deviation tolerance δ = 0.05 mm** is *this document's choice*, not a published standard. It is justified as being below every published FDM dimensional tolerance found (0.2 mm machine accuracy, 0.3 mm movable-part clearance, 0.45 mm line width). If the project prefers a different δ, change δ consistently in REQ-003, REQ-004, REQ-032 and the §3.2 table.
* **`r/d ≥ 0.10` for Kt ≤ 2** — the chart-reading is approximate; the underlying Peterson data is authoritative but the figure is a scan.
* **OpenVDB's licence clause** was not fetched directly (only its `MeshToVolume` API doc page). Verify before adding it as a dependency; the recommendation in §4.10 is to implement marching cubes in-repo and take no dependency.
* **`hyperresearch`**: no vault exists in this project (`search_notes` error: *"No hyperresearch vault found"*). No notes were created and no vault was initialised, per the "no vault, no writes" rule.
* **Print-bed orientation** is not currently an input to the app. REQ-019/REQ-020 assume a `printBedNormal` input with default `[0,0,1]`; if the app only ever rounds a model in its authored orientation, these requirements reduce to "warn on edges whose outward normal points away from +Z".

---

## Sources

Every URL below was actually retrieved during this research pass (search result passages, `read_url` passages, or full-page scrapes). No citation below is invented.

**Printability guidance (vendor / community)**
- Prusa Knowledge Base — Modeling with 3D printing in mind — https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135
- Prusa Knowledge Base — Elephant foot compensation — https://help.prusa3d.com/article/elephant-foot-compensation_114487
- Prusa Knowledge Base — Poor bridging — https://help.prusa3d.com/article/poor-bridging_1802
- Prusa Knowledge Base — Ironing — https://help.prusa3d.com/article/ironing_177488
- UltiMaker Support — 3D model design guidelines for printed parts — https://support.ultimaker.com/s/article/1667337954399
- Hydra Research — Design Rules & Best Practices for FFF 3D Printing — https://www.hydraresearch3d.com/design-rules
- Formlabs — Minimum Wall Thickness for 3D Printing — https://formlabs.com/blog/minimum-wall-thickness-3d-printing/
- BigRep — Fillets vs. Chamfers in 3D Printed Parts — https://bigrep.com/posts/fillets-vs-chamfers-in-3d-printed-parts/
- Pollen AM — Fillets, Ribs & Edges in 3D Printing (DfAM) — https://pollen.am/design_for_3d_printing_edges_fillets_ribs/
- printpal — Design for 3D Printing: Walls, Tolerances, Overhangs — https://printpal.io/docs/3d-printing-design-guide
- printpal — How to Get Smooth Top Surfaces on 3D Prints (Ironing Guide) — https://printpal.io/resources/how-to-make-your-3d-prints-have-the-smoothest-top-surface
- 3dprintcalcs — Minimum Feature Calculator — https://3dprintcalcs.uk/dimensions-and-scaling/minimum-feature-calculator/
- 3dprintcalcs — Wall Thickness Calculator — https://3dprintcalcs.uk/design/wall-thickness-calculator/
- LayerX3D — FDM Design Rules: Wall Thickness, Overhangs, Bridging and Tolerances — https://layerx3d.in/blog/fdm-design-rules-wall-thickness-overhangs-bridging-tolerances
- 3DBuildBot — Overhang Angle Limits for FDM Materials — https://www.3dbuildbot.com/guides/overhang-angle-limits-fdm-materials
- 3DSourced — How to Print Overhangs & Bridges Over the 45 Degree Rule — https://www.3dsourced.com/rigid-ink/how-to-print-overhangs-bridges-exeeding-the-45-degree-rule/

**Mechanical / stress concentration**
- Shigley, *Mechanical Engineering Design*, Table A–15/A–16 charts of theoretical stress-concentration factors (IITD copy) — https://web.iitd.ac.in/~jpkhatait/MCL211/Charts_Kt_Kts.pdf
- Shigley Table A–15/A–16 copy (incl. Peterson source attribution) — https://research.iaun.ac.ir/pd/jjfesharaki/pdfs/UploadFile_9038.pdf
- mechsimulator — Stress Concentration Factor (Kt) Calculator (Kt values table) — https://mechsimulator.com/tools/stress-concentration/
- simutecra — Stress Concentration Analysis Explained (r/d thresholds) — https://simutecra.com/blogs/stress-concentration-analysis-explained-example

**Geometry / mathematics**
- Sellán, Kesten, Sheng, Jacobson — Opening and Closing Surfaces (project page) — https://www.dgp.toronto.edu/projects/opening-and-closing-surfaces/
- Sellán et al. — Opening and Closing Surfaces (paper PDF) — https://www.dgp.toronto.edu/projects/opening-and-closing-surfaces/opening-and-closing-surfaces-low-res.pdf
- sgsellan/opening-and-closing-surfaces (MIT-licensed reference implementation) — https://github.com/sgsellan/opening-and-closing-surfaces
- Wikipedia — Sagitta (geometry) — https://en.wikipedia.org/wiki/Sagitta_(geometry)
- Wikipedia — Mathematical morphology — https://en.wikipedia.org/wiki/Mathematical_morphology
- cosmiclearn — Image Processing Opening, Closing & Hit-or-Miss — https://www.cosmiclearn.com/imageprocessing/opening-closing.php

**Mesh algorithms, libraries and licences**
- CGAL — The CGAL License — https://www.cgal.org/license.html
- CGAL — 3D Minkowski Sum of Polyhedra: Introduction — https://doc.cgal.org/latest/Minkowski_sum_3/index.html
- CGAL — 3D Minkowski Sum of Polyhedra: Reference Manual — https://doc.cgal.org/latest/Minkowski_sum_3/group__PkgMinkowskiSum3Ref.html
- CGAL — Polygon Mesh Processing (Minkowski sum / polyhedral envelope) — https://doc.cgal.org/latest/Polygon_mesh_processing/index.html
- CGAL — mesh_smoothing example (angle_and_area_smoothing) — https://doc.cgal.org/latest/PMP_Remeshing/PMP_Remeshing_2mesh_smoothing_example_8cpp-example.html
- CGAL — New Surface Remeshing Algorithms — https://www.cgal.org/2025/05/22/Surface_remeshing/
- libigl tutorial (biharmonic deformation, `igl::harmonic`) — https://libigl.github.io/tutorial/ (also retrieved via Context7, library `/libigl/libigl`)
- libigl — Prototyping Geometry Processing Research in C++ (SIGGRAPH Asia 2017) — https://dl.acm.org/doi/pdf/10.1145/3134472.3134497
- libigl repository (MPL-2.0) — https://github.com/libigl/libigl
- elalish/manifold (Apache-2.0, guaranteed-manifold mesh booleans, WASM build) — https://github.com/elalish/manifold
- Manifold WASM Developer Guide — https://manifoldcad.org/docs/jsapi/index
- Blender 5.3 Manual — Bevel Modifier — https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/bevel.html
- Blender 5.3 Manual — Remeshing (Voxel remesher) — https://docs.blender.org/manual/en/latest/modeling/meshes/retopology.html
- Polygon Mesh Processing Library — Smoothing — https://www.pmp-library.org/smoothing.html
- Polygon Mesh Processing Library — Remeshing — https://www.pmp-library.org/remeshing.html
- OpenVDB — MeshToVolume.h reference — https://www.openvdb.org/documentation/doxygen/MeshToVolume_8h.html
- MeshLib — Mesh to SDF — https://meshlib.io/feature/mesh-to-sdf/
- davidstutz/mesh-voxelization (SDF + marching cubes; watertightness caveat) — https://github.com/davidstutz/mesh-voxelization
- OpenSCAD User Manual — Transformations (`minkowski`) — https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Transformations
- Stack Overflow — Way to round edges of objects in OpenSCAD (`minkowski` cost) — https://stackoverflow.com/questions/33146741/way-to-round-edges-of-objects-openscad
- QuadriFlow repository (MIT) — https://github.com/hjwdzh/QuadriFlow
- QuadriFlow project page (Instant Field-Aligned Meshes) — https://yichaozhou.com/publication/1805quadriflow/

**Smoothing literature**
- Taubin — Curve and Surface Smoothing without Shrinkage (ICCV 1995) — https://research.ibm.com/publications/curve-and-surface-smoothing-without-shrinkage
- Taubin — A Signal Processing Approach to Fair Surface Design (SIGGRAPH '95) — http://mesh.brown.edu/taubin/pdfs/taubin-sg95.pdf *(URL seen in search results; direct fetch timed out)*
- MTEX — `taubinFilter` (λ = 0.5, μ = −0.53) — https://mtex-toolbox.github.io/taubinFilter.html
- Bray & Sharf — Notes on Mesh Smoothing (Taubin λ|μ overview) — https://www.ljll.fr/~frey/papers/meshing/Bray%20N.,%20Notes%20on%20mesh%20smoothing.pdf
- Liu — A Novel Volume Constrained Smoothing Method for Meshes — http://www.cad.zju.edu.cn/home/xgliu/papers/Liu02-GraphicalModels.pdf
- trimesh issue #1718 — HC smoothing = Vollmer/Papadimitriou/Canny — https://github.com/mikedh/trimesh/issues/1718

**Pointers retrieved but not used as evidence**
- Botsch, Pauly, Kobbelt, Alliez, Lévy, Bischoff, Rössl — Geometric Modeling Based on Polygonal Meshes (Eurographics 2008 tutorial; TOC retrieved) — https://cgl.ethz.ch/Downloads/Publications/Tutorials/2008/Bot08a/eg08-tutorial.pdf
- Exact Face-Offsetting for Polygonal Meshes (ACADIA 2015) — https://papers.cumincad.org/data/works/att/acadia15_203.pdf *(fetch failed; not used)*
- Advances in Architectural Geometry 2016 (bibliographic record of the above) — https://adk.elsevierpure.com/files/60563062/Advances_in_Architectural_Geometry_2016_OA.pdf

---

## requirements.json

```json
[
  {"id":"REQ-001","title":"Minimum printable radius floor","statement":"The effective fillet radius must be at least 2x the nozzle diameter (0.8 mm for a 0.4 mm nozzle); smaller requests are clamped up to the floor and reported as a warning. Chamfers may go below the floor only when size >= 0.3 mm.","testable":"roundEdges(cube, {radius: 0.3, nozzle: 0.4}) => report.effectiveRadius === 0.8 and warnings contain a radius-floor message.","source":"3dprintcalcs Minimum Feature Calculator (min wall = nozzle x 2); Hydra Research Design Rules (fillets > 1 mm); Raise3D via 3dprintcalcs"},
  {"id":"REQ-002","title":"Recommended default radius","statement":"The default radius offered to the user is 1.0 mm (2.5x a 0.4 mm nozzle), never below 2x the nozzle for any supported nozzle size.","testable":"Assert the default option value equals 1.0 mm and that for nozzle in {0.25,0.4,0.6,0.8} the default satisfies default >= 2*nozzle.","source":"Hydra Research Design Rules (fillets > 1 mm)"},
  {"id":"REQ-003","title":"Chordal deviation bound 0.05 mm","statement":"For every processed edge the sagitta of the fillet arc s = r(1 - cos(delta/(2N))) must be <= 0.05 mm, using that edge's own sweep angle delta.","testable":"roundEdges(90-degree cube, {radius: 0.8, segments: 3}) => report.chordDeviation <= 0.05.","source":"Sagitta identity, Wikipedia Sagitta (geometry) citing Woodward 1978"},
  {"id":"REQ-004","title":"Minimum segment count","statement":"The effective number of arc segments per edge must be raised to ceil(delta / (2*acos(1 - 0.05/r))) when needed; for r <= 1.0 mm on a 90 degree corner this means at least 3 segments. The report exposes the effective per-edge segment count.","testable":"roundEdges(cube, {radius: 0.8, segments: 1}) => effective segments >= 3 and report.chordDeviation <= 0.05.","source":"Derived from the sagitta identity; see section 3.2 table"},
  {"id":"REQ-005","title":"Correct per-edge sweep angle","statement":"The fillet sweep angle must be delta = PI - normalAngle for convex edges and delta = normalAngle for concave edges. A single global min-normal-angle value must not be used.","testable":"Convex crease with normalAngle = 20 degrees and r = 1.0 => reported deviation equals r(1 - cos(80 deg)) within 1e-9, not r(1 - cos(10 deg)).","source":"Geometric derivation in section 2.3; defect identified in src/utils/edgeRounding.ts (arcAngle = min(minPhi, PI))"},
  {"id":"REQ-006","title":"Worst-case deviation reported","statement":"report.chordDeviation must be the maximum sagitta over all processed edges, because the sagitta is monotonically increasing in the sweep angle.","testable":"Round one 90 degree edge and one 20 degree-normal-angle convex edge in one call => report.chordDeviation equals the 20 degree edge value.","source":"Sagitta monotonicity; defect in src/utils/edgeRounding.ts (uses minPhi instead of max sweep)"},
  {"id":"REQ-007","title":"Band facet size bound","statement":"The longest facet inside the fillet band must satisfy bandFacetSize <= effectiveRadius (target <= r/2); otherwise the report must state that mesh density, not the segment count, limits the arc resolution.","testable":"On the refined fixture report.bandFacetSize <= report.effectiveRadius; on a deliberately coarse mesh report.warnings contains the sparse-band warning and report.bandFacetSize > 2*effectiveRadius.","source":"Sellán et al. Opening and Closing Surfaces 2020 (target edge length h = PI*r/20); existing app tests RAPORT: rozdzielczość pasa"},
  {"id":"REQ-008","title":"Band-external vertices untouched","statement":"Every vertex farther than the band reach from any processed edge must be bit-identical to the input in all three coordinates.","testable":"Existing test FILLET: wierzchołki poza pasmem są BIT-IDENTYCZNE z wejściem; extend to run after the sweep-angle fix.","source":"Sellán et al. 2020 (output-sensitive opening/closing; unaffected regions remain exactly in place)"},
  {"id":"REQ-009","title":"Hausdorff / displacement bound","statement":"report.maxDisplacement <= min(effectiveRadius, maxDisplacement ?? Infinity) + 1e-9, and no vertex moves more than 0.25x the shortest incident non-feature edge length.","testable":"Assert report.maxDisplacement <= report.effectiveRadius + 1e-9 on every fixture; add a synthetic sliver-edge fixture for the 0.25x rule.","source":"Existing app invariant in src/utils/edgeRounding.ts; sellan et al. 2020"},
  {"id":"REQ-010","title":"No degenerate triangles","statement":"report.degenerateFaceCount must be 0 and every output triangle area must exceed max(1e-12, (bbox diagonal * 1e-7)^2).","testable":"Assert on every fixture in the suite, including the knife-edge fixture.","source":"Existing app test SAFETY: brak NaN/Infinity; meshTopology areaLimit"},
  {"id":"REQ-011","title":"No flipped normals","statement":"report.flippedFaceCount must be 0: for every face dot(n_before, n_after) > 0.","testable":"Assert on every fixture; add a fixture with a 15 degree dihedral edge.","source":"Existing app report field flippedFaceCount and FLIP_COS check"},
  {"id":"REQ-012","title":"Geometry-aware flip threshold","statement":"The flip test must not use a fixed 89 degree rotation threshold; the permitted rotation is half the edge's own arc sweep. A legitimate concave fillet with sweep > 178 degrees must not be reported as flipped.","testable":"Concave fillet with sweep = 170 degrees => report.flippedFaceCount === 0.","source":"Geometric sweep argument, section 2.3; defect in FLIP_COS = cos(89 deg) in src/utils/edgeRounding.ts"},
  {"id":"REQ-013","title":"Analytic volume for a convex 90 degree fillet","statement":"The volume removed by filleting a 90 degree convex edge of length L equals r^2 * (1 - PI/4) * L within 2 percent.","testable":"Existing test FILLET: objętość zbiega do wartości analitycznej; tighten tolerance to 2 percent and add the L-scaled case.","source":"Exact circular-segment area r^2(1 - PI/4) per unit edge length; stated in the app's own edgeRounding.ts header"},
  {"id":"REQ-014","title":"Analytic volume for a concave fillet","statement":"A concave closing fillet adds r^2 * (1 - PI/4) * L (+/- 2 percent), so volumeChangePercent must be positive for a purely concave operation.","testable":"Existing test FILLET na krawędzi WKLĘSŁEJ dodaje materiał (kształt L); add the numeric volume assertion.","source":"Morphological closing area identity; exact circle-segment area"},
  {"id":"REQ-015","title":"Exact arc, not ellipse, for any dihedral angle","statement":"For an edge with dihedral angle other than 90 degrees the filleted surface must be a circular arc of radius exactly r: the distance from the arc centre to three sampled band points equals r within 1e-9 relative.","testable":"Existing test FILLET: dowolny kąt dwuścienny - powierzchnia to łuk o promieniu r (nie elipsa); assert the distance-to-centre formulation.","source":"Rolling-ball (Minkowski) definition of a fillet; Sellán et al. 2020"},
  {"id":"REQ-016","title":"90 degree corner displacement identity","statement":"For a 90 degree convex edge the corner vertex must move by exactly (sqrt(2) - 1) * r along the bisector and the tangent points must be exactly r from the edge line, within 1e-9.","testable":"Existing test FILLET: sześcian 20mm, r=2, wszystkie 12 krawędzi - geometria dokładnego łuku.","source":"Exact circle geometry for a 90 degree corner; restated in src/utils/edgeRounding.ts header"},
  {"id":"REQ-017","title":"Chamfer geometry","statement":"For a 90 degree edge the chamfer cut plane must be at 45 degrees to both faces and the corner vertex must move by c * sqrt(2) along the bisector.","testable":"Existing test CHAMFER: sześcian, c=2 - płaszczyzna ścinająca 45 stopni; add the c*sqrt(2) displacement assertion.","source":"Exact 45 degree chamfer geometry; UltiMaker and BigRep recommend 45 degree chamfers for FDM"},
  {"id":"REQ-018","title":"Radius clamp is reported","statement":"effectiveRadius must satisfy effectiveRadius <= min(0.5 * median incident edge, 0.5 * min bbox dimension) and effectiveRadius <= requestedRadius; whenever the clamp bites a warning naming the requested and effective radius must be emitted.","testable":"Existing test SAFETY: promień większy niż połowa najkrótszej krawędzi jest przycinany; add the bbox half-dimension case and the warning assertion.","source":"Existing app invariant; local feature size must exceed the fillet radius for a valid result"},
  {"id":"REQ-019","title":"Downward-facing fillet is flagged","statement":"For each processed edge the app must determine whether the fillet creates a downward-facing surface relative to the print-bed normal. If it does, report.downwardFilletCount must be incremented and a chamfer of equivalent size must be recommended.","testable":"Cube on the bed with the bottom four edges filleted => downwardFilletCount === 4 and the warning names the chamfer alternative; top edges only => downwardFilletCount === 0.","source":"Prusa KB (fillets toward the print bed create a very steep overhang - use chamfer); Hydra Research (do not model downward facing fillets); BigRep (fillets introduce continuously increasing overhang angles)"},
  {"id":"REQ-020","title":"Print-bed chamfer recommendation","statement":"Edges lying in the print-bed contact plane must be recommended for a 0.3-0.5 mm chamfer rather than a fillet, to absorb the elephant-foot squish.","testable":"Assert the recommended chamfer size for a bed-plane edge lies in [0.3, 0.5] and is smaller than the fillet recommendation for the same edge.","source":"Prusa KB Elephant foot compensation (~0.2 mm for a 0.4 mm nozzle); Hydra Research Base Chamfers ~0.3 mm; printpal (~0.5 mm)"},
  {"id":"REQ-021","title":"Non-manifold and boundary edges are skipped","statement":"Boundary edges and non-manifold edges must never be filleted; they must be counted in skippedBoundaryEdgeCount and the output must remain manifold.","testable":"Assert skippedBoundaryEdgeCount equals the number of selected boundary/non-manifold edges and that the output mesh satisfies E = 3F/2 for a closed mesh.","source":"Prusa KB (the model to be printed must be solid or have manifold geometry); existing app behaviour in edgeRounding.ts"},
  {"id":"REQ-022","title":"Radius-aware edge selection","statement":"With flatAngleDeg unset the default selection threshold must reject only edges that are geometrically flat for the requested radius (the k2 < -1/r criterion), while the explicit flatAngleDeg override (default 12 degrees) remains available.","testable":"Convex crease with normalAngle = 11 degrees is skipped; normalAngle = 13 degrees with r = 0.8 is processed and the report explains the curvature criterion.","source":"Sellán, Kesten, Sheng, Jacobson, Opening and Closing Surfaces, ACM TOG 2020 (obstacle at k2 = -1/(r+eps); flow active only where k2 < -1/r)"},
  {"id":"REQ-023","title":"Knife edge / grazing case is handled","statement":"When the incident faces are nearly parallel (|n0 x n1| -> 0) or the local thickness W -> 0, the operation must not produce NaN, infinity, self-intersection or a flipped face; the edge must be skipped (skippedShortEdgeCount) or clamped, and the choice must be reported.","testable":"Build a zero-thickness wedge; assert all coordinates finite, flippedFaceCount === 0, degenerateFaceCount === 0 and skippedShortEdgeCount + clampedVertexCount > 0.","source":"Degenerate-input robustness requirement; Sellán et al. 2020 document self-intersection and singularity behaviour for the flow-based alternative"},
  {"id":"REQ-024","title":"Opposing-fillet interference is detected","statement":"Two opposing fillets of radius r on a wall of thickness t interfere when 2r >= t; the app must detect this and either merge them or report the interference, and must never produce a self-intersecting band.","testable":"Wall t = 1.6 mm with two r = 1.0 mm fillets => interference reported; wall t = 4 mm with r = 1 mm => no interference.","source":"Local feature-size constraint (2r must be smaller than the wall thickness); Hydra Research wall thickness >= 2 extrusion line widths"},
  {"id":"REQ-025","title":"Determinism","statement":"Two calls with identical inputs must produce bit-identical outputs (positions, faces, and the full report apart from timing fields).","testable":"Existing test SAFETY: determinizm - dwa uruchomienia daj identyczny wynik.","source":"Existing app invariant; required for reproducible exports"},
  {"id":"REQ-026","title":"No NaN or Infinity in the output","statement":"All output coordinates must be finite.","testable":"Existing test SAFETY: brak NaN/Infinity w wyniku.","source":"Existing app invariant"},
  {"id":"REQ-027","title":"Bounding-box change is bounded and reported","statement":"For a fillet |bboxDelta_i| <= (sqrt(2) - 1) * r + 1e-6 on every axis; for a chamfer |bboxDelta_i| <= c + 1e-6. The measured delta must be reported.","testable":"Assert on the cube fixture and compare report.bboxDelta with the measured value.","source":"Exact corner displacement geometry, section 2.3; flat walls must keep their dimensions"},
  {"id":"REQ-028","title":"Triangle budget is a hard limit","statement":"trianglesAfter must not exceed triangleBudget; when refinement is truncated the report must set refinementLimitedByBudget = true and state the real bandFacetSize.","testable":"Existing test BUDZET: przekroczenie limitu trojkatow jest raportowane, a wynik pozostaje poprawny.","source":"Existing app invariant (refineBand triangle budget); Sellán et al. 2020 (h = PI*r/20 as the target edge length)"},
  {"id":"REQ-029","title":"Refinement does not change the surface","statement":"Edge subdivision alone must preserve the surface: total area and total volume of the subdivided mesh equal those of the input within 1e-9 relative.","testable":"Existing test FILLET: objętość wyniku zgadza się z niezależnym całkowaniem siatki; add a dedicated subdivision-invariance test.","source":"Midpoint edge split is geometrically lossless; existing app doc comment in edgeRounding.ts"},
  {"id":"REQ-030","title":"Radius back-off fallback","statement":"When the analytic operator cannot produce a flip-free result at the requested radius, the app must retry with r/2, r/4, ... down to max(0.8 mm, 2 x nozzle) and succeed with the reduced effectiveRadius, reporting it.","testable":"Force a failure with a pathological fixture => report.effectiveRadius < requestedRadius, report.flippedFaceCount === 0, and a warning naming the reduced radius.","source":"Local feature-size limit (radius cannot exceed the feature size); existing app clamp at 0.5 * median incident edge"},
  {"id":"REQ-031","title":"Explicit warnings for every violated threshold","statement":"report.warnings must contain a specific, actionable message for each of: radius below the printable floor; chordal deviation > 0.05 mm; bandFacetSize > 2*r; budget-limited refinement; clamped or reverted vertices; skipped flat, boundary or short edges; downward-facing fillet detected.","testable":"One test per condition asserting that warnings contains a matching substring.","source":"Prusa KB, Hydra Research, BigRep (threshold values); existing app warning strings in edgeRounding.ts"},
  {"id":"REQ-032","title":"Print-ready surface quality guarantee","statement":"For any radius the app advertises as print-ready, max(chordDeviation, bandFacetSize/2) must be <= 0.5 x nozzle (0.2 mm for a 0.4 mm nozzle); larger radii on a coarse mesh must be flagged as not print-ready.","testable":"For r = 0.8 with segments = 3 on a dense mesh: max(chordDeviation, bandFacetSize/2) <= 0.2; for r = 3.0 on the same mesh the report must warn that the arc is not print-ready.","source":"Prusa KB (0.4 mm nozzle => 0.45 mm extrusion width, 0.2 mm machine accuracy); 3dprintcalcs (min wall = 2 x nozzle)"}
]
```
