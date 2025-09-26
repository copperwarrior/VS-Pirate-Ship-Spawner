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
var TRACK_DBG   = (typeof TRACK_DBG === 'boolean') ? TRACK_DBG : true; // default: on

function logDetail(msg){
  if (!TRACK_DBG) return;
  try { console.log('[Ships/TrackDBG] ' + msg); } catch(_){ }
}

function logTrack(msg){
  try { console.log('[Ships/TrackDBG] '+msg); } catch(_){ }
}

// --- config used by the tracker ---
var TRACK_CFG = TRACK_CFG || {
  settleTicks: 40,
  aabb: { rx: 5, ry: 3, rz: 5 }
};

// ---------- tiny utils ----------
function tell(server, text) { try { server.tell(text); } catch(e){} }
function dbg(server, msg)   { if (!TRACK_DBG) return; tell(server, Text.gray('[Ships/Track] ' + msg)); }
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

global._shipsTrackerResolveCenter = _resolveCenter;

global._shipsTrackerState = function(){ return SHIPS_TRACK; };

var SHIPS_canSpawn = SHIPS_canSpawn || function(){
  var keys = Object.keys(SHIPS_TRACK);
  for (var i=0;i<keys.length;i++){
    var st = SHIPS_TRACK[keys[i]]; if (!st || !st.level) continue;
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
    if (_isShipLoaded(st.level, st.ship, center.x, center.y, center.z)) {
      dbg(st.level.server,'removeOldShips skip loaded ship '+id+' center='+center.x.toFixed(2)+','+center.y.toFixed(2)+','+center.z.toFixed(2));
      continue;
    }
    var ok=false; try { ok = !!KubeVS.removeShip(st.level, st.ship); } catch(_){ }
    dbg(st.level.server,'removeOldShips id='+id+' removed='+ok);
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
global.TRACK_CFG      = TRACK_CFG;
global.TRACK_DBG      = TRACK_DBG;

// ---------- debug commands ----------
ServerEvents.commandRegistry(function(event){
  var Commands = Java.loadClass('net.minecraft.commands.Commands');

  event.register(
    Commands.literal('shiptrack')
      .requires(function(cs){ return cs.hasPermission(2); })

      .then(
        Commands.literal('here')
          .executes(function(ctx){
            var p = ctx.source.player;
            var lvl = p.level;
            var px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
            dbg(ctx.source.server, '/shiptrack here → '+px+','+py+','+pz);
            SHIPS_trackAt(lvl, px, py, pz);
            return 1;
          })
      )

      .then(
        Commands.literal('list')
          .executes(function(ctx){
            var server = ctx.source.server;
            var keys = Object.keys(SHIPS_TRACK);
            dbg(server, '/shiptrack list');
            var out = [];
            for (var i=0;i<keys.length;i++){
              var id = keys[i];
              var st = SHIPS_TRACK[id];
              if (!st) continue;
              var center = st.lastCenterWorld || _resolveCenter(st);
              out.push(id+'@'+center.x.toFixed(1)+','+center.y.toFixed(1)+','+center.z.toFixed(1));
            }
            tell(server, Text.gray('[Ships/Track] active: '+(out.length?out.join(', '):'(none)')));
            return 1;
          })
      )

      .then(
        Commands.literal('debug')
          .then(
            Commands.literal('on').executes(function(ctx){
              TRACK_DBG = true; global.TRACK_DBG = true;
              tell(ctx.source.server, Text.yellow('[Ships/Track] debug = ON'));
              return 1;
            })
          )
          .then(
            Commands.literal('off').executes(function(ctx){
              TRACK_DBG = false; global.TRACK_DBG = false;
              tell(ctx.source.server, Text.yellow('[Ships/Track] debug = OFF'));
              return 1;
            })
          )
          .then(
            Commands.literal('status').executes(function(ctx){
              tell(ctx.source.server, Text.gray('[Ships/Track] debug is '+(TRACK_DBG?'ON':'OFF')));
              return 1;
            })
          )
      )
  );
});

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
});
