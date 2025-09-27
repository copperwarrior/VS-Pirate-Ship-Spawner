// kubejs/server_scripts/ships/70_kubevs_tracker.js
// Valkyrien Skies ship tracker – resolve via AABB, keep centers fresh, prune unloaded ships

var AABB = Java.loadClass('net.minecraft.world.phys.AABB');

var KubeVS = global.KubeVS || null;
if (!KubeVS) {
  // Very explicit message so we don’t chase ghosts
  console.error('[Ships/Track] global.KubeVS is missing. Ensure ships/30_kubevs.js attaches global.KubeVS (Rhino has no globalThis).');
}

var VSGameUtils = null;
try { VSGameUtils = Java.loadClass('org.valkyrienskies.mod.common.VSGameUtilsKt'); } catch(_){ }

// persistent maps/flags (Rhino-safe)
var SHIPS_TRACK = SHIPS_TRACK || {}; // shipId -> state
var BARREL_TRACK = BARREL_TRACK || {}; // barrelId -> { ship, level, pos, createTime }
// TRACK_DBG now managed via global.TRACK_DBG (set by commands)

function logDetail(msg){
  if (!global.TRACK_DBG && !global.DEBUG && !(global.Ships_CFG && global.Ships_CFG.DEBUG)) return;
  try { console.log('[Ships/TrackDBG] ' + msg); } catch(_){ }
}

function logTrack(msg){
  if (!global.TRACK_DBG && !global.DEBUG && !(global.Ships_CFG && global.Ships_CFG.DEBUG)) return;
  try { console.log('[Ships/TrackDBG] '+msg); } catch(_){ }
}

// --- config used by the tracker ---
var TRACK_CFG = TRACK_CFG || {
  settleTicks: 40,
  aabb: { rx: 5, ry: 3, rz: 5 }
};

// ---------- tiny utils ----------
function tell(server, text) { try { server.tell(text); } catch(e){} }
function dbg(server, msg)   { if (!global.TRACK_DBG) return; tell(server, Text.gray('[Ships/Track] ' + msg)); }
function err(server, msg)   { tell(server, Text.red('[Ships/Track] ' + msg)); }

// KubeJS server scheduler helper
function schedule(server, ticks, fn){
  try { server.scheduleInTicks(ticks, fn); }
  catch(e){ err(server, 'scheduleInTicks failed: '+e); }
}

// ---------- ship resolution (AABB-only) ----------
function resolveShipByAabb(level, x, y, z) {
  var rx = TRACK_CFG.aabb.rx, ry = TRACK_CFG.aabb.ry, rz = TRACK_CFG.aabb.rz;
  var box = new AABB(x - rx, y - ry, z - rz, x + rx, y + ry, z + rz);

  dbg(level.server, 'resolving via AABB center='+x+','+y+','+z+' half=' + rx + '/' + ry + '/' + rz);
  logTrack('resolveShipByAabb center='+x+','+y+','+z+' half='+rx+'/'+ry+'/'+rz+' box='+box);

  var list = null;
  try {
    list = KubeVS.shipsInAABB(level, box);
  } catch(e) {
    err(level.server, 'KubeVS.shipsInAABB threw: ' + e);
    logDetail('shipsInAABB threw '+e);
    return null;
  }

  if (!list || list.length === 0) {
    dbg(level.server, 'AABB found 0 ships.');
    logDetail('resolveShipByAabb found 0 ships');
    return null;
  }

  dbg(level.server, 'AABB found ' + list.length + ' ship(s). Listing centers & ids:');
  var best = null, bestD2 = 1/0;
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    var id = '<unknown>';
    var cx = 0, cy = 0, cz = 0;
    try { id = ''+KubeVS.shipId(s); } catch(e){}
    try {
      var c = KubeVS.shipCenterWorld(s);
      cx = c.x|0; cy = c.y|0; cz = c.z|0;
    } catch(e) { }
    dbg(level.server, '  - ship id='+id+' center='+cx+','+cy+','+cz);
    logTrack('resolveShipByAabb candidate id='+id+' center='+cx+','+cy+','+cz);

    var dx = cx - x, dy = cy - y, dz = cz - z;
    var d2 = dx*dx + dy*dy + dz*dz;
    if (d2 < bestD2) { bestD2 = d2; best = s; }
  }

  try {
    var chosenId = ''+KubeVS.shipId(best);
    dbg(level.server, 'chosen nearest ship id='+chosenId+' (d2='+bestD2+')');
    logTrack('resolveShipByAabb chose id='+chosenId+' d2='+bestD2);
  } catch(e) { dbg(level.server, 'chosen ship (id unknown)'); logTrack('resolveShipByAabb chose unknown '+e); }

  return best;
}

function stopTracking(server, shipId){
  var st = SHIPS_TRACK[shipId];
  if (!st) return;
  st.dead = true;
  delete SHIPS_TRACK[shipId];
  dbg(server, 'stopped tracking ship '+shipId);
}

function _matchShipFromList(list, targetId, targetSlug){
  if (!list || !list.length) return null;
  for (var i = 0; i < list.length; i++) {
    var cand = list[i];
    if (!cand) continue;
    var cid = null; var cslug = null;
    try { cid = String(KubeVS.shipId(cand)); } catch(_){ }
    try { cslug = KubeVS.shipSlug(cand); } catch(_){ }
    if ((cid && targetId && cid === targetId) || (cslug && targetSlug && cslug === targetSlug)) {
      return cand;
    }
  }
  return null;
}

function _refreshShip(st){
  if (!st || !st.level) return;
  var level = st.level;
  var targetId = st.id;
  var targetSlug = st.slug || null;
  var hint = st.lastCenterWorld || { x: +(st.anchorX || 0), y: +(st.anchorY || 64), z: +(st.anchorZ || 0) };
  var refreshed = null;
  logTrack('refreshShip start id='+targetId+' slug='+(targetSlug||'(none)')+' hint='+hint.x+','+hint.y+','+hint.z+' numeric='+st.numericId);

  // Use existing ship object if available
  if (st.ship) {
    refreshed = st.ship;
    logDetail('refreshShip using stored ship object -> hit');
  }

  if (!refreshed && typeof st.numericId === 'number') {
    try {
      refreshed = KubeVS.shipByNumericId ? KubeVS.shipByNumericId(level, st.numericId) : null;
      logDetail('refreshShip shipByNumericId -> '+(refreshed?'hit':'miss'));
    } catch(ex){ logDetail('refreshShip shipByNumericId threw '+ex); }
  }

  if (!refreshed && KubeVS.shipBySlug && targetSlug) {
    refreshed = KubeVS.shipBySlug(level, targetSlug);
    logDetail('refreshShip shipBySlug -> '+(refreshed?'hit':'miss'));
  }

  if (!refreshed && KubeVS.resolveShipById) {
    var key = (typeof st.numericId === 'number' && isFinite(st.numericId)) ? st.numericId : targetId;
    try { refreshed = KubeVS.resolveShipById(level, key, hint.x, hint.y, hint.z); } catch(ex){ logDetail('refreshShip resolveShipById threw '+ex); }
    logDetail('refreshShip resolveShipById -> '+(refreshed?'hit':'miss'));
  }

  if (!refreshed && VSGameUtils && typeof VSGameUtils.getShipObjectById === 'function' && typeof st.numericId === 'number') {
    try { refreshed = VSGameUtils.getShipObjectById(level, st.numericId); } catch(ex){ logDetail('refreshShip VS getShipObjectById threw '+ex); }
    logDetail('refreshShip VS getShipObjectById -> '+(refreshed?'hit':'miss'));
  }

  if (!refreshed) {
    var origins = [];
    origins.push(hint);
    origins.push({ x: +(st.anchorX || 0), y: +(st.anchorY || 64), z: +(st.anchorZ || 0) });
    origins.push({ x: 0, y: hint.y || 64, z: 0 });

    var radii = [128, 512, 2048, 8192];
    for (var oi = 0; oi < origins.length && !refreshed; oi++) {
      var origin = origins[oi];
      if (!origin || !isFinite(origin.x) || !isFinite(origin.y) || !isFinite(origin.z)) continue;
      for (var ri = 0; ri < radii.length && !refreshed; ri++) {
        var r = radii[ri];
        var box = new AABB(origin.x - r, origin.y - 256, origin.z - r, origin.x + r, origin.y + 256, origin.z + r);
        try {
          var list = KubeVS.shipsInAABB(level, box);
          refreshed = _matchShipFromList(list, targetId, targetSlug);
        } catch(ex){ logDetail('refreshShip shipsInAABB radius '+r+' threw '+ex); }
        logDetail('refreshShip scan origin='+origin.x+','+origin.y+','+origin.z+' r='+r+' -> '+(refreshed?'hit':'miss'));
      }
    }
  }

  if (!refreshed) {
    try {
      var worldShips = KubeVS.allShips ? KubeVS.allShips(level) : [];
      refreshed = _matchShipFromList(worldShips, targetId, targetSlug);
    } catch(ex){ logDetail('refreshShip allShips threw '+ex); }
    logDetail('refreshShip allShips -> '+(refreshed?'hit':'miss'));
  }

  if (!refreshed && VSGameUtils && typeof VSGameUtils.getShipsIntersecting === 'function') {
    try {
      var big = 3.0e7;
      var minY = (typeof level.minBuildHeight === 'number') ? level.minBuildHeight : -64;
      var maxY = (typeof level.maxBuildHeight === 'number') ? level.maxBuildHeight : 320;
      var worldBox = new AABB(-big, minY, -big, big, maxY, big);
      var viaVs = VSGameUtils.getShipsIntersecting(level, worldBox);
      var listArr = viaVs ? (viaVs.toArray ? viaVs.toArray() : viaVs) : [];
      refreshed = _matchShipFromList(listArr, targetId, targetSlug);
      logDetail('refreshShip VS getShipsIntersecting -> '+(refreshed?'hit':'miss'+' count='+(listArr && listArr.length)))
    } catch(ex){ logDetail('refreshShip VS getShipsIntersecting threw '+ex); }
  }

  if (refreshed) {
    st.ship = refreshed;
    if (!st.slug) {
      try { st.slug = KubeVS.shipSlug(refreshed); } catch(_slug){ }
    }
    logDetail('refreshShip success id='+targetId+' slug='+(st.slug||'(none)'));
  } else {
    logDetail('refreshShip failed to find ship id='+targetId);
  }
}

