// priority: 3

// ships/55_debug.js
// Debug functionality moved to consolidated /ships command in 50_commands.js

// Helper functions for ship debugging (used by other modules)

function resolveTrackedShip(st) {
  if (!st || !st.ship) return null;
  return st.ship;
}

function liveCenter(st) {
  if (!st || !st.ship) return st.lastCenterWorld || {x:0,y:0,z:0};
  try {
    return global.KubeVS.shipCenterWorld(st.ship);
  } catch(_) {
    return st.lastCenterWorld || {x:0,y:0,z:0};
  }
}

// Export helpers for use by other modules
global.resolveTrackedShip = resolveTrackedShip;
global.liveCenter = liveCenter;