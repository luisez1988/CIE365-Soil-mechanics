# Derivation — Terzaghi's 1D consolidation equation

| | |
|---|---|
| Deck | `Rate_Consolidation` |
| Slide | 5 (untitled, between "Process of consolidation" and "Terzaghi's Consolidation Theory") |
| Replaces | `FiguresGeneral/Derivation_consol.svg` |
| Status | approved — wired to slides |

## Statement

> The slide has no textBox. The target is the equation on the next slide: "Results by balancing the mass of water and its volume with the compressibility of the soil skeleton." $\dfrac{\partial u}{\partial t}= C_v \dfrac{\partial ^2 u}{\partial z^2}$, $C_v= \dfrac{k}{\gamma_w m_v}$.

The handwritten slide is titled "1D consolidation" and shows a saturated soil element of height $dz$ with flow $q_{in}$ entering at the bottom, $q_{out}$ leaving at the top, and $dV \neq 0$. A second sketch shows the consolidation curve $\varepsilon_a$ against $\sigma'$ with $m_v$ as the slope of its tangent.

## Given / Find

- A saturated soil element of height $dz$ and unit plan area, so $V = dz \cdot 1$
- Flow is vertical only, $z$ and $q$ positive upward
- Darcy's law, the total head definition $h = z + h_w$ with $h_w = u/\gamma_w$, the coefficient of volume change $m_v$, and the effective stress principle $\sigma' = \sigma - u$
- **Find:** the governing equation for $u(z,t)$, and the coefficient $C_v$ it contains

## Assumptions

The soil is fully saturated, and both the water and the solid grains are incompressible. Any change in volume of the element is water squeezed out of, or drawn into, the pores.

Flow and deformation are one dimensional (vertical). The lateral strains are zero, so the volumetric strain equals the axial strain, $\varepsilon_v = \varepsilon_a$.

Darcy's law holds, and $k$ is constant through the layer and over time.

$m_v$ is constant over the stress increment. The consolidation curve is replaced by its tangent, as the sketch shows.

The total stress does not change once the load is applied, so $\partial \sigma / \partial t = 0$.

$u$ in the derivation is the excess pore pressure. The hydrostatic part of the pore pressure varies linearly with $z$, so its second derivative is zero and it drops out of the equation.

Strains are positive in compression, as everywhere else in the course. This is a change from the handwritten signs; see Flags.

## Solution

The equation comes from writing the conservation of water mass for the element, then replacing the flow with Darcy's law and the volume change with the compressibility of the soil skeleton. The four blocks below follow the handwritten slide.