function _isChunkLoadedNow(level, chunkX, chunkZ){
  try {
    if (typeof level.getChunkSource === 'function'){
      var src = level.getChunkSource();
      if (src && typeof src.getChunkNow === 'function') return src.getChunkNow(chunkX|0, chunkZ|0) != null;
    }
  } catch(_){ }
  return false;
}

function _isShipLoaded(level, ship, cx, cy, cz){
  if (!isFinite(cx) || !isFinite(cy) || !isFinite(cz)) return true; // unknown center → assume loaded to avoid false deletes
  var chunkX = Math.floor(cx / 16);
  var chunkZ = Math.floor(cz / 16);
  return _isChunkLoadedNow(level, chunkX, chunkZ);
}

function _computeCenters(st){
  var level = st.level;
  var ship = st.ship;
  var anchor = { x:+(st.anchorX||0), y:+(st.anchorY||0), z:+(st.anchorZ||0) };
  logTrack('computeCenters start id='+st.id);
  var resultWorld = null;
  var resultShip = null;

  if (KubeVS.worldToShipVec) {
    var shipspace = KubeVS.worldToShipVec(level, ship, anchor.x, anchor.y, anchor.z);
    logDetail('computeCenters worldToShipVec(anchor) -> '+(shipspace? (shipspace.x+','+shipspace.y+','+shipspace.z) : 'null'));
    if (shipspace && isFinite(shipspace.x) && isFinite(shipspace.y) && isFinite(shipspace.z)) {
      resultShip = shipspace;
      if (KubeVS.shipToWorldVec) {
        var worldBack = KubeVS.shipToWorldVec(level, ship, shipspace.x, shipspace.y, shipspace.z);
        logDetail('computeCenters shipToWorldVec(reproject) -> '+(worldBack? (worldBack.x+','+worldBack.y+','+worldBack.z) : 'null'));
        if (worldBack && isFinite(worldBack.x) && isFinite(worldBack.y) && isFinite(worldBack.z)) {
          resultWorld = worldBack;
        }
      }
    }
  }

  if (!resultShip) {
    if (KubeVS.shipToWorldVec) {
      var zero = KubeVS.shipToWorldVec(level, ship, 0, 0, 0);
      logDetail('computeCenters shipToWorldVec(0,0,0) -> '+(zero? (zero.x+','+zero.y+','+zero.z) : 'null'));
      if (zero && isFinite(zero.x) && isFinite(zero.y) && isFinite(zero.z)) {
        resultWorld = zero;
        if (KubeVS.worldToShipVec) {
          var shipzero = KubeVS.worldToShipVec(level, ship, zero.x, zero.y, zero.z);
          logDetail('computeCenters worldToShipVec(re-zero) -> '+(shipzero? (shipzero.x+','+shipzero.y+','+shipzero.z) : 'null'));
          if (shipzero && isFinite(shipzero.x) && isFinite(shipzero.y) && isFinite(shipzero.z)) {
            resultShip = shipzero;
          }
        }
      }
    }
  }

  if (!resultWorld) {
    try {
      var c = KubeVS.shipCenterWorld(ship);
      logDetail('computeCenters shipCenterWorld -> '+(c? (c.x+','+c.y+','+c.z) : 'null'));
      if (c && isFinite(c.x) && isFinite(c.y) && isFinite(c.z) && !(c.x===0 && c.y===0 && c.z===0)) {
        resultWorld = { x:+c.x, y:+c.y, z:+c.z, source:'vs' };
      }
    } catch(ex){ logDetail('computeCenters shipCenterWorld threw '+ex); }
  }

  if (!resultWorld) {
    resultWorld = { x:anchor.x, y:anchor.y, z:anchor.z, source:'anchor' };
    logTrack('computeCenters world fallback anchor');
  }
  if (!resultShip) {
    resultShip = { x:0, y:0, z:0, source:'fallback' };
    logDetail('computeCenters ship fallback 0,0,0');
  }

  logDetail('computeCenters result world='+resultWorld.x+','+resultWorld.y+','+resultWorld.z+' ship='+resultShip.x+','+resultShip.y+','+resultShip.z);
  return { world:resultWorld, ship:resultShip };
}

function _resolveCenter(st){
  if (!st || !st.level) throw new Error('resolveCenter missing state level');

  _refreshShip(st);

  var world = KubeVS.shipCenterWorld(st.ship);
  if (!world || !isFinite(world.x) || !isFinite(world.y) || !isFinite(world.z)) {
    throw new Error('shipCenterWorld returned invalid value for ship '+st.id+' -> '+world);
  }

  var shipVec = KubeVS.worldToShipVec(st.level, st.ship, world.x, world.y, world.z);
  if (!shipVec || !isFinite(shipVec.x) || !isFinite(shipVec.y) || !isFinite(shipVec.z)) {
    throw new Error('worldToShipVec returned invalid value for ship '+st.id);
  }

  st.lastCenterWorld = { x:+world.x, y:+world.y, z:+world.z, source:'vs' };
  st.lastCenterShip = { x:+shipVec.x, y:+shipVec.y, z:+shipVec.z, source:'vs' };

  logTrack('resolveCenter world='+world.x+','+world.y+','+world.z+' ship='+shipVec.x+','+shipVec.y+','+shipVec.z);
  return st.lastCenterWorld;
}

// === PIRATE DETECTION & DECAY SYSTEM ===

function _countPiratesOnShip(level, ship) {
  try {
    var entities = KubeVS.entitiesInShip(level, ship, 'pirates:pirate') || [];
    logTrack('countPiratesOnShip found '+entities.length+' pirates');
    return entities.length;
  } catch(e) {
    logDetail('countPiratesOnShip error: '+e);
    return 0;
  }
}

