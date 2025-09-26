// KubeVS bridge (no-reflection, KubeJS 2001 / Forge 1.20.1)
// Exposes minimal API used by tracker:
//   - shipsInAABB(level, mcAABB)
//   - shipId(ship)
//   - shipSlug(ship)
//   - shipCenterWorld(ship) -> { x, y, z }
//   - entitiesInShip(level, ship, entityId)
//   - isShipLoaded(ship)
//   - removeShip(level, ship)
//   - _reinit(), _forceWire(className, methodName) for debugging
//
// Depends on KubeVS plugin providing bindings for:
//   org.valkyrienskies.mod.common.VSGameUtilsKt
//   org.joml.primitives.AABBd
//   org.joml.Vector3d
//
// NOTE: No use of java.lang.reflect.* or globalThis.

global = global || this; // Rhino: ensure we have a global object

(function initKubeVSBridge () {
  var TAG = '[KubeVS Bridge]';
  try {
    var VSGameUtilsKt = Java.loadClass('org.valkyrienskies.mod.common.VSGameUtilsKt');
    var AABBd          = Java.loadClass('org.joml.primitives.AABBd');
    var AABBdc         = Java.loadClass('org.joml.primitives.AABBdc');
    var Vector3d       = Java.loadClass('org.joml.Vector3d');

    var logFn = (function(){
      try {
        var logger = console.log;
        if (typeof logger === 'function') {
          return function(msg){ try { logger.call(console, '[KubeVS Bridge] '+msg); } catch(_){ } };
        }
      } catch(_){ }
      return function(){};
    })();

    if (!VSGameUtilsKt || !AABBd || !Vector3d) {
      logFn('Required bindings missing (VSGameUtilsKt/AABBd/Vector3d).');
      global.KubeVS = {
        shipsInAABB: function () {
          throw new Error('shipsInAABB unavailable: bindings missing (VSGameUtilsKt/AABBd/Vector3d).');
        }
      };
      return;
    }

    function toAABBd(mcAABB) {
      return new AABBd(mcAABB.minX, mcAABB.minY, mcAABB.minZ,
                       mcAABB.maxX, mcAABB.maxY, mcAABB.maxZ);
    }

    function makeVector3d(x, y, z){
      return new Vector3d(+x, +y, +z);
    }

    function vectorToPlain(vec){
      if (!vec) throw new Error('vector result was null');
      return { x:+vec.x, y:+vec.y, z:+vec.z };
    }

    function worldToPlainVectorSafe(primaryFn, fallbackFn){
      try {
        var primary = primaryFn();
        if (primary) return primary;
      } catch(errPrimary){ logFn('vector primary failed: '+errPrimary); }
      if (fallbackFn) {
        try {
          var fallback = fallbackFn();
          if (fallback) return fallback;
        } catch(errFallback){ logFn('vector fallback failed: '+errFallback); }
      }
      throw new Error('vector conversion failed');
    }

    function toLong(id){
      if (id === null || id === undefined) throw new Error('numeric id is required');
      if (typeof id === 'number' && isFinite(id)) return java.lang.Long.valueOf(Math.floor(id));
      var JLong = Java.loadClass('java.lang.Long');
      return JLong.parseLong(String(id));
    }

    function iterableToArray(list){
      if (!list) return [];
      if (Array.isArray(list)) return list;
      if (typeof list.toArray === 'function') try { return list.toArray(); } catch(_){ }
      if (typeof list.iterator === 'function') {
        var arr = [];
        try {
          var it = list.iterator();
          while (it.hasNext()) arr.push(it.next());
          return arr;
        } catch(err){ logFn('iterableToArray iterator failed: '+err); }
      }
      logFn('iterableToArray returning raw list');
      return list;
    }

    function getShipWorld(level){
      if (!level) throw new Error('getShipWorld missing level');
      if (level.serverShipObjectWorld) return level.serverShipObjectWorld;
      if (level.shipObjectWorld) return level.shipObjectWorld;
      if (level.server && level.server.serverShipObjectWorld) return level.server.serverShipObjectWorld;
      throw new Error('Ship world attachment unavailable on level');
    }

    var api = {
      getShipWorld: getShipWorld,
      resolveShipById: function(level, id){
        logFn('resolveShipById id='+id);
        if (id === undefined || id === null) throw new Error('resolveShipById requires id');
        
        // Inline getShipWorld to avoid closure issues
        var world = null;
        if (level.serverShipObjectWorld) world = level.serverShipObjectWorld;
        else if (level.shipObjectWorld) world = level.shipObjectWorld;
        else if (level.server && level.server.serverShipObjectWorld) world = level.server.serverShipObjectWorld;
        if (!world) throw new Error('Ship world attachment unavailable on level');
        
        try {
          var shipById = world.getShipById(toLong(id));
          if (shipById) { logFn('resolveShipById via numeric'); return shipById; }
        } catch(errId){ logFn('resolveShipById numeric failed: '+errId); }
        try {
          var shipBySlug = world.getShipBySlug(String(id));
          if (shipBySlug) { logFn('resolveShipById via slug'); return shipBySlug; }
        } catch(errSlug){ logFn('resolveShipById slug failed: '+errSlug); }
        throw new Error('resolveShipById failed for '+id);
      },

      shipsInAABB: function (level, mcAABB) {
        if (!level || !mcAABB) throw new Error('shipsInAABB: bad args');
        logFn('shipsInAABB request box='+mcAABB);
        
        // Inline helper functions to avoid closure issues
        function inlineIterableToArray(list){
          if (!list) return [];
          if (Array.isArray(list)) return list;
          if (typeof list.toArray === 'function') try { return list.toArray(); } catch(_){ }
          if (typeof list.iterator === 'function') {
            var arr = [];
            try {
              var it = list.iterator();
              while (it.hasNext()) arr.push(it.next());
              return arr;
            } catch(err){ logFn('inlineIterableToArray iterator failed: '+err); }
          }
          logFn('inlineIterableToArray returning raw list');
          return list;
        }
        
        function inlineToAABBd(mcAABB) {
          return new AABBd(mcAABB.minX, mcAABB.minY, mcAABB.minZ,
                           mcAABB.maxX, mcAABB.maxY, mcAABB.maxZ);
        }
        
        // Use VSGameUtilsKt.getShipsIntersecting directly
        try {
          logFn('shipsInAABB trying VSGameUtilsKt.getShipsIntersecting with mcAABB');
          var res = VSGameUtilsKt.getShipsIntersecting(level, mcAABB);
          var arr = inlineIterableToArray(res);
          logFn('shipsInAABB direct VSGameUtilsKt found '+(arr?arr.length:0));
          return arr || [];
        } catch(err1){ 
          logFn('shipsInAABB direct failed: '+err1);
          
          // Try with AABBd conversion
          try {
            logFn('shipsInAABB trying VSGameUtilsKt.getShipsIntersecting with AABBd');
            var aabbD = inlineToAABBd(mcAABB);
            var res2 = VSGameUtilsKt.getShipsIntersecting(level, aabbD);
            var arr2 = inlineIterableToArray(res2);
            logFn('shipsInAABB AABBd VSGameUtilsKt found '+(arr2?arr2.length:0));
            return arr2 || [];
          } catch(err2){
            logFn('shipsInAABB AABBd failed: '+err2);
            throw new Error('shipsInAABB all methods failed: '+err1+' / '+err2);
          }
        }
      },

      shipId: function(ship){
        var id = 'unknown';
        try { if (ship && typeof ship.getId === 'function') id = String(ship.getId()); }
        catch(_){ }
        if (id === 'unknown') {
          try { if (ship && typeof ship.getIdAsString === 'function') id = String(ship.getIdAsString()); } catch(_2){ }
        }
        if (id === 'unknown') {
          try { if (ship) id = String(ship); } catch(_3){ }
        }
        logFn('shipId -> '+id);
        return id;
      },

      shipSlug: function(ship){
        var slug = null;
        try { if (ship && typeof ship.getSlug === 'function') slug = String(ship.getSlug()); } catch(_){ }
        if (!slug) {
          try { if (ship && typeof ship.getName === 'function') slug = String(ship.getName()); } catch(_2){ }
        }
        logFn('shipSlug -> '+slug);
        return slug;
      },

      shipCenterWorld: function(ship){
        var result = { x:0, y:0, z:0 };
        
        // Try direct ship properties and methods
        logFn('shipCenterWorld trying ship methods directly');
        
        // Try ship.getTransform().positionInWorld first (this looks most promising!)
        try {
          if (ship && typeof ship.getTransform === 'function') {
            var tf = ship.getTransform();
            logFn('shipCenterWorld got transform: '+tf);
            
            // Try direct access to positionInWorld property
            if (tf && tf.positionInWorld) {
              var pos = tf.positionInWorld;
              if (pos && pos.x !== undefined && pos.y !== undefined && pos.z !== undefined) {
                result = { x:+pos.x, y:+pos.y, z:+pos.z };
                logFn('shipCenterWorld positionInWorld success: '+result.x+','+result.y+','+result.z);
              }
            }
            
            // Fallback: try matrix access
            if ((result.x===0 && result.y===0 && result.z===0) && tf && typeof tf.getShipToWorldMatrix === 'function') {
              var matrix = tf.getShipToWorldMatrix();
              logFn('shipCenterWorld got matrix: '+matrix);
              if (matrix && matrix.m30 !== undefined) {
                // Direct matrix access to translation components
                result = { x:+matrix.m30, y:+matrix.m31, z:+matrix.m32 };
                logFn('shipCenterWorld matrix direct success: '+result.x+','+result.y+','+result.z);
              }
            }
          }
        } catch(err){ logFn('shipCenterWorld transform methods failed: '+err); }
        
        // Try ship.getShipToWorld() directly
        if (result.x===0 && result.y===0 && result.z===0) {
          try { 
            if (ship && typeof ship.getShipToWorld === 'function') {
              var tf = ship.getShipToWorld();
              if (tf && typeof tf.getPosition === 'function') { 
                var p = tf.getPosition(); 
                result = { x:+p.x, y:+p.y, z:+p.z };
                logFn('shipCenterWorld direct shipToWorld success: '+result.x+','+result.y+','+result.z);
              }
            }
          } catch(err){ logFn('shipCenterWorld direct shipToWorld failed: '+err); }
        }
        
        logFn('shipCenterWorld -> '+result.x+','+result.y+','+result.z);
        return result;
      },

      shipToWorldVec: function(level, ship, x, y, z){
        logFn('shipToWorldVec input '+x+','+y+','+z);
        
        // Inline getShipWorld to avoid closure issues
        var world = null;
        if (level.serverShipObjectWorld) world = level.serverShipObjectWorld;
        else if (level.shipObjectWorld) world = level.shipObjectWorld;
        else if (level.server && level.server.serverShipObjectWorld) world = level.server.serverShipObjectWorld;
        
        var vec = vectorToPlain(worldToPlainVectorSafe(function(){ return world ? world.shipToWorld(ship, makeVector3d(x, y, z)) : null; }, function(){ return VSGameUtilsKt.shipToWorld(ship, makeVector3d(x, y, z)); }));
        logFn('shipToWorldVec output '+vec.x+','+vec.y+','+vec.z);
        return vec;
      },

      worldToShipVec: function(level, ship, x, y, z){
        logFn('worldToShipVec input '+x+','+y+','+z);
        
        // Inline all helper functions to avoid closure issues
        function inlineVectorToPlain(vec){
          if (!vec) throw new Error('vector result was null');
          return { x:+vec.x, y:+vec.y, z:+vec.z };
        }
        
        function inlineMakeVector3d(x, y, z){
          return new Vector3d(+x, +y, +z);
        }
        
        // Since we don't have working VSGameUtilsKt methods, skip trying them
        // and just return the input coordinates as ship coordinates for now
        logFn('worldToShipVec returning input coordinates as placeholder');
        return { x:+x, y:+y, z:+z };
      },

      shipNumericId: function(ship){
        var num = null;
        try {
          var raw = ship && ship.getId ? ship.getId() : null;
          if (raw !== null && raw !== undefined) {
            if (typeof raw === 'number' && isFinite(raw)) num = raw;
            else {
              var parsed = parseFloat(String(raw));
              if (isFinite(parsed)) num = parsed;
            }
          }
        } catch(err){ logFn('shipNumericId from getId failed: '+err); }
        if (num === null) {
          try {
            var asString = ship && ship.toString ? String(ship.toString()) : null;
            if (asString) {
              var parsed2 = parseFloat(asString);
              if (isFinite(parsed2)) num = parsed2;
            }
          } catch(err2){ logFn('shipNumericId from toString failed: '+err2); }
        }
        logFn('shipNumericId -> '+num);
        return num;
      },

      shipByNumericId: function(level, id){
        logFn('shipByNumericId '+id);
        
        // Inline getShipWorld to avoid closure issues
        var world = null;
        if (level.serverShipObjectWorld) world = level.serverShipObjectWorld;
        else if (level.shipObjectWorld) world = level.shipObjectWorld;
        else if (level.server && level.server.serverShipObjectWorld) world = level.server.serverShipObjectWorld;
        if (!world) throw new Error('Ship world attachment unavailable on level');
        
        // Try different method names for getting ship by ID
        var ship = null;
        try {
          logFn('shipByNumericId trying getShipObjectById');
          ship = world.getShipObjectById(toLong(id));
        } catch(err1){
          logFn('shipByNumericId getShipObjectById failed: '+err1);
          try {
            logFn('shipByNumericId trying getShipById');  
            ship = world.getShipById(toLong(id));
          } catch(err2){
            logFn('shipByNumericId getShipById failed: '+err2);
            try {
              logFn('shipByNumericId trying getById');
              ship = world.getById(toLong(id));
            } catch(err3){
              logFn('shipByNumericId getById failed: '+err3);
              throw new Error('shipByNumericId all methods failed for id '+id);
            }
          }
        }
        
        if (!ship) throw new Error('shipByNumericId no ship for id '+id);
        logFn('shipByNumericId found ship for id '+id);
        return ship;
      },

      shipBySlug: function(level, slug){
        logFn('shipBySlug '+slug);
        if (!slug) throw new Error('shipBySlug requires slug');
        
        // Inline getShipWorld to avoid closure issues
        var world = null;
        if (level.serverShipObjectWorld) world = level.serverShipObjectWorld;
        else if (level.shipObjectWorld) world = level.shipObjectWorld;
        else if (level.server && level.server.serverShipObjectWorld) world = level.server.serverShipObjectWorld;
        if (!world) throw new Error('Ship world attachment unavailable on level');
        
        // Try different method names for getting ship by slug
        var ship = null;
        try {
          logFn('shipBySlug trying getShipObjectBySlug');
          ship = world.getShipObjectBySlug(String(slug));
        } catch(err1){
          logFn('shipBySlug getShipObjectBySlug failed: '+err1);
          try {
            logFn('shipBySlug trying getShipBySlug');
            ship = world.getShipBySlug(String(slug));
          } catch(err2){
            logFn('shipBySlug getShipBySlug failed: '+err2);
            try {
              logFn('shipBySlug trying getBySlug');
              ship = world.getBySlug(String(slug));
            } catch(err3){
              logFn('shipBySlug getBySlug failed: '+err3);
              throw new Error('shipBySlug all methods failed for slug '+slug);
            }
          }
        }
        
        if (!ship) throw new Error('shipBySlug no ship for slug '+slug);
        logFn('shipBySlug found ship for slug '+slug);
        return ship;
      },

      allShips: function(level){
        logFn('allShips request');
        
        // Inline getShipWorld to avoid closure issues
        var world = null;
        if (level.serverShipObjectWorld) world = level.serverShipObjectWorld;
        else if (level.shipObjectWorld) world = level.shipObjectWorld;
        else if (level.server && level.server.serverShipObjectWorld) world = level.server.serverShipObjectWorld;
        if (!world) throw new Error('Ship world attachment unavailable on level');
        
        if (typeof world.getAllShips !== 'function') throw new Error('ship world missing getAllShips');
        var list = world.getAllShips();
        var arr = iterableToArray(list);
        logFn('allShips count '+(arr?arr.length:0));
        return arr || [];
      },

      entitiesInShip: function(level, ship, entityId){
        logFn('entitiesInShip '+entityId);
        
        // Inline getShipWorld to avoid closure issues
        var world = null;
        if (level.serverShipObjectWorld) world = level.serverShipObjectWorld;
        else if (level.shipObjectWorld) world = level.shipObjectWorld;
        else if (level.server && level.server.serverShipObjectWorld) world = level.server.serverShipObjectWorld;
        if (!world) throw new Error('Ship world attachment unavailable on level');
        
        if (typeof world.getEntitiesInShip !== 'function') throw new Error('ship world missing getEntitiesInShip');
        var res = world.getEntitiesInShip(ship, String(entityId||'')) || [];
        var arr = iterableToArray(res);
        logFn('entitiesInShip count '+(arr?arr.length:0));
        return arr || [];
      },

      isShipValid: function(ship){
        try { if (ship && typeof ship.isRemoved === 'function') return !ship.isRemoved(); } catch(_){}
        return true;
      },
      isShipLoaded: function(ship){
        try { if (ship && typeof ship.isLoaded === 'function') return !!ship.isLoaded(); } catch(_){}
        return true;
      },

      removeShip: function(level, ship){
        if (!level || typeof level.runCommandSilent !== 'function') return false;
        var any = false;
        try {
          var slug = api.shipSlug(ship);
          if (slug){
            try { level.runCommandSilent('vs delete '+slug); any = true; } catch(_1){}
          }
        } catch(_s){}
        try {
          var id = String(api.shipId(ship));
          try { level.runCommandSilent('vs delete '+id); any = true; } catch(_2){}
        } catch(_i){}
        return any;
      },

      _reinit: function(){ try { initKubeVSBridge(); return true; } catch(e){ console.log(TAG + ' reinit error: ' + e); return false; } },
      _forceWire: function(className, methodName){
        console.log(TAG + ' forceWire stub → ' + className + '.' + methodName);
        return true;
      }
    };

    global.KubeVS = api;
    console.log(TAG + ' ready (no-reflection).');

  } catch (err) {
    console.log(TAG + ' init failed: ' + err);
    var apiFail = {
      shipsInAABB: function () {
        throw new Error('shipsInAABB unavailable: ' + err);
      },
      shipId: function(){ return 'unknown'; },
      shipSlug: function(){ return null; },
      shipCenterWorld: function(){ return { x:0, y:0, z:0 }; },
      entitiesInShip: function(){ return []; },
      isShipValid: function(){ return true; },
      isShipLoaded: function(){ return true; },
      removeShip: function(){ return false; },
      _reinit: function(){ return false; },
      _forceWire: function(){ return false; }
    };
    global.KubeVS = apiFail;
  }
})();
