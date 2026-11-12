/**
 * Zbiorczy plik testowy — uruchamia wszystkie zestawy w JEDNYM procesie.
 *
 * Dlaczego nie `node --test`: w środowisku o ograniczonym sandboxie runner Node
 * spawnuje procesy potomne z piped stdio, co kończy się EPERM. Uruchomienie
 * `node tests/all.test.ts` wykonuje node:test w tym samym procesie i daje ten sam raport.
 *
 *   npm test
 */
import './topology.test.ts';
import './refinement.test.ts';
import './rounding.test.ts';
import './realmodels.test.ts';
import './pipeline.test.ts';
import './ui.test.ts';