function _findActualShipBounds(ship, level) {
  try {
    var transform = ship.getTransform();
    var shipCenter = transform.positionInShip;
    
    // Try to get ship AABB first for initial bounds  
    // Use actual world height limits from the level
    var worldMinY = level.getMinBuildHeight(); // Usually -64
    var worldMaxY = level.getMaxBuildHeight() - 1; // Usually 319
    
    // Convert world Y to relative Y (relative to ship center)
    var relativeMinY = worldMinY - Math.floor(shipCenter.y);
    var relativeMaxY = worldMaxY - Math.floor(shipCenter.y);
    
    var searchBounds = { minX: -100, minY: relativeMinY, minZ: -100, maxX: 100, maxY: relativeMaxY, maxZ: 100 };
    
    logDetail('findActualShipBounds world Y range: '+worldMinY+' to '+worldMaxY+', relative to ship center: '+relativeMinY+' to '+relativeMaxY);
    
    if (ship && typeof ship.getShipAABB === 'function') {
      var aabb = ship.getShipAABB();
      if (aabb) {
        // Debug: Print raw AABB values
        logDetail('findActualShipBounds RAW AABB: minX='+aabb.minX+' minY='+aabb.minY+' minZ='+aabb.minZ+' maxX='+aabb.maxX+' maxY='+aabb.maxY+' maxZ='+aabb.maxZ);
        logDetail('findActualShipBounds ship center: x='+shipCenter.x+' y='+shipCenter.y+' z='+shipCenter.z);
        
        // Use AABB coordinates directly - they are exact ship-space block coordinates
        var aabbBounds = {
          minX: Math.floor(aabb.minX),
          minY: Math.floor(aabb.minY),
          minZ: Math.floor(aabb.minZ),
          maxX: Math.ceil(aabb.maxX),
          maxY: Math.ceil(aabb.maxY),
          maxZ: Math.ceil(aabb.maxZ)
        };
        
        logDetail('findActualShipBounds DIRECT ship-space bounds: '+aabbBounds.minX+','+aabbBounds.minY+','+aabbBounds.minZ+' to '+aabbBounds.maxX+','+aabbBounds.maxY+','+aabbBounds.maxZ);
        
        // Calculate dimensions for verification
        var width = aabbBounds.maxX - aabbBounds.minX + 1;
        var height = aabbBounds.maxY - aabbBounds.minY + 1;
        var length = aabbBounds.maxZ - aabbBounds.minZ + 1;
        logDetail('findActualShipBounds ship dimensions: '+width+'x'+height+'x'+length+' blocks');
        
        // Use AABB bounds directly - they are the exact ship-space coordinates
        return aabbBounds;
      } else {
        logDetail('findActualShipBounds ship.getShipAABB() returned null');
      }
    } else {
      logDetail('findActualShipBounds ship.getShipAABB is not a function or ship is null');
    }
    
    // Now scan from bottom up to find the actual lowest block
    var actualMinY = null;
    var actualMaxY = null;
    var actualMinX = null, actualMaxX = null, actualMinZ = null, actualMaxZ = null;
    var blocksFound = 0;
    
    logDetail('findActualShipBounds scanning for actual blocks...');
    
    for (var y = searchBounds.minY; y <= searchBounds.maxY && blocksFound < 100; y++) {
      for (var x = searchBounds.minX; x <= searchBounds.maxX && blocksFound < 100; x++) {
        for (var z = searchBounds.minZ; z <= searchBounds.maxZ && blocksFound < 100; z++) {
          // Calculate actual ship-space coordinates
          var actualX = shipCenter.x + x;
          var actualY = shipCenter.y + y;
          var actualZ = shipCenter.z + z;
          
          var blockPos = new BlockPos(Math.floor(actualX), Math.floor(actualY), Math.floor(actualZ));
          var blockState = level.getBlockState(blockPos);
          
          if (!blockState.isAir()) {
            blocksFound++;
            if (actualMinY === null || y < actualMinY) actualMinY = y;
            if (actualMaxY === null || y > actualMaxY) actualMaxY = y;
            if (actualMinX === null || x < actualMinX) actualMinX = x;
            if (actualMaxX === null || x > actualMaxX) actualMaxX = x;
            if (actualMinZ === null || z < actualMinZ) actualMinZ = z;
            if (actualMaxZ === null || z > actualMaxZ) actualMaxZ = z;
            
            if (blocksFound <= 10) {
              logDetail('findActualShipBounds found block '+blocksFound+' at relative('+x+','+y+','+z+') shipspace('+Math.floor(actualX)+','+Math.floor(actualY)+','+Math.floor(actualZ)+') = '+blockState.getBlock());
            }
          }
        }
      }
    }
    
    if (actualMinY !== null) {
      var result = {
        minX: actualMinX, minY: actualMinY, minZ: actualMinZ,
        maxX: actualMaxX, maxY: actualMaxY, maxZ: actualMaxZ
      };
      logDetail('findActualShipBounds found '+blocksFound+' blocks, actual bounds: '+actualMinX+','+actualMinY+','+actualMinZ+' to '+actualMaxX+','+actualMaxY+','+actualMaxZ);
      return result;
    } else {
      logDetail('findActualShipBounds no blocks found, using search bounds');
      return searchBounds;
    }
    
  } catch(e) {
    logDetail('findActualShipBounds error: '+e);
    // Fallback to reasonable relative bounds if we can't get world limits
    return { minX: -100, minY: -100, minZ: -100, maxX: 100, maxY: 100, maxZ: 100 };
  }
}

function _initDecay(st) {
  if (st.decaying) return; // Already decaying
  
  st.decaying = true;
  st.decayStartTime = Date.now();
  st.decayBounds = _findActualShipBounds(st.ship, st.level);
  st.decayCurrentY = st.decayBounds.minY;
  st.decayLayerPositions = []; // Will hold shuffled positions for current layer
  st.decayLayerIndex = 0; // Current position within the layer
  st.decayLastBlockTime = 0; // Track when last block was processed
  st.decayProgress = 0;
  st.lastSavedCenter = null; // Track center position for final barrel collection
  st.decayChunkCount = 0; // Track number of chunks processed for acceleration
  
  // Initialize continuous sail decay
  st.sailDecayLastTime = 0; // Track timing for sail decay
  st.sailDecayActive = true; // Enable continuous sail decay
  
  // Initialize first layer
  _generateShuffledLayer(st);
  
  // Debug ship positioning removed for performance
  
  var server = st.level ? st.level.server : null;
  if (server) {
    Ships_broadcast(server, '§6[Ships] Ship '+st.id+' ('+st.slug+') is beginning to collapse!');
  }
}

function _processSailDecay(st) {
  if (!st || !st.ship || !st.level || !st.sailDecayActive) {
    return;
  }
  
  var currentTick = global.Ships_tickCounter();
  var sailDecayInterval = 20; // 1 second (20 ticks)
  
  // Check if enough time has passed since last sail decay
  if (currentTick - st.sailDecayLastTime < sailDecayInterval) {
    return; // Not time yet
  }
  
  var level = st.level;
  var bounds = st.decayBounds;
  
  // Find sail blocks starting from the top of the ship
  var sailBlocks = [];
  var totalBlocksChecked = 0;
  var sailBlocksFound = 0;
  
  // Search from top to bottom for sail blocks
  for (var y = bounds.maxY; y >= bounds.minY && sailBlocks.length === 0; y--) {
    // Try several random X,Z positions at this Y level
    for (var attempts = 0; attempts < 10; attempts++) {
      var randomX = bounds.minX + Math.floor(Math.random() * (bounds.maxX - bounds.minX + 1));
      var randomZ = bounds.minZ + Math.floor(Math.random() * (bounds.maxZ - bounds.minZ + 1));
      
      var shipPos = new BlockPos(randomX, y, randomZ);
      var blockState = level.getBlockState(shipPos);
      totalBlocksChecked++;
      
      if (!blockState.isAir()) {
        var isSail = _isSailBlock(blockState);
        if (isSail) {
          sailBlocksFound++;
        }
        
        if (isSail) {
          sailBlocks.push({x: randomX, y: y, z: randomZ});
          break; // Found one at this level, use it
        }
      }
    }
  }
  
  if (sailBlocks.length > 0) {
    var startPos = sailBlocks[0];
    var CFG = global.Ships_CFG;
    var sailFloodfillSize = CFG.SAIL_FLOODFILL_SIZE || 20;
    var sailsRemoved = _floodFillSailDecay(level, startPos.x, startPos.y, startPos.z, st.ship, sailFloodfillSize);
    
    if (sailsRemoved > 0) {
      st.sailDecayLastTime = currentTick;
      
      // Play sack break sound for sail decay
      _playSailBreakSound(st, startPos.x, startPos.y, startPos.z);
    }
  }
}

