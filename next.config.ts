import type { NextConfig } from "next";

/**
 * Config minimale.
 *
 * Storicamente era presente `turbopack.root` per silenziare il warning
 * "multiple lockfiles" causato da un `package.json` orfano nel path padre.
 * Quella causa è stata rimossa; tenere `turbopack.root` forzava Turbopack
 * a partire anche con `next dev` senza flag, e su path con spazi (come
 * "financial AI") il primo compile di Turbopack restava appeso. Il dev
 * server sta ora su Webpack di default (più stabile su macOS con path
 * contenenti spazi). Per provare Turbopack usare `npm run dev:turbo`.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
