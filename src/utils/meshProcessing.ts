/**
 * RoundEdge — publiczne API biblioteki przetwarzania siatek.
 *
 * Moduł-zbiorczy (barrel). Importuj stąd:
 *   import { buildMeshFromRaw, roundEdges, exportToSTL } from './utils/meshProcessing.ts';
 */

export type {
  EdgeRecord,
  MeshData,
  MeshDiagnostics,
  RoundingKind,
  RoundingOptions,
  RoundingReport,
  RoundingResult,
} from './meshTypes.ts';

export {
  bboxOf,
  boundingBoxDiagonal,
  buildTopology,
  computeDiagnostics,
  edgeKey,
  orientFacesConsistently,
  pointSegmentDistance,
  signedVolume,
  surfaceArea,
  weldTriangleSoup,
} from './meshTopology.ts';
export type { WeldResult } from './meshTopology.ts';

export { FeatureGrid, roundEdges, subdivideAllEdges, subdivideSelectedEdges } from './edgeRounding.ts';

export {
  buildMeshFromGeometry,
  buildMeshFromRaw,
  extractGeometryData,
  meshToFlatGeometry,
  meshToGeometry,
  objectToTriangleSoup,
} from './meshIO.ts';
export type { MeshBuildOptions, MeshBuildResult } from './meshIO.ts';

export {
  exportToOBJ,
  exportToSTL,
  meshToBinarySTL,
  meshToOBJ,
  STL_HEADER_BYTES,
} from './meshExport.ts';