function _floodFillSailDecay(level, startX, startY, startZ, ship, maxBlocks) {
  var visited = new Set();
  var toProcess = [];
  var blocksProcessed = 0;
  
  // Start with the initial position
  toProcess.push({x: startX, y: startY, z: startZ});
  
  while (toProcess.length > 0 && blocksProcessed < maxBlocks) {
    var current = toProcess.shift();
    var key = current.x + ',' + current.y + ',' + current.z;
    
    // Skip if already visited
    if (visited.has(key)) continue;
    visited.add(key);
    
    // Check if this block exists and is a sail block
    var shipPos = new BlockPos(Math.floor(current.x), Math.floor(current.y), Math.floor(current.z));
    var blockState = level.getBlockState(shipPos);
    
    // Skip air and non-sail blocks
    if (blockState.isAir() || !_isSailBlock(blockState)) {
      continue;
    }
    
    // Process this sail block
    if (_makeBlockFallShipSpace(level, current.x, current.y, current.z, ship)) {
      blocksProcessed++;
      
      // Add adjacent blocks to the flood fill queue (26-directional including diagonals)
      var adjacent = [];
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          for (var dz = -1; dz <= 1; dz++) {
            // Skip the center block (0,0,0)
            if (dx === 0 && dy === 0 && dz === 0) continue;
            adjacent.push({
              x: current.x + dx,
              y: current.y + dy,
              z: current.z + dz
            });
          }
        }
      }
      
      for (var i = 0; i < adjacent.length; i++) {
        var adjKey = adjacent[i].x + ',' + adjacent[i].y + ',' + adjacent[i].z;
        if (!visited.has(adjKey)) {
          toProcess.push(adjacent[i]);
        }
      }
    }
  }
  
  return blocksProcessed;
}

function _playSailBreakSound(st, chunkX, chunkY, chunkZ) {
  try {
    if (!st || !st.level) return;
    
    var level = st.level;
    var SoundSource = Java.loadClass('net.minecraft.sounds.SoundSource');
    
    // Random pitch between 0.04 and 0.1
    var pitch = 0.04 + Math.random() * 0.06;
    var volume = 0.5;
    
    // Play sack break sound for sail decay
    try {
      level.playSound(null, chunkX + 0.5, chunkY + 0.5, chunkZ + 0.5, 
                     'supplementaries:block.sack.break', 
                     SoundSource.BLOCKS, 
                     volume, pitch);
    } catch (soundError) {
      // Fallback if supplementaries sound not available
      level.playSound(null, chunkX + 0.5, chunkY + 0.5, chunkZ + 0.5, 
                     'minecraft:block.wool.break', 
                     SoundSource.BLOCKS, 
                     volume, pitch);
    }
    
    logDetail('playSailBreakSound played sack break at ship-space ('+chunkX+','+chunkY+','+chunkZ+')');
  } catch (e) {
    logDetail('playSailBreakSound error: '+e);
  }
}

function _isSailBlock(blockState) {
    var block = blockState.getBlock();
    var blockId = block.getId();
    
    // Debug: Log every block we check for now to see what's available
    // Checking for sail blocks
    
    // Method 0: THE CORRECT WAY - Check ITEM tag, not block tag!
    // Based on the VS_Sails code: state.getBlock().asItem().getDefaultInstance().is(tag)
    
      if (typeof block.asItem === 'function') {
        var item = block.asItem();
        
        if (typeof item.getDefaultInstance === 'function') {
          var itemStack = item.getDefaultInstance();
          
          // Try KubeJS hasTag method first (recommended approach)
          if (typeof itemStack.hasTag === 'function') {
            var tagVariants = [
              'minecraft:sail_togglers',  // Full namespace version
              'sail_togglers'             // Short version
            ];
            
            for (var i = 0; i < tagVariants.length; i++) {
              var tagName = tagVariants[i];
              try {
                var hasTagResult = itemStack.hasTag(tagName);
                if (hasTagResult) {
                  return true;
                }
              } catch (tagError) {
              }
            }
          }
          
          // Fallback to itemStack.is() method
          if (typeof itemStack.is === 'function') {
            var tagVariants = [
              'minecraft:sail_togglers',  // Full namespace version
              'sail_togglers'             // Short version
            ];
            
            for (var i = 0; i < tagVariants.length; i++) {
              var tagName = tagVariants[i];
                var itemIsResult = itemStack.is(tagName);
                if (blockId.includes('sail')) {
                  logDetail('isSailBlock '+blockId+' itemStack.is("'+tagName+'") = '+itemIsResult);
                }
                if (itemIsResult) {
                  return true;
                }
            }
          } else if (blockId.includes('sail')) {
            logDetail('isSailBlock '+blockId+' itemStack methods - hasTag: '+typeof itemStack.hasTag+', is: '+typeof itemStack.is);
          }
        } else if (blockId.includes('sail')) {
          logDetail('isSailBlock '+blockId+' item.getDefaultInstance not available, type: '+typeof item.getDefaultInstance);
        }
      }
    return false;
}

function _processDecay(st) {
  if (!st.decaying || !st.ship || !st.level) return false;
  
  var bounds = st.decayBounds;
  var currentTick = global.Ships_tickCounter();
  
  // Calculate progressive speed based on chunk count: start slow, get faster
  var accelerationChunks = (global.Ships_CFG && global.Ships_CFG.DECAY_ACCELERATION) || 50; // Reach max speed after 50 chunks
  var progress = Math.min(st.decayChunkCount / accelerationChunks, 1.0); // 0.0 to 1.0
  
  var startTicks = (global.Ships_CFG && global.Ships_CFG.DECAY_START_TICKS) || 60; // 3 seconds
  var endTicks = (global.Ships_CFG && global.Ships_CFG.DECAY_END_TICKS) || 20; // 1 second
  var ticksPerBlock = Math.floor(startTicks - (startTicks - endTicks) * progress);
  
  // Ensure decay state is properly initialized (for ships that were decaying before the update)
  if (st.decayLayerPositions === undefined || st.decayLayerIndex === undefined || st.decayLastBlockTime === undefined || st.decayBounds === undefined || st.decayChunkCount === undefined) {
    st.decayBounds = _findActualShipBounds(st.ship, st.level);
    bounds = st.decayBounds;
    st.decayCurrentY = bounds.minY;
    st.decayLayerPositions = [];
    st.decayLayerIndex = 0;
    st.decayLastBlockTime = 0;
    st.decayChunkCount = st.decayChunkCount || 0; // Keep existing count if available
    _generateShuffledLayer(st);
  }
  
  // Check if enough time has passed since last block
  if (currentTick - st.decayLastBlockTime < ticksPerBlock) {
    return false; // Not time yet
  }
  
  // Loop through shuffled positions until we find a block or reach the end
  var attempts = 0;
  var maxAttempts = 200; // Prevent infinite loops, process up to 200 air blocks per tick
  
  while (attempts < maxAttempts) {
    // Check if we've processed all layers
    if (st.decayCurrentY > bounds.maxY) {
      _completeDecay(st);
      return true; // Signal that ship should be removed
    }
    
    // Check if we need to move to next layer
    if (st.decayLayerIndex >= st.decayLayerPositions.length) {
      st.decayCurrentY++;
      if (st.decayCurrentY > bounds.maxY) {
        _completeDecay(st);
        return true;
      }
      _generateShuffledLayer(st);
    }
    
    // Get current position from shuffled layer
    var pos = st.decayLayerPositions[st.decayLayerIndex];
    
    // Calculate progressive floodfill size based on chunk count: start small, get bigger
    var accelerationChunks = (global.Ships_CFG && global.Ships_CFG.DECAY_ACCELERATION) || 50; // Reach max size after 50 chunks
    var progress = Math.min(st.decayChunkCount / accelerationChunks, 1.0); // 0.0 to 1.0
    
    var CFG = global.Ships_CFG;
    var startSize = CFG.DECAY_FLOODFILL_START;
    var endSize = CFG.DECAY_FLOODFILL_END;
    var floodFillSize = Math.floor(startSize + (endSize - startSize) * progress);
    
    // Every 20 chunks, create barrel ships from nearby dropped items using last saved center
    if (st.decayChunkCount > 0 && st.decayChunkCount % 20 === 0 && st.lastSavedCenter) {
      _createFinalBarrelCollection(st.level, st.lastSavedCenter.x, st.lastSavedCenter.y, st.lastSavedCenter.z, st.id + '_chunk' + st.decayChunkCount);
    }
    
    // Try to process current position with progressive floodfill
    var blocksProcessed = _processBlockClump(st.level, pos.x, st.decayCurrentY, pos.z, st.ship, floodFillSize);
    
      if (blocksProcessed > 0) {
        // Found and processed blocks - wait before next clump
        st.decayProgress += blocksProcessed;
        st.decayChunkCount++; // Increment chunk counter for acceleration
        st.decayLastBlockTime = currentTick;
        
        // Save current ship center position for final barrel collection
        try {
          if (global.KubeVS && global.KubeVS.shipCenterWorld && st.ship) {
            var currentCenter = global.KubeVS.shipCenterWorld(st.ship);
            if (currentCenter) {
              st.lastSavedCenter = {
                x: currentCenter.x,
                y: currentCenter.y,
                z: currentCenter.z
              };
            }
          }
        } catch (centerErr) {
          // Failed to save center position - continue silently
        }
        
        // Block processing completed

        // Play chunk break sound effect
        _playChunkBreakSound(st, pos.x, st.decayCurrentY, pos.z);

        // Advance to next position in layer
        st.decayLayerIndex++;
        return false; // Wait for next tick with progressive delay
      } else {
      // No blocks found - advance position and try again immediately
      st.decayLayerIndex++;
      attempts++;
      // Continue loop to try next position immediately
    }
  }
  
  // If we hit max attempts, we'll try again next tick
  return false;
}

