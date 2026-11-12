/**
 * RoundEdge — eksport siatki do STL (binarny) i OBJ.
 *
 * Uwagi formatu (potwierdzone w research):
 *  - STL binarny: 80 B nagłówka + uint32 liczba trójkątów + 50 B/trójkąt.
 *  - Nagłówek nie może zaczynać się od "solid" (część czytników uznałaby plik za ASCII).
 *  - Pole "attribute byte count" = 0 (standard; warianty koloru są niekompatybilne).
 *  - Normalne są w STL redundantne — czytniki liczą je z windingu (reguła prawej dłoni),
 *    ale i tak zapisujemy poprawne, jednostkowe wektory.
 *  - Współrzędne w STL są float32: dla części ~200 mm ULP to ~1.5e-5 mm, czyli ~6500×
 *    poniżej tolerancji druku (±0.1 mm). Pozycje w pamięci trzymamy w float64.
 */

import type { MeshData } from './meshTypes.ts';

export const STL_HEADER_BYTES = 80 + 4;

/** Serializuje siatkę do binarnego STL (ArrayBuffer). */
export function meshToBinarySTL(mesh: MeshData): ArrayBuffer {
  const faceCount = mesh.faceCount;
  const buffer = new ArrayBuffer(STL_HEADER_BYTES + faceCount * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Nagłówek: czytelny komentarz, nigdy nie zaczyna się od "solid".
  const label = `RoundEdge 1.0 - binary STL - ${faceCount} triangles`;
  for (let i = 0; i < label.length && i < 79; i++) bytes[i] = label.charCodeAt(i) & 0x7f;

  view.setUint32(80, faceCount, true);

  let offset = 84;
  const { positions, faces, faceNormals } = mesh;
  for (let f = 0; f < faceCount; f++) {
    const a = 3 * faces[3 * f];
    const b = 3 * faces[3 * f + 1];
    const c = 3 * faces[3 * f + 2];

    view.setFloat32(offset, faceNormals[3 * f], true);
    view.setFloat32(offset + 4, faceNormals[3 * f + 1], true);
    view.setFloat32(offset + 8, faceNormals[3 * f + 2], true);

    view.setFloat32(offset + 12, positions[a], true);
    view.setFloat32(offset + 16, positions[a + 1], true);
    view.setFloat32(offset + 20, positions[a + 2], true);

    view.setFloat32(offset + 24, positions[b], true);
    view.setFloat32(offset + 28, positions[b + 1], true);
    view.setFloat32(offset + 32, positions[b + 2], true);

    view.setFloat32(offset + 36, positions[c], true);
    view.setFloat32(offset + 40, positions[c + 1], true);
    view.setFloat32(offset + 44, positions[c + 2], true);

    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return buffer;
}

/** Serializuje siatkę do binarnego STL jako Blob (do pobrania w przeglądarce). */
export function exportToSTL(mesh: MeshData): Blob {
  return new Blob([meshToBinarySTL(mesh)], { type: 'model/stl' });
}

/** Serializuje siatkę do Wavefront OBJ (tekst; indeksy 1-based). */
export function meshToOBJ(mesh: MeshData, name = 'rounded'): string {
  const out: string[] = [`# RoundEdge 1.0 — ${mesh.faceCount} triangles`, `o ${name}`];
  const { positions, faces, faceNormals } = mesh;
  for (let v = 0; v < mesh.vertexCount; v++) {
    out.push(`v ${fmt(positions[3 * v])} ${fmt(positions[3 * v + 1])} ${fmt(positions[3 * v + 2])}`);
  }
  for (let f = 0; f < mesh.faceCount; f++) {
    out.push(
      `vn ${fmt(faceNormals[3 * f])} ${fmt(faceNormals[3 * f + 1])} ${fmt(faceNormals[3 * f + 2])}`,
    );
  }
  for (let f = 0; f < mesh.faceCount; f++) {
    const a = faces[3 * f] + 1;
    const b = faces[3 * f + 1] + 1;
    const c = faces[3 * f + 2] + 1;
    const n = f + 1;
    out.push(`f ${a}//${n} ${b}//${n} ${c}//${n}`);
  }
  return out.join('\n') + '\n';
}

export function exportToOBJ(mesh: MeshData): Blob {
  return new Blob([meshToOBJ(mesh)], { type: 'model/obj' });
}

function fmt(v: number): string {
  // 6 miejsc po przecinku to ~0.001 µm dla typowych części — znacznie poniżej
  // kwantu STL float32 i tolerancji druku.
  const s = v.toFixed(6);
  return s === '-0.000000' ? '0.000000' : s;
}
