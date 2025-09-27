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
    var ShipAssemblyKt = Java.loadClass('org.valkyrienskies.mod.common.assembly.ShipAssemblyKt');
    var AABBd          = Java.loadClass('org.joml.primitives.AABBd');
    var AABBdc         = Java.loadClass('org.joml.primitives.AABBdc');
    var Vector3d       = Java.loadClass('org.joml.Vector3d');

    var logFn = (function(){
      try {
        var logger = console.log;
        if (typeof logger === 'function') {
          return function(msg){ 
            if (global.DEBUG || global.TRACK_DBG || (global.Ships_CFG && global.Ships_CFG.DEBUG)) {
              try { logger.call(console, '[KubeVS Bridge] '+msg); } catch(_){ } 
            }
          };
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
    
    // Expose ShipAssemblyKt globally for ship creation
    if (ShipAssemblyKt) {
      global.ShipAssemblyKt = ShipAssemblyKt;
      logFn('ShipAssemblyKt exposed globally');
    } else {
      logFn('ShipAssemblyKt not available');
    }

    function toAABBd(mcAABB) {
      return new AABBd(mcAABB.minX, mcAABB.minY, mcAABB.minZ,
                       mcAABB.maxX, mcAABB.maxY, mcAABB.maxZ);
    }

    function makeVector3d(x, y, z){
      return new Vector3d(+x, +y, +z);
    }

    // Removed unused helper functions: vectorToPlain, worldToPlainVectorSafe

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
        
        // Since we don't have working VSGameUtilsKt methods, return input coordinates as placeholder
        logFn('shipToWorldVec returning input coordinates as placeholder');
        return { x:+x, y:+y, z:+z };
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
        
        try {
          // Get ship's world AABB and search for entities within it
          var center = api.shipCenterWorld(ship);
          var bounds = { minX: -50, minY: -10, minZ: -50, maxX: 50, maxY: 30, maxZ: 50 }; // Reasonable ship bounds
          
          // Create search box around ship center
          var searchBox = new AABB(
            center.x + bounds.minX, center.y + bounds.minY, center.z + bounds.minZ,
            center.x + bounds.maxX, center.y + bounds.maxY, center.z + bounds.maxZ
          );
          
          // Get all entities in the area
          var entities = level.getEntitiesOfClass(Java.loadClass('net.minecraft.world.entity.Entity'), searchBox);
          var filtered = [];
          
          if (entities && entities.size && entities.size() > 0) {
            var it = entities.iterator();
            while (it.hasNext()) {
              var entity = it.next();
              if (entity && entity.getType && entity.getType().toString().includes(entityId)) {
                filtered.push(entity);
              }
            }
          }
          
          logFn('entitiesInShip found '+filtered.length+' '+entityId+' entities in ship area');
          return filtered;
        } catch(e) {
          logFn('entitiesInShip error: '+e);
          return [];
        }
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

      createShip: function (level, blockPos) {
        if (!level || !blockPos) return null;
        
        try {
          // Use the correct method signature from VS2 source code
          if (typeof ShipAssemblyKt !== 'undefined') {
            var DenseBlockPosSet = Java.loadClass('org.valkyrienskies.core.util.datastructures.DenseBlockPosSet');
            var blockPosSet = new DenseBlockPosSet();
            blockPosSet.add(blockPos.getX(), blockPos.getY(), blockPos.getZ());
            
            // CORRECT ORDER: centerBlock, blocks, level
            var ship = ShipAssemblyKt.createNewShipWithBlocks(blockPos, blockPosSet, level);
            if (ship) {
              logFn('createShip: SUCCESS - Created VS ship: ' + ship);
              return ship;
            } else {
              logFn('createShip: Method call succeeded but returned null ship');
              return null;
            }
          } else {
            logFn('createShip: ShipAssemblyKt not available');
            return null;
          }
        } catch (createErr) {
          logFn('createShip: Error: ' + createErr);
          return null;
        },

      _reinit: function(){ try { initKubeVSBridge(); return true; } catch(e){ console.log(TAG + ' reinit error: ' + e); return false; } },
      _forceWire: function(className, methodName){
        console.log(TAG + ' forceWire stub → ' + className + '.' + methodName);
        return true;
      }
    };

    // Expose ShipAssemblyKt globally for ship creation
    if (ShipAssemblyKt) {
      global.ShipAssemblyKt = ShipAssemblyKt;
      logFn('ShipAssemblyKt exposed globally');
    } else {
      logFn('ShipAssemblyKt not available');
    }

    global.KubeVS = kubeVS;
    logFn('ready (no-reflection).');

  } catch (e) {
    logFn('init error: ' + e);
    global.KubeVS = {
      shipsInAABB: function () {
        throw new Error('shipsInAABB unavailable: init error.');
      },
      shipId: function(){ return 'unknown'; },
      shipSlug: function(){ return null; },
      shipCenterWorld: function(){ return { x:0, y:0, z:0 }; },
      entitiesInShip: function(){ return []; },
      isShipValid: function(){ return true; },
      isShipLoaded: function(){ return true; },
      removeShip: function(){ return false; },
      createShip: function(){ return null; },
      _reinit: function(){ return false; },
      _forceWire: function(){ return false; }
    };
  }
})();
                  }
                } catch (reflectionErr) {
                  logFn('createShip: Java reflection failed: ' + reflectionErr);
                }
                
                // Method 2: Try to enumerate what's actually available on the global object
                try {
                  logFn('createShip: Checking available methods on global ShipAssemblyKt');
                  
                  // Test specific method names we expect
                  var expectedMethods = [
                    'createNewShipWithBlocks',
                    'assembleToShip', 
                    'createShip',
                    'assemble',
                    'INSTANCE'
                  ];
                  
                  for (var em = 0; em < expectedMethods.length; em++) {
                    var methodName = expectedMethods[em];
                    try {
                      var methodExists = (methodName in ShipAssemblyKt);
                      var methodType = typeof ShipAssemblyKt[methodName];
                      logFn('createShip: ' + methodName + ' exists: ' + methodExists + ' type: ' + methodType);
                      
                      if (methodExists && methodType === 'function') {
                        logFn('createShip: *** FOUND CALLABLE METHOD: ' + methodName + ' ***');
                      }
                    } catch (methodCheckErr) {
                      logFn('createShip: Error checking ' + methodName + ': ' + methodCheckErr);
                    }
                  }
                } catch (enumErr) {
                  logFn('createShip: Method enumeration failed: ' + enumErr);
                }
                
                // Method 3: Try Kotlin companion object pattern
                try {
                  logFn('createShip: Checking for Kotlin companion object patterns');
                  
                  if (ShipAssemblyKt.Companion) {
                    logFn('createShip: Found Companion object: ' + ShipAssemblyKt.Companion);
                    var companionMethods = ['createNewShipWithBlocks', 'assembleToShip'];
                    for (var cm = 0; cm < companionMethods.length; cm++) {
                      var compMethod = companionMethods[cm];
                      if (ShipAssemblyKt.Companion[compMethod]) {
                        logFn('createShip: *** FOUND COMPANION METHOD: ' + compMethod + ' ***');
                      }
                    }
                  }
                  
                  if (ShipAssemblyKt.INSTANCE) {
                    logFn('createShip: Found INSTANCE object: ' + ShipAssemblyKt.INSTANCE);
                    var instanceMethods = ['createNewShipWithBlocks', 'assembleToShip'];
                    for (var im = 0; im < instanceMethods.length; im++) {
                      var instMethod = instanceMethods[im];
                      if (ShipAssemblyKt.INSTANCE[instMethod]) {
                        logFn('createShip: *** FOUND INSTANCE METHOD: ' + instMethod + ' ***');
                      }
                    }
                  }
                } catch (companionErr) {
                  logFn('createShip: Companion object check failed: ' + companionErr);
                }
                
                logFn('createShip: === End Method Discovery ===');
              } catch (discoveryErr) {
                logFn('createShip: Method discovery failed: ' + discoveryErr);
              }
              
              // Now we know the correct signature from VS2 source: centerBlock, blocks, level
              logFn('createShip: === Testing createNewShipWithBlocks with CORRECT signature from VS2 source ===');
              logFn('createShip: Signature: createNewShipWithBlocks(centerBlock: BlockPos, blocks: DenseBlockPosSet, level: ServerLevel)');
              
              // Test 1: CORRECT SIGNATURE - centerBlock, blocks, level
              try {
                var DenseBlockPosSet = Java.loadClass('org.valkyrienskies.core.util.datastructures.DenseBlockPosSet');
                var blockPosSet = new DenseBlockPosSet();
                blockPosSet.add(blockPos.getX(), blockPos.getY(), blockPos.getZ());
                logFn('createShip: Test 1 - CORRECT SIGNATURE: centerBlock=' + blockPos + ', blocks=DenseBlockPosSet, level=' + level);
                
                // CORRECT ORDER: centerBlock, blocks, level
                var ship = ShipAssemblyKt.createNewShipWithBlocks(blockPos, blockPosSet, level);
                if (ship) {
                  logFn('createShip: *** SUCCESS *** CORRECT SIGNATURE: ' + ship);
                  return ship;
                }
              } catch (test1Err) {
                logFn('createShip: Test 1 CORRECT SIGNATURE failed: ' + test1Err);
              }
              
              // Test 2: DenseBlockPosSet + Vector3d (center position)
              try {
                var DenseBlockPosSet = Java.loadClass('org.valkyrienskies.core.util.datastructures.DenseBlockPosSet');
                var Vector3d = Java.loadClass('org.joml.Vector3d');
                var blockPosSet = new DenseBlockPosSet();
                blockPosSet.add(blockPos.getX(), blockPos.getY(), blockPos.getZ());
                var centerVec = new Vector3d(blockPos.getX(), blockPos.getY(), blockPos.getZ());
                logFn('createShip: Test 2 - DenseBlockPosSet + Vector3d center');
                
                var ship = ShipAssemblyKt.createNewShipWithBlocks(level, blockPosSet, centerVec);
                if (ship) {
                  logFn('createShip: SUCCESS Test 2 - DenseBlockPosSet + Vector3d: ' + ship);
                  return ship;
                }
              } catch (test2Err) {
                logFn('createShip: Test 2 failed: ' + test2Err);
              }
              
              // Test 3: HashSet<BlockPos>
              try {
                var HashSet = Java.loadClass('java.util.HashSet');
                var blockPosSet = new HashSet();
                blockPosSet.add(blockPos);
                logFn('createShip: Test 3 - HashSet<BlockPos>');
                
                var ship = ShipAssemblyKt.createNewShipWithBlocks(level, blockPosSet);
                if (ship) {
                  logFn('createShip: SUCCESS Test 3 - HashSet<BlockPos>: ' + ship);
                  return ship;
                }
              } catch (test3Err) {
                logFn('createShip: Test 3 failed: ' + test3Err);
              }
              
              // Test 4: HashSet<BlockPos> + Vector3d
              try {
                var HashSet = Java.loadClass('java.util.HashSet');
                var Vector3d = Java.loadClass('org.joml.Vector3d');
                var blockPosSet = new HashSet();
                blockPosSet.add(blockPos);
                var centerVec = new Vector3d(blockPos.getX(), blockPos.getY(), blockPos.getZ());
                logFn('createShip: Test 4 - HashSet<BlockPos> + Vector3d');
                
                var ship = ShipAssemblyKt.createNewShipWithBlocks(level, blockPosSet, centerVec);
                if (ship) {
                  logFn('createShip: SUCCESS Test 4 - HashSet<BlockPos> + Vector3d: ' + ship);
                  return ship;
                }
              } catch (test4Err) {
                logFn('createShip: Test 4 failed: ' + test4Err);
              }
              
              // Test 5: Single BlockPos only
              try {
                logFn('createShip: Test 5 - Single BlockPos only');
                var ship = ShipAssemblyKt.createNewShipWithBlocks(level, blockPos);
                if (ship) {
                  logFn('createShip: SUCCESS Test 5 - Single BlockPos: ' + ship);
                  return ship;
                }
              } catch (test5Err) {
                logFn('createShip: Test 5 failed: ' + test5Err);
              }
              
              // Test 6: Try with different Level types
              try {
                logFn('createShip: Test 6 - Different level types');
                
                // Try casting level to different types
                var ServerLevel = Java.loadClass('net.minecraft.server.level.ServerLevel');
                var Level = Java.loadClass('net.minecraft.world.level.Level');
                
                var blockPosSet = new (Java.loadClass('java.util.HashSet'))();
                blockPosSet.add(blockPos);
                
                // Try with explicit ServerLevel cast
                var serverLevel = ServerLevel.cast ? ServerLevel.cast(level) : level;
                var ship = ShipAssemblyKt.createNewShipWithBlocks(serverLevel, blockPosSet);
                if (ship) {
                  logFn('createShip: SUCCESS Test 6 - ServerLevel cast: ' + ship);
                  return ship;
                }
              } catch (test6Err) {
                logFn('createShip: Test 6 failed: ' + test6Err);
              }
              
              // Test 7: Try with null as third parameter
              try {
                var blockPosSet = new (Java.loadClass('java.util.HashSet'))();
                blockPosSet.add(blockPos);
                logFn('createShip: Test 7 - HashSet + null third parameter');
                
                var ship = ShipAssemblyKt.createNewShipWithBlocks(level, blockPosSet, null);
                if (ship) {
                  logFn('createShip: SUCCESS Test 7 - HashSet + null: ' + ship);
                  return ship;
                }
              } catch (test7Err) {
                logFn('createShip: Test 7 failed: ' + test7Err);
              }
              
              // Test 8: Try without Level parameter (maybe it's not needed)
              try {
                var blockPosSet = new (Java.loadClass('java.util.HashSet'))();
                blockPosSet.add(blockPos);
                logFn('createShip: Test 8 - No Level parameter, just HashSet');
                
                var ship = ShipAssemblyKt.createNewShipWithBlocks(blockPosSet);
                if (ship) {
                  logFn('createShip: SUCCESS Test 8 - No Level: ' + ship);
                  return ship;
                }
              } catch (test8Err) {
                logFn('createShip: Test 8 failed: ' + test8Err);
              }
              
              // Test 9: Try with World instead of Level
              try {
                var World = Java.loadClass('net.minecraft.world.level.Level');
                var blockPosSet = new (Java.loadClass('java.util.HashSet'))();
                blockPosSet.add(blockPos);
                logFn('createShip: Test 9 - World/Level cast');
                
                var world = World.cast ? World.cast(level) : level;
                var ship = ShipAssemblyKt.createNewShipWithBlocks(world, blockPosSet);
                if (ship) {
                  logFn('createShip: SUCCESS Test 9 - World cast: ' + ship);
                  return ship;
                }
              } catch (test9Err) {
                logFn('createShip: Test 9 failed: ' + test9Err);
              }
              
              // Test 10: Try with different collection interfaces
              try {
                var Set = Java.loadClass('java.util.Set');
                var Collection = Java.loadClass('java.util.Collection');
                var blockPosSet = new (Java.loadClass('java.util.HashSet'))();
                blockPosSet.add(blockPos);
                logFn('createShip: Test 10 - Collection interface casting');
                
                var setInterface = Set.cast ? Set.cast(blockPosSet) : blockPosSet;
                var ship = ShipAssemblyKt.createNewShipWithBlocks(level, setInterface);
                if (ship) {
                  logFn('createShip: SUCCESS Test 10 - Set interface: ' + ship);
                  return ship;
                }
              } catch (test10Err) {
                logFn('createShip: Test 10 failed: ' + test10Err);
              }
              
              // Test 11: Try calling with no parameters to see what it expects
              try {
                logFn('createShip: Test 11 - No parameters (to see error signature)');
                var ship = ShipAssemblyKt.createNewShipWithBlocks();
                if (ship) {
                  logFn('createShip: SUCCESS Test 11 - No params: ' + ship);
                  return ship;
                }
              } catch (test11Err) {
                logFn('createShip: Test 11 failed (expected): ' + test11Err);
              }
              
              // Test 12: Try with string parameters (maybe it expects different types)
              try {
                logFn('createShip: Test 12 - String parameters');
                var ship = ShipAssemblyKt.createNewShipWithBlocks('level', 'blocks');
                if (ship) {
                  logFn('createShip: SUCCESS Test 12 - Strings: ' + ship);
                  return ship;
                }
              } catch (test12Err) {
                logFn('createShip: Test 12 failed: ' + test12Err);
              }
              
              // Test 13: Try to call it as a static method with different syntax
              try {
                logFn('createShip: Test 13 - Alternative static call syntax');
                var blockPosSet = new (Java.loadClass('java.util.HashSet'))();
                blockPosSet.add(blockPos);
                
                // Try accessing it through the class differently
                var ShipAssemblyClass = Java.loadClass('org.valkyrienskies.mod.common.assembly.ShipAssemblyKt');
                var ship = ShipAssemblyClass['createNewShipWithBlocks'](level, blockPosSet);
                if (ship) {
                  logFn('createShip: SUCCESS Test 13 - Alternative syntax: ' + ship);
                  return ship;
                }
              } catch (test13Err) {
                logFn('createShip: Test 13 failed: ' + test13Err);
              }
              
              logFn('createShip: === All parameter tests completed ===');
              
              // Try with regular HashSet as fallback
              try {
                var blockPositions = Java.loadClass('java.util.HashSet')();
                blockPositions.add(blockPos);
                
                var ship = ShipAssemblyKt.createNewShipWithBlocks(level, blockPositions);
                if (ship) {
                  logFn('createShip: SUCCESS with ShipAssemblyKt.createNewShipWithBlocks + HashSet: ' + ship);
                  return ship;
                }
              } catch (hashSetErr) {
                logFn('createShip: ShipAssemblyKt + HashSet approach failed: ' + hashSetErr);
              }
              
              // Try with different parameter combinations
              try {
                var ship = ShipAssemblyKt.createNewShipWithBlocks(level, blockPos);
                if (ship) {
                  logFn('createShip: SUCCESS with ShipAssemblyKt.createNewShipWithBlocks + single BlockPos: ' + ship);
                  return ship;
                }
              } catch (singlePosErr) {
                logFn('createShip: ShipAssemblyKt + Single BlockPos approach failed: ' + singlePosErr);
              }
              
              // Try other method names on ShipAssemblyKt
              var methodNames = ['assembleToShip', 'createShip', 'assembleShip', 'newShipWithBlocks'];
              var blockPositions = Java.loadClass('java.util.HashSet')();
              blockPositions.add(blockPos);
              
              for (var i = 0; i < methodNames.length; i++) {
                var methodName = methodNames[i];
                try {
                  logFn('createShip: Trying ShipAssemblyKt.' + methodName);
                  var ship = ShipAssemblyKt[methodName](level, blockPositions);
                  if (ship) {
                    logFn('createShip: SUCCESS with ShipAssemblyKt.' + methodName + ': ' + ship);
                    return ship;
                  }
                } catch (methodErr) {
                  logFn('createShip: ShipAssemblyKt.' + methodName + ' failed: ' + methodErr);
                }
              }
              
            } else {
              logFn('createShip: ShipAssemblyKt not found in global scope');
            }
            
          } catch (globalErr) {
            logFn('createShip: Global ShipAssemblyKt approach failed: ' + globalErr);
          }
          
          // Method 2: Try other global functions that might exist
          try {
            logFn('createShip: Trying other potential global functions');
            
            var globalFunctions = [
              'assembleToShip',
              'createShip', 
              'assembleShip',
              'newShipWithBlocks'
            ];
            
            var blockPositions = Java.loadClass('java.util.HashSet')();
            blockPositions.add(blockPos);
            
            for (var i = 0; i < globalFunctions.length; i++) {
              var funcName = globalFunctions[i];
              try {
                logFn('createShip: Trying global function: ' + funcName);
                var ship = global[funcName](level, blockPositions);
                if (ship) {
                  logFn('createShip: SUCCESS with global function ' + funcName + ': ' + ship);
                  return ship;
                }
              } catch (globalFuncErr) {
                logFn('createShip: Global function ' + funcName + ' failed: ' + globalFuncErr);
              }
            }
          } catch (globalFuncTestErr) {
            logFn('createShip: Global function testing failed: ' + globalFuncTestErr);
          }
          
          // Method 3: Try accessing through different namespaces
          try {
            logFn('createShip: Trying namespace access patterns');
            
            // Try ShipAssembly (without Kt suffix)
            try {
              var ship = ShipAssembly.createNewShipWithBlocks(level, blockPositions);
              if (ship) {
                logFn('createShip: SUCCESS with ShipAssembly namespace: ' + ship);
                return ship;
              }
            } catch (assemblyErr) {
              logFn('createShip: ShipAssembly namespace failed: ' + assemblyErr);
            }
            
            // Try direct namespace access
            try {
              var ship = org.valkyrienskies.mod.common.assembly.ShipAssemblyKt.createNewShipWithBlocks(level, blockPositions);
              if (ship) {
                logFn('createShip: SUCCESS with direct namespace: ' + ship);
                return ship;
              }
            } catch (namespaceErr) {
              logFn('createShip: Direct namespace failed: ' + namespaceErr);
            }
            
          } catch (namespaceTestErr) {
            logFn('createShip: Namespace testing failed: ' + namespaceTestErr);
          }
          
          logFn('createShip: All Rhino auto-wrap attempts failed');
          logFn('createShip: CONCLUSION: createNewShipWithBlocks method exists and is callable,');
          logFn('createShip: but we cannot determine the correct parameter signature.');
          logFn('createShip: Recommend contacting KubeVS creator for exact method signature.');
          logFn('createShip: Static barrels provide fully functional salvage system in the meantime.');
          return null;
          
        } catch (createErr) {
          logFn('createShip: General error: ' + createErr);
          return null;
        }
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
      createShip: function(){ return null; },
      _reinit: function(){ return false; },
      _forceWire: function(){ return false; }
    };
    global.KubeVS = apiFail;
  }
})();