function _processBlockClump(level, centerX, centerY, centerZ, ship, floodFillSize) {
  // Use floodfill to spread from the center point to adjacent solid blocks
  var blocksProcessed = _floodFillDecay(level, centerX, centerY, centerZ, ship, floodFillSize);
  
  return blocksProcessed;
}

function _floodFillDecay(level, startX, startY, startZ, ship, maxBlocks) {
  var visited = new Set();
  var toProcess = [];
  var blocksProcessed = 0;
  
  // Start with the initial position
  toProcess.push({x: startX, y: startY, z: startZ});
  
  while (toProcess.length > 0 && blocksProcessed < maxBlocks) {
    var current = toProcess.shift();
    var key = current.x + ',' + current.y + ',' + current.z;
    
    // Skip if already visited
    if (visited.has(key)) continue;
    visited.add(key);
    
    // Check if this block exists and can be made to fall
    var shipPos = new BlockPos(Math.floor(current.x), Math.floor(current.y), Math.floor(current.z));
    var blockState = level.getBlockState(shipPos);
    
    // Skip air and already-falling blocks
    if (blockState.isAir() || blockState.getBlock().toString().includes('falling')) {
      continue;
    }
    
    // Process this block
    if (_makeBlockFallShipSpace(level, current.x, current.y, current.z, ship)) {
      blocksProcessed++;
      
      // Add adjacent blocks to the flood fill queue (26-directional including diagonals)
      var adjacent = [];
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          for (var dz = -1; dz <= 1; dz++) {
            // Skip the center block (0,0,0)
            if (dx === 0 && dy === 0 && dz === 0) continue;
            adjacent.push({
              x: current.x + dx,
              y: current.y + dy,
              z: current.z + dz
            });
          }
        }
      }
      
      for (var i = 0; i < adjacent.length; i++) {
        var adjKey = adjacent[i].x + ',' + adjacent[i].y + ',' + adjacent[i].z;
        if (!visited.has(adjKey)) {
          toProcess.push(adjacent[i]);
        }
      }
    }
  }
  
  return blocksProcessed;
}

function _generateShuffledLayer(st) {
  var bounds = st.decayBounds;
  st.decayLayerPositions = [];
  st.decayLayerIndex = 0;
  
  // Generate all X,Z positions for current Y layer
  for (var x = bounds.minX; x <= bounds.maxX; x++) {
    for (var z = bounds.minZ; z <= bounds.maxZ; z++) {
      st.decayLayerPositions.push({ x: x, z: z });
    }
  }
  
  // Shuffle the positions using Fisher-Yates algorithm
  for (var i = st.decayLayerPositions.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = st.decayLayerPositions[i];
    st.decayLayerPositions[i] = st.decayLayerPositions[j];
    st.decayLayerPositions[j] = temp;
  }
}

function _makeBlockFallShipSpace(level, shipSpaceX, shipSpaceY, shipSpaceZ, ship) {
  try {
    logDetail('makeBlockFallShipSpace processing ship-space coordinates ('+shipSpaceX+','+shipSpaceY+','+shipSpaceZ+')');
    
    var shipPos = new BlockPos(Math.floor(shipSpaceX), Math.floor(shipSpaceY), Math.floor(shipSpaceZ));
    
    // Get block state at this ship-space coordinate
    var blockState = level.getBlockState(shipPos);
    
    logDetail('makeBlockFallShipSpace blockState at ship-space('+Math.floor(shipSpaceX)+','+Math.floor(shipSpaceY)+','+Math.floor(shipSpaceZ)+'): '+(blockState.isAir() ? 'AIR' : blockState.getBlock()));
    
    // Skip air and already-falling blocks
    if (blockState.isAir() || blockState.getBlock().toString().includes('falling')) {
      logDetail('makeBlockFallShipSpace skipping AIR/falling block at ship-space('+Math.floor(shipSpaceX)+','+Math.floor(shipSpaceY)+','+Math.floor(shipSpaceZ)+')');
      return false;
    }
    
    // Create falling block entity at the ship space position
    var FallingBlockEntity = Java.loadClass('net.minecraft.world.entity.item.FallingBlockEntity');
    var fallingBlock = FallingBlockEntity.fall(level, shipPos, blockState);
    
    if (fallingBlock) {
      // Fix UUID collisions by generating a fresh UUID
      var UUID = Java.loadClass('java.util.UUID');
      fallingBlock.setUUID(UUID.randomUUID());
      // Add some randomness to prevent UUID collisions and make it look more natural
      var randomOffsetX = Math.random() * 0.6 - 0.3; // Random between -0.3 and 0.3
      var randomOffsetZ = Math.random() * 0.6 - 0.3;
      
      // Set position in ship space - VS2 will transform to world space automatically when added
      // Move down by 0.5 Y to prevent immediate collision with ship
      fallingBlock.setPos(shipSpaceX + 0.5 + randomOffsetX, shipSpaceY - 0.5, shipSpaceZ + 0.5 + randomOffsetZ);
      
      // Set the original block to air in ship space
      var air = Java.loadClass('net.minecraft.world.level.block.Blocks').AIR.defaultBlockState();
      level.setBlock(shipPos, air, 3);
      
      // Add the falling block to the world - VS2 handles the coordinate transformation
      level.addFreshEntity(fallingBlock);
      
      logDetail('makeBlockFallShipSpace converted block at ship-space('+shipSpaceX+','+shipSpaceY+','+shipSpaceZ+') to falling block');
      return true;
    }
  } catch(e) {
    logDetail('makeBlockFallShipSpace error at ship-space('+shipSpaceX+','+shipSpaceY+','+shipSpaceZ+'): '+e);
  }
  
  return false;
}

function _playChunkBreakSound(st, chunkX, chunkY, chunkZ) {
  try {
    if (!st || !st.level) {
      logDetail('playChunkBreakSound missing requirements: st='+!!st+' level='+!!st?.level);
      return;
    }
    
    var level = st.level;
    var SoundEvents = Java.loadClass('net.minecraft.sounds.SoundEvents');
    var SoundSource = Java.loadClass('net.minecraft.sounds.SoundSource');
    
    // Random pitch between 0.04 and 0.1
    var pitch = 0.04 + Math.random() * 0.06; // 0.04 to 0.1
    var volume = 0.5; // Moderate volume
    
    // Play sound at ship-space coordinates - VS2 handles the transformation automatically!
    level.playSound(null, chunkX + 0.5, chunkY + 0.5, chunkZ + 0.5, 
                   SoundEvents.ZOMBIE_ATTACK_WOODEN_DOOR, 
                   SoundSource.BLOCKS, 
                   volume, pitch);
    
    logDetail('playChunkBreakSound played at ship-space ('+chunkX+','+chunkY+','+chunkZ+') volume='+volume+' pitch='+pitch.toFixed(3));
  } catch (e) {
    logDetail('playChunkBreakSound error: '+e);
  }
}






