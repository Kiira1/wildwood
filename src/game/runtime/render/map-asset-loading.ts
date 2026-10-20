import type { MapId } from "../../world";
import type { CoopAccess } from "../coop-access";
import type { createGameBootstrap, createGameBootstrapAssets } from "../game-bootstrap";
import type { createMapBalanceLoader } from "../map-balance-loader";
import type { createPerformanceMonitor } from "../performance-monitor";
import { backgroundMapPreloadAvailability, createAdjacentMapAssetPreloader } from "./map-asset-preloader";

export type MapAssetLoadingDeps = {
  coop: CoopAccess;
  assets: ReturnType<typeof createGameBootstrapAssets>["assets"];
  mapBalance: Pick<ReturnType<typeof createMapBalanceLoader>, "ensure">;
  mapConfig: ReturnType<typeof createGameBootstrap>["mapConfig"];
  performanceMonitor: ReturnType<typeof createPerformanceMonitor>;
  running: () => boolean;
  lowPerformanceMode: () => boolean;
  /** Travel, a cutscene, a duel or an ad: no time to fetch maps the player is not on. */
  gameplayBusy: () => boolean;
};

/**
 * Loads a map's art and balance before the player arrives, and the maps next to it in quiet moments.
 * The first load is the startup's current-map telemetry stage.
 */
export function createMapAssetLoading(deps: MapAssetLoadingDeps) {
  const { assets } = deps;
  let startupMapAssetsStarted = false;

  function prepare(mapId: MapId) {
    const telemetry = startupMapAssetsStarted
      ? null
      : deps.coop.client?.beginStartupTelemetryStage?.("current-map-assets") ?? null;
    startupMapAssetsStarted = true;
    return Promise.all([assets.ensureMapAssets(mapId), deps.mapBalance.ensure(mapId)]).then(() => {
      if (assets.mapAssetLoadFailed(mapId)) telemetry?.finish("failure", "asset-load-error");
      else telemetry?.finish();
    }, (error) => {
      telemetry?.finish("failure", "asset-load-error");
      throw error;
    });
  }

  const adjacentPreloader = createAdjacentMapAssetPreloader<MapId>({
    mapConfig: deps.mapConfig,
    mapAssetsReady: assets.mapAssetsReady, releaseMapAssetsExcept: (keep) => { assets.releaseMapAssetsExcept(keep); },
    prepareMapAssets: prepare,
    availability: () => {
      const connection = (navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }).connection;
      const performance = deps.performanceMonitor.snapshot();
      return backgroundMapPreloadAvailability({
        running: deps.running(),
        lowPerformanceMode: deps.lowPerformanceMode(),
        documentHidden: document.hidden,
        gameplayBusy: deps.gameplayBusy(),
        workFps: performance.workFps,
        saveData: Boolean(connection?.saveData),
        effectiveConnectionType: connection?.effectiveType,
      });
    },
  });

  return { prepare, preloadAdjacent: adjacentPreloader.queueFrom, cancelPreload: adjacentPreloader.cancel };
}