1. Mass conservation — the water that enters minus the water that leaves equals the change in volume of the element: $q_{in} - q_{out} = \dfrac{\partial V}{\partial t} \;\longrightarrow\; q - \left(q + \dfrac{\partial q}{\partial z}dz\right) = \dfrac{\partial V}{\partial t} \;\longrightarrow\; -\dfrac{\partial q}{\partial z}dz = \dfrac{\partial V}{\partial t}$
2. Darcy's law — $q = -k\dfrac{\partial h}{\partial z} \cdot 1$, so $-\dfrac{\partial q}{\partial z}dz = k\dfrac{\partial^2 h}{\partial z^2}dz$
3. Total head — $h = z + h_w = z + \dfrac{u}{\gamma_w}$ and $\dfrac{\partial^2 z}{\partial z^2} = 0$, so $-\dfrac{\partial q}{\partial z}dz = k\dfrac{\partial^2 (z + h_w)}{\partial z^2}dz = k\dfrac{\partial^2 h_w}{\partial z^2}dz = \dfrac{k}{\gamma_w}\dfrac{\partial^2 u}{\partial z^2}dz$
4. Volume change of the element — in 1D, $\varepsilon_v = \varepsilon_a = -\dfrac{\Delta V}{V}$, so $\partial V = -V\,\partial\varepsilon_a$ with $V = dz \cdot 1$
5. Stress–strain relationship — the slope of the consolidation curve is $m_v = \dfrac{\partial \varepsilon_a}{\partial \sigma'}$, so $\dfrac{\partial V}{\partial t} = -V\dfrac{\partial \varepsilon_a}{\partial t} = -dz \cdot 1\, m_v \dfrac{\partial \sigma'}{\partial t}$
6. Effective stress principle — with $\sigma$ constant, $\dfrac{\partial \sigma'}{\partial t} = \dfrac{\partial (\sigma - u)}{\partial t} = -\dfrac{\partial u}{\partial t}$, so $\dfrac{\partial V}{\partial t} = dz\, m_v \dfrac{\partial u}{\partial t}$
7. Equate steps 3 and 6 — $\dfrac{k}{\gamma_w}\dfrac{\partial^2 u}{\partial z^2}\cancel{dz} = \cancel{dz}\, m_v \dfrac{\partial u}{\partial t} \;\longrightarrow\; \mathbf{\dfrac{\partial u}{\partial t} = \dfrac{k}{\gamma_w m_v}\dfrac{\partial^2 u}{\partial z^2} = C_v \dfrac{\partial^2 u}{\partial z^2}}$, with $\mathbf{C_v = \dfrac{k}{\gamma_w m_v}}$

## Verification

There are no numbers to verify. The script below checks the sign chain numerically. It takes an exact solution of the final equation, $u = 50\sin\left(\frac{\pi z}{2H}\right)\exp\left(-\frac{\pi^2 C_v t}{4H^2}\right)$, and evaluates both sides of the mass balance with finite differences, using each sign convention.

```
Cv = k/(gw*mv) = 2.0387e-07 m2/s  (units: (m/s)/((kN/m3)(m2/kN)) = m2/s)
q=-k dh/dz, dV=-V m_v dsigma'      net inflow = -1.6168e-10   dV/dt = -1.6168e-10   match: True
q=+k dh/dz, dV=+V m_v dsigma' (sheet) net inflow = +1.6168e-10   dV/dt = +1.6168e-10   match: True
q=+k dh/dz, dV=-V m_v dsigma'      net inflow = +1.6168e-10   dV/dt = -1.6168e-10   match: False
du/dt = -3.2336e-07   Cv d2u/dz2 = -3.2336e-07
```

Both the proposed signs and the handwritten signs lead to the same final equation, and the exact solution satisfies it. Only the proposed signs give a negative net inflow while the pore pressure dissipates, which means water leaves the element as it consolidates. Units: $k/(\gamma_w m_v)$ is $(\mathrm{m/s})/(\mathrm{kN/m^3} \cdot \mathrm{m^2/kN}) = \mathrm{m^2/s}$, the units of a diffusion coefficient.

## Scaffolding decisions

Black: each step label, the principle being used ($q_{in} - q_{out} = \partial V/\partial t$, Darcy's law, $h = z + h_w$, $m_v = \partial\varepsilon_a/\partial\sigma'$, $\sigma' = \sigma - u$) and the $=$ chain.

Blue: the expressions where the physics enters. These are $q + \frac{\partial q}{\partial z}dz$ in step 1, $\frac{\partial^2 h}{\partial z^2}$ in step 2, $h_w = u/\gamma_w$ and $\frac{k}{\gamma_w}\frac{\partial^2 u}{\partial z^2}$ in step 3, $V = dz \cdot 1$ in step 4, $m_v\frac{\partial\sigma'}{\partial t}$ in step 5, and $-\frac{\partial u}{\partial t}$ in step 6. These are short expressions, so they are worth blanking even though they are not numbers.

Green: the final equation $\frac{\partial u}{\partial t} = \frac{k}{\gamma_w m_v}\frac{\partial^2 u}{\partial z^2}$ and $C_v = \frac{k}{\gamma_w m_v}$.

Steps 2 and 3 are kept apart, and so are 4, 5 and 6, so that each step uses one principle. The handwritten slide puts 2 and 3 on one line, and 4 and 5 on one line. If the slide is too full, steps 2 and 3 merge back into one line, as on the handwritten slide.

Sketches: the soil element (with "1D consolidation", $q_{in}$, $q_{out}$, $dz$ and $dV \neq 0$) and the consolidation curve sketch are extracted from `Derivation_consol.svg` as two `<img>` files and kept in their present places. The element goes top left, beside steps 1 to 3. The consolidation curve goes bottom left, beside steps 4 to 7. Their labels are symbols only, so they give no blank away. If one slide overflows, the solution splits into two parts at step 4, and the curve sketch moves to the top of the second slide.

Red notes, at most one per step:

- Step 1: The element changes volume, so inflow and outflow are not equal ($dV \neq 0$).
- Step 2: Water flows from high to low head, hence the minus sign.
- Step 3: Use the total head definition. Elevation head is linear in $z$, so its second derivative is zero.
- Step 4: Only water leaves the element, so its volume change is the volume of water squeezed out.
- Step 5: $m_v$ is the slope of the consolidation curve, taken constant over the load step.
- Step 6: The load is applied once, so the total stress does not change with time.
- Step 7: $C_v$ groups the flow property $k$ with the compressibility $m_v$.

None of these restate a blank.

## Flags

The handwritten derivation uses $q = +k\,\partial h/\partial z$ with $z$ and $q$ both upward, and $\partial V = V\,\partial\varepsilon_a$ with a positive $m_v$. Each sign is off on its own, but the two errors cancel, so the final equation is right. The script shows that with the handwritten signs the element takes on water while $u$ dissipates. This `.md` uses $q = -k\,\partial h/\partial z$ and compression-positive strain, $\varepsilon_a = -\Delta V/V$, which matches the strain convention used earlier in the course. The step structure is the same. If you prefer to keep your signs, steps 2, 4 and 5 go back to the handwritten form and the red note on step 2 goes away.

*user* Use compression possitive and fix sign mistakes

The last handwritten line has $\frac{\partial^2 u}{\partial z}$, which should be $\frac{\partial^2 u}{\partial z^2}$. This `.md` corrects it.

*user* Agree

The consolidation curve in the handwritten sketch decreases as $\sigma'$ increases, which matches extension-positive $\varepsilon_a$. With compression-positive strain, the curve should increase with $\sigma'$. In Phase 2 the sketch is reused as it is unless you want it flipped.

*user* Is not decreasing. This is typical plotting of the plot in axial strain space, strains increasing down. Do not change this.

The name `derivation-terzaghi` is not an example number, because this slide is not a numbered example. It does not use up an Example number.

*user* Please preserve my annotation structures in the slide. 

## Review decisions

Compression-positive strain and $q = -k\,\partial h/\partial z$ are used, so each intermediate sign is correct, and $\partial^2 u/\partial z^2$ is fixed in the last line. The consolidation curve sketch is kept as drawn: it plots axial strain increasing downward. The slide keeps the handwritten blocks and their headings ("By mass conservation", "Invoking Darcy's law", "Invoking stress-strain relationships", "Now invoke effective stress principle"), the red underbrace "Use total head definition", the red cancel strokes on $dz$, and the boxed green result beside the last block. The extra red notes proposed above are not on the slide. The two sketches are extracted unchanged as `FiguresGeneral/derivation-element.svg` and `FiguresGeneral/derivation-curve.svg` (text converted to paths so they render without the Gunny Rewritten font) and sit top left and bottom left, as on the original. Blocks 2 and 3 of the Solution list are one step on the slide, and so are blocks 4 and 5, following the handwritten layout.