function _createPeriodicBarrelShips(st, chunkX, chunkY, chunkZ) {
  if (!st || !st.level || !st.ship) return;
  
  var level = st.level;
  
  // Convert ship-space coordinates to world coordinates for the processed chunk
  var worldPos = null;
  if (global.KubeVS && global.KubeVS.shipToWorldVec) {
    worldPos = global.KubeVS.shipToWorldVec(st.ship, chunkX, chunkY, chunkZ);
  }
  
  if (!worldPos) {
    // Fallback to ship center if conversion fails
    if (st.ship && global.KubeVS && global.KubeVS.shipCenterWorld) {
      worldPos = global.KubeVS.shipCenterWorld(st.ship);
    } else if (st.lastCenter) {
      worldPos = st.lastCenter;
    }
  }
  
  if (!worldPos) {
    logDetail('createPeriodicBarrelShips ship='+st.id+' no world position available, skipping barrel creation');
    return;
  }
  
  var collectRadius = 25; // 50x50x50 area (25 blocks in each direction)
  
  // Create AABB for item collection around the world position of the processed chunk
  var minX = worldPos.x - collectRadius;
  var minY = Math.max(level.getMinBuildHeight(), worldPos.y - collectRadius);
  var minZ = worldPos.z - collectRadius;
  var maxX = worldPos.x + collectRadius;
  var maxY = Math.min(level.getMaxBuildHeight(), worldPos.y + collectRadius);
  var maxZ = worldPos.z + collectRadius;
  
  var AABB = Java.loadClass('net.minecraft.world.phys.AABB');
  var collectionAABB = new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  
  // Find all item entities in the area
  var ItemEntityClass = Java.loadClass('net.minecraft.world.entity.item.ItemEntity');
  var itemEntities = level.getEntitiesOfClass(ItemEntityClass, collectionAABB);
  
  if (!itemEntities || itemEntities.size() === 0) {
    logDetail('createPeriodicBarrelShips ship='+st.id+' no items found in collection area');
    return;
  }
  
  logTrack('createPeriodicBarrelShips ship='+st.id+' found '+itemEntities.size()+' dropped items');
  
  // Collect all items
  var allItems = [];
  var iterator = itemEntities.iterator();
  while (iterator.hasNext()) {
    var itemEntity = iterator.next();
    var itemStack = itemEntity.getItem();
    
    if (itemStack && !itemStack.isEmpty()) {
      allItems.push(itemStack.copy());
      itemEntity.discard(); // Remove from world
    }
  }
  
  if (allItems.length === 0) {
    logTrack('createPeriodicBarrelShips ship='+st.id+' no valid items collected');
    return;
  }
  
  // Group items into barrel-sized chunks (27 items per barrel)
  var itemsPerBarrel = 27;
  var barrelCount = 0;
  
  // Create barrel ships spread out around the collection center
  var spreadRadius = 15; // Spread barrels over 30x30 area around collection point
  var startIndex = 0;
  
  while (startIndex < allItems.length) {
    var barrelItems = allItems.slice(startIndex, startIndex + itemsPerBarrel);
    
    // Find spread out position for this barrel ship around the world position
    var barrelPos = _findSpreadPosition(level, worldPos.x, worldPos.y, worldPos.z, barrelCount, spreadRadius);
    _createBarrelShip(level, barrelPos.x, barrelPos.y, barrelPos.z, barrelItems, st.decayChunkCount + '_' + barrelCount);
    
    barrelCount++;
    startIndex += itemsPerBarrel;
  }
}


function _findSpreadPosition(level, centerX, centerY, centerZ, barrelIndex, spreadRadius) {
  // Create a more spread out distribution using a spiral pattern
  var angle = barrelIndex * 2.4; // Golden angle for even distribution
  var distance = Math.sqrt(barrelIndex) * 3; // Gradually increase distance
  
  // Cap distance to stay within spread radius
  if (distance > spreadRadius) {
    distance = spreadRadius * (0.5 + 0.5 * Math.random()); // Random within outer area
  }
  
  var offsetX = Math.cos(angle) * distance;
  var offsetZ = Math.sin(angle) * distance;
  
  // Find water surface and place barrels underwater (below y=63)
  var targetX = Math.floor(centerX + offsetX);
  var targetZ = Math.floor(centerZ + offsetZ);
  
  // Start from y=63 and go down to find water
  var targetY = Math.min(63, centerY);
  var foundWater = false;
  
  // Look for water blocks, going down from y=63
  for (var y = targetY; y >= level.getMinBuildHeight() + 5; y--) {
    var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
    var checkPos = new BlockPos(targetX, y, targetZ);
    var blockState = level.getBlockState(checkPos);
    
    // Check if block is water (directly check block ID)
    var blockId = blockState.getBlock().getId();
    if (blockId === 'minecraft:water' || blockId === 'minecraft:flowing_water') {
      // Found water, place barrel 2-5 blocks underwater
      var underwaterDepth = 2 + Math.floor(Math.random() * 4); // 2-5 blocks deep
      targetY = y - underwaterDepth;
      foundWater = true;
      break;
    }
  }
  
  // If no water found, default to a safe underwater position
  if (!foundWater) {
    targetY = Math.min(50, centerY - 10); // Default deep position
  }
  
  logDetail('findSpreadPosition barrel #' + barrelIndex + ' at (' + targetX + ',' + targetY + ',' + targetZ + ') foundWater=' + foundWater);
  
  return {
    x: targetX,
    y: targetY,
    z: targetZ
  };
}

function _createBarrelShip(level, x, y, z, items, barrelNumber) {
  try {
    var BlockPos = Java.loadClass('net.minecraft.core.BlockPos');
    var Blocks = Java.loadClass('net.minecraft.world.level.block.Blocks');
    
    var barrelPos = new BlockPos(x, y, z);
    var barrelState = Blocks.BARREL.defaultBlockState();
    
    // Apply random rotation to the barrel blockstate
    try {
      // Barrels can face 6 directions (up, down, north, south, east, west)
      var Direction = Java.loadClass('net.minecraft.core.Direction');
      var directions = [
        Direction.UP,
        Direction.DOWN, 
        Direction.NORTH,
        Direction.SOUTH,
        Direction.EAST,
        Direction.WEST
      ];
      
      var randomDirection = directions[Math.floor(Math.random() * directions.length)];
      var BlockStateProperties = Java.loadClass('net.minecraft.world.level.block.state.properties.BlockStateProperties');
      
      // Set the FACING property to random direction
      if (barrelState.hasProperty && barrelState.hasProperty(BlockStateProperties.FACING)) {
        barrelState = barrelState.setValue(BlockStateProperties.FACING, randomDirection);
        logDetail('createBarrelShip applied random rotation: facing=' + randomDirection);
      } else {
        logDetail('createBarrelShip barrel does not have FACING property');
      }
    } catch (rotationError) {
      logDetail('createBarrelShip blockstate rotation failed: ' + rotationError + ' - using default orientation');
    }
    
    logDetail('createBarrelShip placing barrel ship #'+barrelNumber+' at ('+x+','+y+','+z+') with '+items.length+' items');
    
    // First, place the barrel block with rotation
    level.setBlock(barrelPos, barrelState, 3);
    
    // Fill the barrel with items
    var blockEntity = level.getBlockEntity(barrelPos);
    if (blockEntity && blockEntity.getContainerSize) {
      for (var i = 0; i < items.length && i < blockEntity.getContainerSize(); i++) {
        blockEntity.setItem(i, items[i]);
      }
      blockEntity.setChanged();
      logDetail('createBarrelShip filled barrel with '+items.length+' items');
    }
    
    // Attempt to convert the barrel block into a Valkyrien Skies ship
    try {
      if (global.KubeVS && global.KubeVS.createShip) {
        var ship = global.KubeVS.createShip(level, barrelPos);
        if (ship) {
          logTrack('createBarrelShip SUCCESS: Created VS ship for barrel #'+barrelNumber+' at ('+x+','+y+','+z+') ship='+ship);
          
          // Track barrel for cleanup
          var barrelId = 'barrel_' + barrelNumber + '_' + Date.now();
          BARREL_TRACK[barrelId] = {
            ship: ship,
            level: level,
            pos: { x: x, y: y, z: z },
            createTime: Date.now(),
            barrelNumber: barrelNumber
          };
          logDetail('createBarrelShip tracked barrel ' + barrelId + ' for cleanup');
        } else {
          logDetail('createBarrelShip KubeVS.createShip returned null for barrel #'+barrelNumber+' - continuing investigation');
        }
      } else {
        logDetail('createBarrelShip KubeVS.createShip not available');
      }
    } catch (shipError) {
      logDetail('createBarrelShip ship creation failed for barrel #'+barrelNumber+': '+shipError);
    }
    
  } catch (e) {
    logDetail('createBarrelShip error: '+e);
  }
}


function _completeDecay(st) {
  if (!st) return;
  
  st.decaying = false;
  st.decayCompleted = true;
  
  // Do final barrel collection using last saved center position
  if (st.lastSavedCenter && st.level) {
    logTrack('completeDecay ship='+st.id+' performing final barrel collection at last saved center ('+st.lastSavedCenter.x.toFixed(1)+','+st.lastSavedCenter.y.toFixed(1)+','+st.lastSavedCenter.z.toFixed(1)+')');
    _createFinalBarrelCollection(st.level, st.lastSavedCenter.x, st.lastSavedCenter.y, st.lastSavedCenter.z, st.id);
  } else {
    logTrack('completeDecay ship='+st.id+' no saved center position available for final barrel collection');
  }
  
  var server = st.level ? st.level.server : null;
  if (server) {
    Ships_broadcast(server, '§8[Ships] Ship '+st.id+' has completely collapsed into the depths... §6Salvage barrels are floating away!');
  }
}

function _createFinalBarrelCollection(level, centerX, centerY, centerZ, shipId) {
  if (!level) return;
  
  logTrack('createFinalBarrelCollection ship='+shipId+' collecting items in 100x100x100 area around ('+centerX.toFixed(1)+','+centerY.toFixed(1)+','+centerZ.toFixed(1)+')');
  
  // Collect items in 100x100x100 area (50 block radius)
  var collectRadius = 50;
  var minX = centerX - collectRadius;
  var minY = Math.max(level.getMinBuildHeight(), centerY - collectRadius);
  var minZ = centerZ - collectRadius;
  var maxX = centerX + collectRadius;
  var maxY = Math.min(level.getMaxBuildHeight(), centerY + collectRadius);
  var maxZ = centerZ + collectRadius;
  
  var AABB = Java.loadClass('net.minecraft.world.phys.AABB');
  var collectionAABB = new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  var ItemEntityClass = Java.loadClass('net.minecraft.world.entity.item.ItemEntity');
  var itemEntities = level.getEntitiesOfClass(ItemEntityClass, collectionAABB);
  
  if (!itemEntities || itemEntities.size() === 0) {
    logTrack('createFinalBarrelCollection ship='+shipId+' no items found in collection area');
    return;
  }
  
  logTrack('createFinalBarrelCollection ship='+shipId+' found '+itemEntities.size()+' dropped items');
  
  // Collect all items
  var allItems = [];
  var iterator = itemEntities.iterator();
  while (iterator.hasNext()) {
    var itemEntity = iterator.next();
    var itemStack = itemEntity.getItem();
    if (itemStack && !itemStack.isEmpty()) {
      allItems.push(itemStack.copy());
      itemEntity.discard(); // Remove the item entity
    }
  }
  
  if (allItems.length === 0) {
    logTrack('createFinalBarrelCollection ship='+shipId+' no valid items collected');
      return;
    }
  
  // Create barrel ships with collected items
  var itemsPerBarrel = 27; // Standard barrel capacity
  var barrelCount = 0;
  var spreadRadius = 25; // Spread barrels over 50x50 area
  var startIndex = 0;
  
  while (startIndex < allItems.length) {
    var barrelItems = allItems.slice(startIndex, startIndex + itemsPerBarrel);
    var barrelPos = _findSpreadPosition(level, centerX, centerY, centerZ, barrelCount, spreadRadius);
    _createBarrelShip(level, barrelPos.x, barrelPos.y, barrelPos.z, barrelItems, shipId + '_final_' + barrelCount);
    barrelCount++;
    startIndex += itemsPerBarrel;
  }
  
  logTrack('createFinalBarrelCollection ship='+shipId+' created '+barrelCount+' final barrel ships with '+allItems.length+' total items');
}

function _processBarrelCleanup() {
  var CFG = global.Ships_CFG;
  if (!CFG || CFG.BARREL_DESPAWN_MINUTES <= 0) return; // Cleanup disabled
  
  var currentTime = Date.now();
  var despawnTimeMs = CFG.BARREL_DESPAWN_MINUTES * 60 * 1000; // Convert to milliseconds
  var barrelIds = Object.keys(BARREL_TRACK);
  var removedCount = 0;
  
  for (var i = 0; i < barrelIds.length; i++) {
    var barrelId = barrelIds[i];
    var barrel = BARREL_TRACK[barrelId];
    
    if (!barrel) continue;
    
    var age = currentTime - barrel.createTime;
    if (age >= despawnTimeMs) {
      // Barrel is old enough to despawn
      try {
        if (barrel.ship && global.KubeVS && global.KubeVS.removeShip) {
          var removed = global.KubeVS.removeShip(barrel.ship);
          if (removed) {
            logDetail('processBarrelCleanup despawned barrel ' + barrelId + ' after ' + (age / 60000).toFixed(1) + ' minutes');
            removedCount++;
          } else {
            logDetail('processBarrelCleanup failed to remove barrel ship ' + barrelId);
          }
        }
      } catch (removeErr) {
        logDetail('processBarrelCleanup error removing barrel ' + barrelId + ': ' + removeErr);
      }
      
      // Remove from tracking regardless of success
      delete BARREL_TRACK[barrelId];
    }
  }
  
  if (removedCount > 0) {
    logTrack('processBarrelCleanup removed ' + removedCount + ' expired barrels (age limit: ' + CFG.BARREL_DESPAWN_MINUTES + ' minutes)');
  }
}

function _cleanupAllBarrels() {
  var barrelIds = Object.keys(BARREL_TRACK);
  var removedCount = 0;
  
  logTrack('cleanupAllBarrels removing ' + barrelIds.length + ' tracked barrels');
  
  for (var i = 0; i < barrelIds.length; i++) {
    var barrelId = barrelIds[i];
    var barrel = BARREL_TRACK[barrelId];
    
    if (!barrel) continue;
    
    try {
      if (barrel.ship && global.KubeVS && global.KubeVS.removeShip) {
        var removed = global.KubeVS.removeShip(barrel.ship);
        if (removed) {
          removedCount++;
        }
      }
    } catch (removeErr) {
      logDetail('cleanupAllBarrels error removing barrel ' + barrelId + ': ' + removeErr);
    }
    
    delete BARREL_TRACK[barrelId];
  }
  
  logTrack('cleanupAllBarrels removed ' + removedCount + ' barrels');
}

function _testCreateBarrelShipsAt(level, x, y, z) {
  if (!level) return;
  
  // Temporarily enable debug for testing
  var oldDebug = global.Ships_CFG.DEBUG;
  global.Ships_CFG.DEBUG = true;
  
  var collectRadius = 25; // 50x50x50 area (25 blocks in each direction)
  
  logTrack('testCreateBarrelShipsAt collecting items in 50x50x50 area around test pos ('+x+','+y+','+z+')');
  
  // Create AABB for item collection around the test position
  var minX = x - collectRadius;
  var minY = Math.max(level.getMinBuildHeight(), y - collectRadius);
  var minZ = z - collectRadius;
  var maxX = x + collectRadius;
  var maxY = Math.min(level.getMaxBuildHeight(), y + collectRadius);
  var maxZ = z + collectRadius;
  
  var AABB = Java.loadClass('net.minecraft.world.phys.AABB');
  var collectionAABB = new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  
  // Find all item entities in the area
  var ItemEntityClass = Java.loadClass('net.minecraft.world.entity.item.ItemEntity');
  var itemEntities = level.getEntitiesOfClass(ItemEntityClass, collectionAABB);
  
  if (!itemEntities || itemEntities.size() === 0) {
    logTrack('testCreateBarrelShipsAt no items found in collection area, creating test items');
    
    // Create some test items if none exist
    var testItems = [];
    var Items = Java.loadClass('net.minecraft.world.item.Items');
    var ItemStack = Java.loadClass('net.minecraft.world.item.ItemStack');
    
    // Create a few test item stacks
    testItems.push(new ItemStack(Items.DIAMOND, 5));
    testItems.push(new ItemStack(Items.GOLD_INGOT, 10));
    testItems.push(new ItemStack(Items.IRON_INGOT, 15));
    testItems.push(new ItemStack(Items.OAK_PLANKS, 32));
    testItems.push(new ItemStack(Items.BREAD, 8));
    
    // Create barrel ships with test items
    var itemsPerBarrel = 27;
    var barrelCount = 0;
    var spreadRadius = 15;
    var startIndex = 0;
    
    while (startIndex < testItems.length) {
      var barrelItems = testItems.slice(startIndex, startIndex + itemsPerBarrel);
      var barrelPos = _findSpreadPosition(level, x, y, z, barrelCount, spreadRadius);
      _createBarrelShip(level, barrelPos.x, barrelPos.y, barrelPos.z, barrelItems, 'test_' + barrelCount);
      
      barrelCount++;
      startIndex += itemsPerBarrel;
    }
    
    logTrack('testCreateBarrelShipsAt created '+barrelCount+' test barrel ships with '+testItems.length+' test items');
    
    // Restore debug setting
    global.Ships_CFG.DEBUG = oldDebug;
    return;
  }
  
  logTrack('testCreateBarrelShipsAt found '+itemEntities.size()+' dropped items');
  
  // Collect all existing items
  var allItems = [];
  var iterator = itemEntities.iterator();
  while (iterator.hasNext()) {
    var itemEntity = iterator.next();
    var itemStack = itemEntity.getItem();
    
    if (itemStack && !itemStack.isEmpty()) {
      allItems.push(itemStack.copy());
      itemEntity.discard(); // Remove from world
    }
  }
  
  if (allItems.length === 0) {
    logTrack('testCreateBarrelShipsAt no valid items collected');
    global.Ships_CFG.DEBUG = oldDebug;
    return;
  }
  
  // Group items into barrel-sized chunks (27 items per barrel)
  var itemsPerBarrel = 27;
  var barrelCount = 0;
  var spreadRadius = 15;
  var startIndex = 0;
  
  while (startIndex < allItems.length) {
    var barrelItems = allItems.slice(startIndex, startIndex + itemsPerBarrel);
    var barrelPos = _findSpreadPosition(level, x, y, z, barrelCount, spreadRadius);
    _createBarrelShip(level, barrelPos.x, barrelPos.y, barrelPos.z, barrelItems, 'test_' + barrelCount);
    
    barrelCount++;
    startIndex += itemsPerBarrel;
  }
  
  logTrack('testCreateBarrelShipsAt created '+barrelCount+' barrel ships with '+allItems.length+' total items');
  
  // Restore debug setting
  global.Ships_CFG.DEBUG = oldDebug;
}

global._shipsTrackerResolveCenter = _resolveCenter;

global._shipsTrackerState = function(){ return SHIPS_TRACK; };

global._createPeriodicBarrelShips = _createPeriodicBarrelShips;

global._testCreateBarrelShipsAt = _testCreateBarrelShipsAt;


var SHIPS_canSpawn = SHIPS_canSpawn || function(){
  var keys = Object.keys(SHIPS_TRACK);
  for (var i=0;i<keys.length;i++){
    var st = SHIPS_TRACK[keys[i]]; 
    if (!st || !st.level) continue;
    
    // Skip ships that are decaying or completed decay
    if (st.decaying || st.decayCompleted) continue;
    
    var center = _resolveCenter(st);
    var loaded = _isShipLoaded(st.level, st.ship, center.x, center.y, center.z);
    if (loaded) return false;
  }
  return true;
};

var SHIPS_removeOldShips = SHIPS_removeOldShips || function(){
  var keys = Object.keys(SHIPS_TRACK);
  var removedCount=0;
  
  for (var i=0;i<keys.length;i++){
    var id = keys[i];
    var st = SHIPS_TRACK[id];
    if (!st || !st.level) continue;
    
    var center = _resolveCenter(st);
    var loaded = _isShipLoaded(st.level, st.ship, center.x, center.y, center.z);
    
    // Handle loaded ships: check for pirate status (decay is handled in separate loop)
    if (loaded) {
      dbg(st.level.server,'removeOldShips checking loaded ship '+id);
      
      // Only check for pirates if ship is not already decaying
      if (!st.decaying && !st.decayCompleted) {
        var pirateCount = _countPiratesOnShip(st.level, st.ship);
        if (pirateCount === 0) {
          dbg(st.level.server,'removeOldShips no pirates found on ship '+id+', starting decay');
          _initDecay(st);
        } else {
          dbg(st.level.server,'removeOldShips ship '+id+' has '+pirateCount+' pirates remaining');
        }
      }
      continue;
    }
    
    // Handle unloaded ships: remove them
    var ok=false; try { ok = !!KubeVS.removeShip(st.level, st.ship); } catch(_){ }
    dbg(st.level.server,'removeOldShips unloaded ship '+id+' removed='+ok);
    if (ok){ stopTracking(st.level.server, id); removedCount++; }
  }
  return removedCount;
};

global.SHIPS_canSpawn = SHIPS_canSpawn;
global.SHIPS_removeOldShips = SHIPS_removeOldShips;

// ---------- public entry: track a ship near xyz after a short settle ----------
var SHIPS_trackAt = SHIPS_trackAt || function(level, x, y, z){
  var server = level.server;

  dbg(server, 'trackAt queued @ '+x+','+y+','+z+' (wait '+TRACK_CFG.settleTicks+'t; AABB half='+TRACK_CFG.aabb.rx+'/'+TRACK_CFG.aabb.ry+'/'+TRACK_CFG.aabb.rz+')');

  schedule(server, TRACK_CFG.settleTicks, function(){
    dbg(server, 'trackAt resolving now…');
    var ship = resolveShipByAabb(level, x, y, z);
    if (!ship) { dbg(server, 'no ship found via AABB at '+x+','+y+','+z); return; }

    var id = 'unknown';
    try { id = String(KubeVS.shipId(ship)); } catch(e){ }

    if (SHIPS_TRACK[id]) { dbg(server, 'already tracking ship '+id); return; }

    var st = { id:id, level:level, ship:ship, dead:false, anchorX:x|0, anchorY:y|0, anchorZ:z|0 };
    try { st.slug = KubeVS.shipSlug(ship); } catch(_){ }
    try {
      var num = KubeVS.shipNumericId ? KubeVS.shipNumericId(ship) : null;
      if (num === null) {
        var objId = KubeVS.shipId(ship);
        if (objId !== null && objId !== undefined) {
          if (typeof objId === 'number' && isFinite(objId)) num = objId;
          else if (typeof objId === 'string'){
            var parsed = parseFloat(objId);
            if (isFinite(parsed)) num = parsed;
          }
        }
      }
      if (num !== null && isFinite(num)) st.numericId = num;
    } catch(_){ }

    st.lastCenterWorld = null;
    st.lastCenterShip = null;
    SHIPS_TRACK[id] = st;

    try {
      var resolved = _resolveCenter(st);
      dbg(server, 'tracking ship '+id+' center='+resolved.x.toFixed(2)+','+resolved.y.toFixed(2)+','+resolved.z.toFixed(2)+' slug='+(st.slug||'(none)'));
      logTrack('trackAt stored world='+resolved.x+','+resolved.y+','+resolved.z+' ship='+st.lastCenterShip.x+','+st.lastCenterShip.y+','+st.lastCenterShip.z);
    } catch (err){
      Ships_broadcast(server, 'failed to resolve center for ship '+id+': '+err);
      logDetail('trackAt resolve error: '+err);
      delete SHIPS_TRACK[id];
    }
  });
};

// expose (Rhino-safe; no globalThis)
global.SHIPS_trackAt  = SHIPS_trackAt;
global.SHIPS_TRACK    = SHIPS_TRACK;
global.BARREL_TRACK   = BARREL_TRACK;
global.TRACK_CFG      = TRACK_CFG;
global.TRACK_DBG      = global.TRACK_DBG || false; // Initialize if not set by commands
global._processBarrelCleanup = _processBarrelCleanup;
global._cleanupAllBarrels = _cleanupAllBarrels;

// Command functionality moved to consolidated /ships command in 50_commands.js

// periodic unloaded-ship pruning every ~1 minute (1200 ticks)
ServerEvents.tick(function(event){
  var server = event.server;
  var t = (global.Ships_tickCounter ? global.Ships_tickCounter() : 0) | 0;
  // Use the shared counter so it stays consistent
  if (t % (60*20) !== 0) return;
  try {
    var n = SHIPS_removeOldShips();
    if (n>0) dbg(server, 'pruned '+n+' unloaded ship(s)');
  } catch(_){ }
  
  // Process barrel cleanup every minute
  try {
    _processBarrelCleanup();
  } catch(barrelErr) {
    dbg(server, 'barrel cleanup error: '+barrelErr);
  }
});

// dedicated decay processing loop - runs every tick for responsive decay
ServerEvents.tick(function(event){
  var server = event.server;
  var t = (global.Ships_tickCounter ? global.Ships_tickCounter() : 0) | 0;
  
  try {
    var keys = Object.keys(SHIPS_TRACK || {});
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var st = SHIPS_TRACK[id];
      if (!st || !st.decaying || !st.ship || !st.level) continue;
      
      // Process both main decay and sail decay
      var shouldRemove = _processDecay(st);
      
      // Debug: Check if sail decay is enabled (with fallback for existing ships)
      if (st.sailDecayActive === undefined) {
        // Initialize sail decay for ships that started decaying before this feature was added
        st.sailDecayActive = true;
        st.sailDecayLastTime = 0;
      }
      
      if (st.sailDecayActive) {
        _processSailDecay(st); // Run continuous sail decay in parallel
      }
      
      if (shouldRemove) {
        dbg(server, 'decay completed for ship '+id+', removing');
        try { 
          var ok = !!KubeVS.removeShip(st.level, st.ship); 
          if (ok) {
            delete SHIPS_TRACK[id];
          }
        } catch(e) { 
          // Decay removal error - continue silently
        }
      }
    }
  } catch(e) {
    // Decay loop error - continue silently
  }
});
